/*
 * OIE Community Store - web administrator frontend.
 *
 * Talks exclusively to the engine extension's REST surface at
 * /api/extensions/communitystore (session-authenticated, gated by the
 * manage-extensions permission). No GitHub calls happen in the browser.
 */

import { platform } from '@oie/web-shell';
import { renderDocsHtml } from './markdown.js';

const React = platform.React;
const BASE = '/extensions/communitystore';

/* ------------------------------------------------------------------ */
/* Publisher docs are rendered through the sanitizing pipeline in       */
/* markdown.js (raw HTML escaped, link/image protocols allowlisted).    */
/* ------------------------------------------------------------------ */

const DOCS_CSS = `
.cs-docs { line-height: 1.55; overflow-wrap: break-word; }
.cs-docs img { max-width: 100%; }
.cs-docs pre { overflow-x: auto; padding: 8px 10px; border: 1px solid var(--line, #8884); border-radius: 4px; }
.cs-docs code { font-family: monospace; font-size: 0.9em; }
.cs-docs table { border-collapse: collapse; }
.cs-docs th, .cs-docs td { border: 1px solid var(--line, #8884); padding: 4px 8px; }
.cs-docs blockquote { border-left: 3px solid var(--line, #8884); margin-left: 0; padding-left: 12px; }
.cs-docs h1, .cs-docs h2 { border-bottom: 1px solid var(--line, #8884); padding-bottom: 4px; }
`;

/* ------------------------------------------------------------------ */
/* API helpers                                                         */
/* ------------------------------------------------------------------ */

function parseMaybeJson(value) {
    if (typeof value === 'string') {
        try { return JSON.parse(value); } catch (e) { return value; }
    }
    return value;
}

async function apiGet(path) {
    return parseMaybeJson(await platform.api.get(path));
}

async function apiPost(path, body) {
    return parseMaybeJson(await platform.api.post(path, body));
}

async function apiPut(path, body) {
    return parseMaybeJson(await platform.api.put(path, body));
}

function toast(message, kind) {
    try { platform.ui.toast(message, kind); } catch (e) { /* toast is best-effort */ }
}

function errText(e) {
    return (e && (e.message || e.statusText)) ? (e.message || e.statusText) : String(e);
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

const TYPE_LABELS = {
    connector: 'Connector',
    plugin: 'Plugin',
    datatype: 'Data Type',
    'code-template-library': 'Code Templates',
    channel: 'Channel',
};

function TypeTag({ type }) {
    return <span className="tag">{TYPE_LABELS[type] || type}</span>;
}

function Badges({ entry }) {
    return (
        <span className="flex gap-1 items-center flex-wrap">
            {entry.installedVersion ? <span className="tag">Installed {entry.installedVersion}</span> : null}
            {entry.updateAvailable ? <span className="tag text-accent">Update {entry.version}</span> : null}
            {!entry.compatible ? <span className="tag">Incompatible</span> : null}
            {entry.deprecated ? <span className="tag">Deprecated</span> : null}
        </span>
    );
}

/** Self-contained confirmation overlay (no dependency on host modal internals). */
function ConfirmOverlay({ title, children, confirmLabel, onConfirm, onCancel, busy }) {
    return (
        <div className="fixed inset-0 flex items-center justify-center" style={{ background: 'rgba(0,0,0,0.45)', zIndex: 1000 }}>
            <div className="panel" style={{ width: 460, maxWidth: '90vw' }}>
                <div className="panel-header">{title}</div>
                <div className="panel-body">
                    {children}
                    <div className="flex gap-2 mt-4" style={{ justifyContent: 'flex-end' }}>
                        <button className="btn" onClick={onCancel} disabled={busy}>Cancel</button>
                        <button className="btn btn-primary" onClick={onConfirm} disabled={busy}>
                            {busy ? 'Working…' : confirmLabel}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Install / uninstall flows                                           */
/* ------------------------------------------------------------------ */

function useStoreActions(refresh) {
    const [confirm, setConfirm] = React.useState(null); // { entry, mode }
    const [busy, setBusy] = React.useState(false);

    const requestInstall = (entry) => setConfirm({ entry, mode: 'install' });
    const requestUninstall = (entry) => setConfirm({ entry, mode: 'uninstall' });

    const execute = async () => {
        if (!confirm) return;
        setBusy(true);
        try {
            if (confirm.mode === 'install') {
                await apiPost(`${BASE}/_install`, { id: confirm.entry.id, tag: confirm.entry.tag });
                toast(`Installed ${confirm.entry.name} ${confirm.entry.version}. Restart the engine to activate it.`, 'success');
            } else {
                await apiPost(`${BASE}/_uninstall`, { id: confirm.entry.id });
                toast(`${confirm.entry.name} will be uninstalled on the next engine restart.`, 'success');
            }
            // Trigger the shell's global restart banner — the same "extension change
            // staged → watching for the engine → Reload UI" flow the Extensions screen
            // uses (bridges.jsx useRestartWatch listens for this event).
            try { window.dispatchEvent(new Event('webadmin:restart-pending')); } catch (e) { /* non-browser */ }
            setConfirm(null);
            await refresh(false);
        } catch (e) {
            toast(errText(e), 'error');
        } finally {
            setBusy(false);
        }
    };

    const overlay = confirm ? (
        <ConfirmOverlay
            title={confirm.mode === 'install' ? `Install ${confirm.entry.name}?` : `Uninstall ${confirm.entry.name}?`}
            confirmLabel={confirm.mode === 'install' ? `Install ${confirm.entry.version}` : 'Uninstall'}
            busy={busy}
            onCancel={() => setConfirm(null)}
            onConfirm={execute}>
            {confirm.mode === 'install' ? (
                <div>
                    <p>
                        This installs <span className="mono">{confirm.entry.repo}</span> release{' '}
                        <span className="mono">{confirm.entry.tag}</span> into the engine's extensions
                        directory after sha256 verification.
                    </p>
                    <p className="hint mt-2">
                        Community content is published by third parties and is not vetted by the
                        Open Integration Engine project. Installing an extension runs its code in
                        the engine. Install only from publishers you trust.
                    </p>
                </div>
            ) : (
                <p>
                    The extension <span className="mono">{confirm.entry.id}</span> will be marked for
                    removal and uninstalled on the next engine restart.
                </p>
            )}
        </ConfirmOverlay>
    ) : null;

    return { requestInstall, requestUninstall, overlay };
}

/* ------------------------------------------------------------------ */
/* Publisher documentation panel                                       */
/* ------------------------------------------------------------------ */

function DocsPanel({ entry }) {
    const [docs, setDocs] = React.useState(null);
    const [error, setError] = React.useState(null);

    React.useEffect(() => {
        let cancelled = false;
        setDocs(null);
        setError(null);
        apiGet(`${BASE}/catalog/${encodeURIComponent(entry.id)}/docs`)
            .then((result) => { if (!cancelled) setDocs(result); })
            .catch((e) => { if (!cancelled) setError(errText(e)); });
        return () => { cancelled = true; };
    }, [entry.id, entry.tag]);

    const html = React.useMemo(() => {
        if (!docs || !docs.found) return null;
        try {
            return renderDocsHtml(docs.markdown, docs.repo, docs.tag, docs.images);
        } catch (e) {
            return null;
        }
    }, [docs]);

    return (
        <div className="panel mt-3">
            <div className="panel-header flex items-center gap-2">
                Documentation
                {docs && docs.found ? <span className="mono text-text-dim" style={{ fontSize: '0.85em' }}>{docs.path} @ {docs.tag}</span> : null}
            </div>
            <div className="panel-body">
                <style>{DOCS_CSS}</style>
                {error ? <span className="text-text-dim">Could not load documentation: {error}</span> : null}
                {!error && !docs ? <span className="text-text-dim">Loading documentation…</span> : null}
                {docs && !docs.found ? (
                    <span className="text-text-dim">
                        This publisher provides no store documentation. Publishers can add a
                        store.md (or README.md) to their repository; it renders here, pinned to the
                        release tag.
                    </span>
                ) : null}
                {html ? <div className="cs-docs" dangerouslySetInnerHTML={{ __html: html }} /> : null}
                {docs && docs.truncated ? (
                    <div className="hint mt-2">Documentation was truncated. The full file is available in the repository.</div>
                ) : null}
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Detail view                                                         */
/* ------------------------------------------------------------------ */

function DetailView({ entry, onBack, actions }) {
    return (
        <div>
            <div className="flex items-center gap-2 mb-3">
                <button className="btn btn-sm" onClick={onBack}>← Back</button>
                <h2 className="m-0">{entry.name}</h2>
                <TypeTag type={entry.type} />
                <Badges entry={entry} />
            </div>

            {entry.deprecated ? (
                <div className="panel mb-3"><div className="panel-body text-accent">
                    Deprecated by the publisher{entry.deprecationMessage ? `: ${entry.deprecationMessage}` : '.'}
                </div></div>
            ) : null}
            {!entry.compatible ? (
                <div className="panel mb-3"><div className="panel-body">
                    No release of this extension is compatible with this engine version
                    {entry.minEngineVersion ? ` (requires engine ${entry.minEngineVersion}${entry.maxEngineVersion ? ` to ${entry.maxEngineVersion}` : ' or later'})` : ''}.
                </div></div>
            ) : null}

            <div className="panel">
                <div className="panel-header">Details</div>
                <div className="panel-body">
                    <p>{entry.description || <span className="text-text-dim">No description provided.</span>}</p>
                    <table className="dt mt-3">
                        <tbody>
                            <tr><td className="text-text-dim">Repository</td><td><a href={`https://github.com/${entry.repo}`} target="_blank" rel="noreferrer">{entry.repo}</a></td></tr>
                            <tr><td className="text-text-dim">Offered version</td><td className="mono">{entry.version} ({entry.tag}){entry.offeredIsLatest ? '' : ` — newest compatible; latest release is ${entry.latestTag}`}</td></tr>
                            <tr><td className="text-text-dim">Engine compatibility</td><td className="mono">{entry.minEngineVersion || 'unspecified'}{entry.maxEngineVersion ? ` to ${entry.maxEngineVersion}` : '+'}</td></tr>
                            {entry.installedVersion ? <tr><td className="text-text-dim">Installed version</td><td className="mono">{entry.installedVersion}</td></tr> : null}
                            <tr><td className="text-text-dim">License</td><td>{entry.license || <span className="text-text-dim">unspecified</span>}</td></tr>
                            <tr><td className="text-text-dim">Authors</td><td>{(entry.authors || []).join(', ') || <span className="text-text-dim">unspecified</span>}</td></tr>
                            <tr><td className="text-text-dim">Published</td><td>{entry.publishedAt || ''}</td></tr>
                            <tr><td className="text-text-dim">Source</td><td className="mono">{entry.source}</td></tr>
                            <tr><td className="text-text-dim">Restart required</td><td>{entry.restartRequired ? 'Yes' : 'No'}</td></tr>
                        </tbody>
                    </table>
                    <div className="flex gap-2 mt-4">
                        {entry.installable && entry.compatible && (!entry.installedVersion || entry.updateAvailable) ? (
                            <button className="btn btn-primary" onClick={() => actions.requestInstall(entry)}>
                                {entry.installedVersion ? `Update to ${entry.version}` : `Install ${entry.version}`}
                            </button>
                        ) : null}
                        {!entry.installable ? (
                            <span className="hint">This content type is not installable through the store yet.</span>
                        ) : null}
                        {entry.installedVersion ? (
                            <button className="btn" onClick={() => actions.requestUninstall(entry)}>Uninstall</button>
                        ) : null}
                        {entry.documentation ? (
                            <a className="btn" href={entry.documentation} target="_blank" rel="noreferrer">Documentation</a>
                        ) : null}
                        {entry.releaseUrl ? (
                            <a className="btn" href={entry.releaseUrl} target="_blank" rel="noreferrer">Release notes</a>
                        ) : null}
                    </div>
                </div>
            </div>

            <DocsPanel entry={entry} />
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Browse view                                                         */
/* ------------------------------------------------------------------ */

function BrowseView({ catalog, onSelect }) {
    const [search, setSearch] = React.useState('');
    const [typeFilter, setTypeFilter] = React.useState('');

    const entries = (catalog.entries || []).filter((entry) => {
        if (typeFilter && entry.type !== typeFilter) return false;
        if (!search) return true;
        const haystack = `${entry.name} ${entry.description} ${entry.repo} ${(entry.keywords || []).join(' ')}`.toLowerCase();
        return haystack.includes(search.toLowerCase());
    });

    const types = [...new Set((catalog.entries || []).map((e) => e.type))].sort();

    return (
        <div>
            <div className="flex gap-2 items-center mb-3">
                <input className="field" style={{ maxWidth: 320 }} placeholder="Search name, description, keywords…"
                    value={search} onChange={(e) => setSearch(e.target.value)} />
                <select className="field" style={{ maxWidth: 200 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
                    <option value="">All types</option>
                    {types.map((t) => <option key={t} value={t}>{TYPE_LABELS[t] || t}</option>)}
                </select>
                <span className="text-text-dim">{entries.length} of {(catalog.entries || []).length} extension(s)</span>
            </div>

            {entries.length === 0 ? (
                <div className="panel"><div className="panel-body text-text-dim">
                    No extensions match. Sources may still be syncing, or none are configured; check Settings.
                </div></div>
            ) : (
                <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))' }}>
                    {entries.map((entry) => (
                        <div key={entry.id} className="panel" style={{ cursor: 'pointer' }} onClick={() => onSelect(entry)}>
                            <div className="panel-body">
                                <div className="flex items-center gap-2">
                                    <strong>{entry.name}</strong>
                                    <span className="mono text-text-dim">{entry.version}</span>
                                    <TypeTag type={entry.type} />
                                </div>
                                <div className="text-text-dim mt-1" style={{ minHeight: '2.5em' }}>
                                    {entry.description ? (entry.description.length > 140 ? entry.description.slice(0, 140) + '…' : entry.description) : ''}
                                </div>
                                <div className="flex items-center gap-2 mt-2">
                                    <span className="mono text-text-dim" style={{ fontSize: '0.85em' }}>{entry.repo}</span>
                                </div>
                                <div className="mt-2"><Badges entry={entry} /></div>
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Installed view                                                      */
/* ------------------------------------------------------------------ */

function InstalledView({ catalog, onSelect, actions }) {
    const installed = (catalog.entries || []).filter((e) => e.installedVersion);
    if (installed.length === 0) {
        return <div className="panel"><div className="panel-body text-text-dim">
            No store-tracked extensions are installed. Extensions installed manually appear here once
            their repository is listed in a configured source and the ids match.
        </div></div>;
    }
    return (
        <table className="dt">
            <thead>
                <tr><th>Name</th><th>Type</th><th>Installed</th><th>Available</th><th>Repository</th><th></th></tr>
            </thead>
            <tbody>
                {installed.map((entry) => (
                    <tr key={entry.id}>
                        <td><a onClick={() => onSelect(entry)} style={{ cursor: 'pointer' }}>{entry.name}</a></td>
                        <td><TypeTag type={entry.type} /></td>
                        <td className="mono">{entry.installedVersion}</td>
                        <td className="mono">{entry.updateAvailable ? <span className="text-accent">{entry.version}</span> : entry.version}</td>
                        <td className="mono">{entry.repo}</td>
                        <td className="flex gap-1">
                            {entry.updateAvailable ? (
                                <button className="btn btn-primary" onClick={() => actions.requestInstall(entry)}>Update</button>
                            ) : null}
                            <button className="btn" onClick={() => actions.requestUninstall(entry)}>Uninstall</button>
                        </td>
                    </tr>
                ))}
            </tbody>
        </table>
    );
}

/* ------------------------------------------------------------------ */
/* Settings view                                                       */
/* ------------------------------------------------------------------ */

function SettingsView({ catalog, onSaved }) {
    const [settings, setSettings] = React.useState(null);
    const [token, setToken] = React.useState(null); // null = unchanged
    const [newKind, setNewKind] = React.useState('repo');
    const [newValue, setNewValue] = React.useState('');
    const [newTopic, setNewTopic] = React.useState('oie-plugin');
    const [newBlock, setNewBlock] = React.useState('');
    const [saving, setSaving] = React.useState(false);

    const load = async () => {
        try { setSettings(await apiGet(`${BASE}/settings`)); }
        catch (e) { toast(errText(e), 'error'); }
    };
    React.useEffect(() => { load(); }, []);

    if (!settings) return <div className="text-text-dim">Loading settings…</div>;

    const save = async () => {
        setSaving(true);
        try {
            const body = {
                customSources: settings.customSources,
                localBlocklist: settings.localBlocklist,
                betaChannel: settings.betaChannel,
            };
            if (token !== null) body.token = token;
            const updated = await apiPut(`${BASE}/settings`, body);
            setSettings(updated);
            setToken(null);
            toast('Settings saved.', 'success');
            onSaved();
        } catch (e) {
            toast(errText(e), 'error');
        } finally {
            setSaving(false);
        }
    };

    const addSource = () => {
        const value = newValue.trim();
        if (!value) return;
        const source = newKind === 'org'
            ? { kind: 'org', org: value, topic: newTopic.trim() || 'oie-plugin' }
            : { kind: 'repo', repo: value };
        setSettings({ ...settings, customSources: [...settings.customSources, source] });
        setNewValue('');
    };

    return (
        <div className="flex flex-col gap-3" style={{ maxWidth: 760 }}>
            <div className="panel">
                <div className="panel-header">Sources</div>
                <div className="panel-body">
                    <div className="hint mb-2">
                        Bundled sources ship with the store and update with store releases. Custom
                        sources are additive and stored on this engine.
                    </div>
                    <table className="dt">
                        <thead><tr><th>Source</th><th>Origin</th><th></th></tr></thead>
                        <tbody>
                            {settings.bundledSources.map((s, i) => (
                                <tr key={`b${i}`}>
                                    <td className="mono">{s.kind === 'org' ? `org: ${s.org} (topic: ${s.topic})` : `repo: ${s.repo}`}</td>
                                    <td className="text-text-dim">bundled</td><td></td>
                                </tr>
                            ))}
                            {settings.customSources.map((s, i) => (
                                <tr key={`c${i}`}>
                                    <td className="mono">{s.kind === 'org' ? `org: ${s.org} (topic: ${s.topic})` : `repo: ${s.repo}`}</td>
                                    <td className="text-text-dim">custom</td>
                                    <td><button className="btn" onClick={() =>
                                        setSettings({ ...settings, customSources: settings.customSources.filter((_, j) => j !== i) })
                                    }>Remove</button></td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                    <div className="flex gap-2 items-center mt-3">
                        <select className="field" style={{ maxWidth: 110 }} value={newKind} onChange={(e) => setNewKind(e.target.value)}>
                            <option value="repo">repo</option>
                            <option value="org">org</option>
                        </select>
                        <input className="field" style={{ maxWidth: 260 }} value={newValue} onChange={(e) => setNewValue(e.target.value)}
                            placeholder={newKind === 'org' ? 'organization login' : 'owner/repository'} />
                        {newKind === 'org' ? (
                            <input className="field" style={{ maxWidth: 160 }} value={newTopic} onChange={(e) => setNewTopic(e.target.value)}
                                placeholder="topic filter" />
                        ) : null}
                        <button className="btn" onClick={addSource}>Add source</button>
                    </div>
                </div>
            </div>

            <div className="panel">
                <div className="panel-header">Blocklist</div>
                <div className="panel-body">
                    <div className="hint mb-2">Blocked repositories never appear in the catalog. The bundled blocklist cannot be removed here.</div>
                    {settings.bundledBlocklist.map((b, i) => (
                        <div key={`bb${i}`} className="flex gap-2 items-center"><span className="mono">{b}</span><span className="text-text-dim">(bundled)</span></div>
                    ))}
                    {settings.localBlocklist.map((b, i) => (
                        <div key={`lb${i}`} className="flex gap-2 items-center">
                            <span className="mono">{b}</span>
                            <button className="btn" onClick={() =>
                                setSettings({ ...settings, localBlocklist: settings.localBlocklist.filter((_, j) => j !== i) })
                            }>Remove</button>
                        </div>
                    ))}
                    <div className="flex gap-2 items-center mt-2">
                        <input className="field" style={{ maxWidth: 260 }} value={newBlock} onChange={(e) => setNewBlock(e.target.value)} placeholder="owner/repository" />
                        <button className="btn" onClick={() => {
                            const value = newBlock.trim().toLowerCase();
                            if (value) setSettings({ ...settings, localBlocklist: [...settings.localBlocklist, value] });
                            setNewBlock('');
                        }}>Block</button>
                    </div>
                </div>
            </div>

            <div className="panel">
                <div className="panel-header">GitHub access</div>
                <div className="panel-body flex flex-col gap-2">
                    <label className="flex gap-2 items-center">
                        <input type="checkbox" checked={settings.betaChannel}
                            onChange={(e) => setSettings({ ...settings, betaChannel: e.target.checked })} />
                        Include pre-releases (beta channel)
                    </label>
                    <div className="flex gap-2 items-center">
                        <input className="field" type="password" style={{ maxWidth: 340 }}
                            placeholder={settings.tokenSet ? 'Token configured (leave blank to keep, save empty to clear)' : 'Personal access token (optional)'}
                            value={token === null ? '' : token}
                            onChange={(e) => setToken(e.target.value)} />
                        {settings.tokenSet && token === null ? <span className="tag">set</span> : null}
                    </div>
                    <div className="hint">
                        A token raises the GitHub API rate limit and enables private sources. It is
                        stored encrypted on the engine and never returned to the browser.
                        {catalog && catalog.rateLimitRemaining ? ` Rate limit remaining: ${catalog.rateLimitRemaining}.` : ''}
                    </div>
                </div>
            </div>

            <div className="flex gap-2">
                <button className="btn btn-primary" onClick={save} disabled={saving}>{saving ? 'Saving…' : 'Save settings'}</button>
            </div>
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Root view                                                           */
/* ------------------------------------------------------------------ */

function CommunityStoreView() {
    const [tab, setTab] = React.useState('browse');
    const [catalog, setCatalog] = React.useState(null);
    const [error, setError] = React.useState(null);
    const [loading, setLoading] = React.useState(true);
    const [selected, setSelected] = React.useState(null);

    const refresh = async (force) => {
        setLoading(true);
        setError(null);
        try {
            const data = await apiGet(`${BASE}/catalog?refresh=${force ? 'true' : 'false'}`);
            setCatalog(data);
            if (selected) {
                const updated = (data.entries || []).find((e) => e.id === selected.id);
                setSelected(updated || null);
            }
        } catch (e) {
            setError(errText(e));
        } finally {
            setLoading(false);
        }
    };

    React.useEffect(() => { refresh(false); }, []);

    const actions = useStoreActions(refresh);

    const updates = catalog ? (catalog.entries || []).filter((e) => e.updateAvailable).length : 0;

    const banners = (
        <>
            {error ? (
                <div className="panel mb-3"><div className="panel-body">
                    <span className="text-accent">Could not load the store catalog.</span>{' '}
                    <span className="text-text-dim">{error}</span>
                    <div className="hint mt-1">
                        The Community Store requires the manage-extensions permission, the same
                        permission used to install extensions manually.
                    </div>
                </div></div>
            ) : null}
            {catalog && (catalog.errors || []).length > 0 ? (
                <div className="panel mb-3"><div className="panel-body">
                    <div className="text-text-dim mb-1">Some sources failed to sync:</div>
                    {catalog.errors.map((e, i) => (
                        <div key={i} className="mono text-[12px]">{e.source}: {e.message}</div>
                    ))}
                </div></div>
            ) : null}
        </>
    );

    return (
        <div className="view flex flex-col flex-1 min-h-0">
            {actions.overlay}
            {selected ? (
                <div className="view-body">
                    {banners}
                    <DetailView entry={selected} onBack={() => setSelected(null)} actions={actions} />
                </div>
            ) : (
                <>
                    <div className="tabs flex-none">
                        <button className={`tab ${tab === 'browse' ? 'active' : ''}`} onClick={() => setTab('browse')}>Browse</button>
                        <button className={`tab ${tab === 'installed' ? 'active' : ''}`} onClick={() => setTab('installed')}>
                            Installed{updates > 0 ? ` (${updates})` : ''}
                        </button>
                        <button className={`tab ${tab === 'settings' ? 'active' : ''}`} onClick={() => setTab('settings')}>Settings</button>
                        <div className="ml-auto flex items-center gap-2 pr-2">
                            {catalog && catalog.engineVersion ? <span className="text-text-dim text-[12px]">Engine {catalog.engineVersion}</span> : null}
                            <button className="btn btn-sm" onClick={() => refresh(true)} disabled={loading}>{loading ? 'Syncing…' : 'Sync now'}</button>
                        </div>
                    </div>
                    <div className="view-body">
                        {banners}
                        {tab === 'browse' && catalog ? <BrowseView catalog={catalog} onSelect={setSelected} /> : null}
                        {tab === 'installed' && catalog ? <InstalledView catalog={catalog} onSelect={setSelected} actions={actions} /> : null}
                        {tab === 'settings' ? <SettingsView catalog={catalog} onSaved={() => refresh(true)} /> : null}
                        {loading && !catalog ? <div className="text-text-dim">Loading catalog…</div> : null}
                    </div>
                </>
            )}
        </div>
    );
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export function register() {
    platform.registerNavItem({
        id: 'community-store',
        label: 'Community Store',
        icon: 'plug',
        path: '/community-store',
        section: 'Engine',
        order: 80,
    });
    platform.registerView('/community-store', platform.reactView(CommunityStoreView), { title: 'Community Store' });
}
