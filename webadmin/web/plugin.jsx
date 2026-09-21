/*
 * OIE Community Store - web administrator frontend.
 *
 * Talks exclusively to the engine extension's REST surface at
 * /api/extensions/communitystore (session-authenticated, gated by the
 * manage-extensions permission). No GitHub calls happen in the browser.
 */

import { platform } from '@oie/web-shell';
import { renderDocsHtml } from './markdown.js';
import { STORE_CSS } from './store-style.js';

/* RBAC: the store's manage tasks (declared in CommunityStoreServicePlugin's
   ExtensionPermissions) resolve as bare task names through the RBAC plugin's
   extension task-permission merge → "Manage Community Store". Without an RBAC
   plugin the default controller allows everything, so these are always true. */
const canInstall = () => platform.checkTask('', 'doInstallStoreItem');
const canRemove = () => platform.checkTask('', 'doRemoveStoreContent');
const canEditSettings = () => platform.checkTask('', 'doEditStoreSettings');

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
    let text = (e && (e.message || e.statusText)) ? (e.message || e.statusText) : String(e);
    // Engine-side failures arrive as a serialized ClientException XML blob — stack trace
    // and all. Surface only the human message (the outermost <detailMessage>).
    const m = /<detailMessage>([\s\S]*?)<\/detailMessage>/.exec(text);
    if (m) {
        text = m[1]
            .replace(/&quot;/g, '"').replace(/&apos;/g, "'")
            .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
            .trim();
    }
    return text;
}

/* ------------------------------------------------------------------ */
/* Small presentational pieces                                         */
/* ------------------------------------------------------------------ */

const TYPE_LABELS = {
    connector: 'Connector',
    plugin: 'Plugin',
    datatype: 'Data Type',
    channel: 'Channel',
    'code-template-library': 'Code Template Library',
    'code-template': 'Code Template',
};

// Stable ordering for the type filter and the group-by-type sections.
const TYPE_ORDER = ['connector', 'plugin', 'datatype', 'channel', 'code-template-library', 'code-template'];
const typeRank = (t) => { const i = TYPE_ORDER.indexOf(t); return i < 0 ? TYPE_ORDER.length : i; };

// Content types are imported (channels/code templates) rather than installed as extensions:
// they take effect immediately, with no engine restart.
const CONTENT_TYPES = ['channel', 'code-template-library', 'code-template'];
const isContentType = (t) => CONTENT_TYPES.includes(t);

// Web store client: an entry is hidden IFF its offered version declares a UI surface
// that does not include "web" (i.e. swing-only). Content (ui absent) and server-only /
// ui-less extensions (ui []) are always shown. Engine min/max compatibility is a
// separate filter and is unchanged.
const showsInWebUi = (entry) => !(Array.isArray(entry.ui) && entry.ui.length && !entry.ui.includes('web'));

// Normalize the engine's /codeTemplateLibraries response (XStream single-root + one-element-list
// quirk) into a plain [{id, name}] list for the install-dialog library picker.
function normalizeLibraries(resp) {
    let node = resp && resp.list !== undefined ? resp.list : resp;
    let arr = node && node.codeTemplateLibrary;
    if (!arr) return [];
    if (!Array.isArray(arr)) arr = [arr];
    return arr.map((l) => ({ id: l && l.id, name: (l && l.name) || l.id })).filter((l) => l.id);
}

// Small persisted UI prefs (view mode, grouping), scoped to the store.
function getPref(key, fallback) {
    try { const v = localStorage.getItem('communitystore.' + key); return v === null ? fallback : v; }
    catch (e) { return fallback; }
}
function setPref(key, value) {
    try { localStorage.setItem('communitystore.' + key, value); } catch (e) { /* private mode */ }
}

/** Self-contained confirmation overlay (no dependency on host modal internals).
 *  An optional secondary action renders between Cancel and the primary button
 *  (used for the three-way modified-template choice). */
function ConfirmOverlay({ title, children, confirmLabel, onConfirm, secondaryLabel, onSecondary, onCancel, busy, loading, error, documentation = false, inactive = false, closeLabel = "Close documentation" }) {
    const dialog = React.useRef(null);
    const titleId = React.useId();
    React.useEffect(() => {
        const previous = document.activeElement;
        dialog.current?.focus();
        return () => { if (previous?.isConnected) previous.focus(); };
    }, []);
    const onKeyDown = (event) => {
        if (event.key === 'Escape' && !busy) { event.stopPropagation(); onCancel(); }
        if (event.key !== 'Tab') return;
        const nodes = [...dialog.current.querySelectorAll('button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary')];
        const first = nodes[0], last = nodes[nodes.length - 1];
        if (!first) { event.preventDefault(); return; }
        if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) { event.preventDefault(); last.focus(); }
        else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) { event.preventDefault(); first.focus(); }
    };
    return <div className="cs-overlay" style={inactive ? {display: 'none'} : undefined}>
        <div className={`panel cs-dialog ${documentation ? 'cs-documentation-dialog' : ''}`}  role="dialog" aria-modal="true" aria-labelledby={titleId} ref={dialog} tabIndex={-1} onKeyDown={onKeyDown}>
            <div className="panel-header" id={titleId}>{title}{documentation ? <button className="btn btn-sm" onClick={onCancel} aria-label={closeLabel}>Close</button> : null}</div>
            <div className="panel-body">
                {children}
                {loading ? <p role="status">Loading libraries…</p> : null}
                {error ? <p role="alert" className="cs-notice error">{error}</p> : null}
                {!documentation ? <div className="cs-dialog-actions">
                    <button className="btn" onClick={() => onCancel()} disabled={busy}>Cancel</button>
                    {secondaryLabel ? <button className="btn btn-danger" onClick={() => onSecondary()} disabled={busy || loading}>{secondaryLabel}</button> : null}
                    <button className="btn btn-primary" onClick={() => onConfirm()} disabled={busy || loading}>
                        {busy ? 'Working…' : confirmLabel}
                    </button>
                </div> : null}
            </div>
        </div>
    </div>;
}

/* ------------------------------------------------------------------ */
/* Install / uninstall flows                                           */
/* ------------------------------------------------------------------ */

function useStoreActions(refresh, onComplete) {
    const [confirm, setConfirm] = React.useState(null); // { entry, mode: 'install' | 'upgrade' | 'copy' | 'modified-choice' | 'remove' }
    const [busy, setBusy] = React.useState(false);
    const inFlight = React.useRef(false);
    const pickerRequest = React.useRef(0);
    const [loadingLibraries, setLoadingLibraries] = React.useState(false);
    const [actionError, setActionError] = React.useState(null);
    const choose = (value) => { pickerRequest.current++; setLoadingLibraries(false); setActionError(null); setConfirm(value); };
    // Code Template install: choose a target library (a standalone template must live in one).
    const [libraries, setLibraries] = React.useState([]);
    const [libMode, setLibMode] = React.useState('new'); // 'new' | 'existing'
    const [newLib, setNewLib] = React.useState('');
    const [existingLib, setExistingLib] = React.useState('');

    // Preload the library picker for flows that create a NEW standalone template
    // (fresh install, install-as-copy). Upgrades keep their existing membership.
    const loadLibraryPicker = async (entry) => {
        const request = ++pickerRequest.current;
        setLoadingLibraries(true);
        setLibMode('new');
        setNewLib(entry.name || 'Community Store');
        setExistingLib('');
        setLibraries([]);
        try {
            const result = normalizeLibraries(await apiGet('/codeTemplateLibraries'));
            if (request === pickerRequest.current) setLibraries(result);
        } catch (e) {
            if (request === pickerRequest.current) setActionError('Could not load existing libraries. You can create a new library, or cancel and retry. ' + errText(e));
        } finally { if (request === pickerRequest.current) setLoadingLibraries(false); }
    };

    const requestInstall = async (entry) => {
        choose({ entry, mode: 'install' });
        // The library picker applies only to a FRESH standalone-template install; an
        // update / re-import keeps its existing library membership (backend enforces).
        if (entry.type === 'code-template' && !entry.installedVersion) await loadLibraryPicker(entry);
    };
    // Import under a fresh id, leaving anything installed untouched — the only
    // path for a present channel (snapshot gallery), and the keep-my-changes
    // path for templates.
    const requestCopy = async (entry) => {
        choose({ entry, mode: 'copy' });
        if (entry.type === 'code-template') await loadLibraryPicker(entry);
    };
    // Update / re-import on installed content. Channels never get here (the server always
    // reports updateAvailable false for them — snapshots only — and the details pane offers
    // them no re-import). Code templates and libraries are drift-aware: pristine goes
    // straight to an in-place upgrade; modified asks overwrite/copy/cancel — including
    // pre-tracking installs (driftTracked=false), which the server reports as modified
    // because it cannot tell. Everything else keeps today's flow.
    const requestUpdate = (entry) => {
        if (entry.type === 'code-template' || entry.type === 'code-template-library') {
            choose({ entry, mode: entry.modified ? 'modified-choice' : 'upgrade' });
        } else requestInstall(entry);
    };
    const requestRemove = (entry) => choose({ entry, mode: 'remove' });

    const execute = async (modeOverride, overwrite = false) => {
        if (!confirm || inFlight.current || loadingLibraries) return;
        const entry = confirm.entry;
        const mode = typeof modeOverride === 'string' ? modeOverride : confirm.mode;
        if (!['install', 'upgrade', 'copy', 'remove'].includes(mode)) return;
        const content = isContentType(entry.type);
        inFlight.current = true;
        setActionError(null);
        setBusy(true);
        try {
            if (mode === 'remove') {
                await apiPost(`${BASE}/_removeContent`, { id: entry.id });
                toast(`Removed ${entry.name} from this engine.`, 'success');
                onComplete?.({ entry, mode, restartRequired: false });
                setConfirm(null);
                await refresh(false);
                return;
            }
            {
                const body = { id: entry.id, tag: entry.tag };
                if (mode === 'upgrade' || mode === 'copy') body.mode = mode;
                if (mode === 'upgrade') { body.expectedContentHash = entry.expectedContentHash || ''; body.overwrite = overwrite; }
                if (entry.type === 'code-template' && (mode === 'copy' || (mode === 'install' && !entry.installedVersion))) {
                    if (libMode === 'existing') {
                        if (!existingLib) { toast('Choose a library to add this code template to.', 'warn'); setBusy(false); return; }
                        body.targetLibraryId = existingLib;
                    } else {
                        body.newLibrary = (newLib || '').trim() || 'Community Store';
                    }
                }
                const result = await apiPost(`${BASE}/_install`, body);
                onComplete?.({ entry, mode, restartRequired: !!result.restartRequired });
                toast(mode === 'upgrade' ? (entry.updateAvailable ? `Upgraded ${entry.name} to v${entry.version}.` : `Re-imported ${entry.name}.`)
                    : mode === 'copy' ? `Imported ${entry.name} as a copy.`
                        : content
                            ? `Imported ${entry.name}. It's available now.`
                            : `Installed ${entry.name} ${entry.version}. Restart the engine to activate it.`, 'success');
                // Extensions need a restart (shell's staged → Reload UI banner); imported
                // content takes effect immediately, so no restart prompt.
                if (!content) {
                    try { window.dispatchEvent(new Event('webadmin:restart-pending')); } catch (e) { /* non-browser */ }
                }
            }
            setConfirm(null);
            await refresh(false);
        } catch (e) {
            setActionError(errText(e));
            toast(errText(e), 'error');
        } finally {
            inFlight.current = false;
            setBusy(false);
        }
    };

    let overlay = null;
    if (confirm && confirm.mode === 'remove') {
        const entry = confirm.entry;
        overlay = (
            <ConfirmOverlay
                title={`Remove ${entry.name}?`}
                confirmLabel="Remove"
                busy={busy} loading={loadingLibraries} error={actionError}
                onCancel={() => choose(null)}
                onConfirm={() => execute('remove')}>
                <div>
                    {entry.type === 'code-template-library' ? (
                        <p>
                            Deletes the library <strong>{entry.name}</strong> and <strong>all code
                            templates it currently contains</strong> — including any you added to
                            it after installing.
                        </p>
                    ) : (
                        <p>
                            Deletes the code template <strong>{entry.name}</strong> from this engine,
                            including its library membership. The library itself is kept
                            {entry.revoked ? '.' : ', and the package stays in Browse if you want to re-import it later.'}
                        </p>
                    )}
                </div>
            </ConfirmOverlay>
        );
    } else if (confirm && confirm.mode === 'modified-choice') {
        // Drift-aware template/library update or re-import: an in-place upgrade would
        // discard whatever the user changed — or MIGHT have changed, for a pre-tracking
        // install (driftTracked=false) where the store cannot tell. Three-way:
        // overwrite / copy / cancel.
        const entry = confirm.entry;
        const noun = entry.type === 'code-template-library' ? 'library' : 'template';
        const untracked = entry.driftTracked === false;
        overlay = (
            <ConfirmOverlay
                title={`${entry.updateAvailable ? 'Update' : 'Re-import'} ${entry.name}?`}
                confirmLabel="Install as new copy"
                secondaryLabel="Overwrite"
                busy={busy} loading={loadingLibraries} error={actionError}
                onCancel={() => choose(null)}
                onSecondary={() => execute('upgrade', true)}
                onConfirm={() => requestCopy(entry)}>
                <div>
                    <p>
                        {untracked
                            ? `This ${noun} was installed using an older change-tracking format — the store can't tell whether you've modified it.`
                            : `You've modified this ${noun} since installing it.`}
                    </p>
                    <p>
                        <strong>Overwrite</strong> replaces {untracked ? 'whatever is there' : 'your changes'} with
                        version {entry.version}.{' '}
                        <strong>Install as new copy</strong> keeps {untracked ? "what's installed" : 'yours'} and
                        imports version {entry.version} as a separate {noun}
                        {entry.type === 'code-template' ? " (you'll choose a library for it)" : ''}.
                    </p>
                </div>
            </ConfirmOverlay>
        );
    } else if (confirm && confirm.mode === 'upgrade') {
        const entry = confirm.entry;
        const reimport = !entry.updateAvailable; // same version offered — re-import, not update
        overlay = (
            <ConfirmOverlay
                title={reimport ? `Re-import ${entry.name}?` : `Update ${entry.name} to v${entry.version}?`}
                confirmLabel={reimport ? 'Re-import' : `Update to v${entry.version}`}
                busy={busy} loading={loadingLibraries} error={actionError}
                onCancel={() => choose(null)}
                onConfirm={() => execute()}>
                <div>
                    <p>
                        Replaces the installed {TYPE_LABELS[entry.type] || entry.type} <strong>{entry.name}</strong> in
                        place with version {entry.version} from <span className="mono">{entry.repo}</span> ({entry.tag}).
                        {entry.type === 'code-template' ? ' Its library membership is kept, and it' : ' It'} takes
                        effect immediately — no engine restart.
                    </p>
                </div>
            </ConfirmOverlay>
        );
    } else if (confirm) {
        const entry = confirm.entry;
        const copy = confirm.mode === 'copy';
        const content = isContentType(entry.type);
        const wantsLibrary = entry.type === 'code-template' && (copy || !entry.installedVersion);
        overlay = (
            <ConfirmOverlay
                title={copy ? `Install ${entry.name} as a copy?`
                    : `${content ? (entry.updateAvailable ? 'Update' : 'Import') : 'Install'} ${entry.name}?`}
                confirmLabel={copy ? 'Install as copy'
                    : content ? (entry.updateAvailable ? `Update to ${entry.version}` : 'Import') : `Install ${entry.version}`}
                busy={busy} loading={loadingLibraries} error={actionError}
                onCancel={() => choose(null)}
                onConfirm={() => execute()}>
                {(
                    <div>
                        {copy ? (
                            <p>
                                Imports the {TYPE_LABELS[entry.type] || entry.type} <strong>{entry.name}</strong> version {entry.version} from{' '}
                                <span className="mono">{entry.repo}</span> ({entry.tag}) as a new copy with a fresh id
                                {entry.installedVersion ? ' — what you have installed is left untouched' : ''}.
                                The copy is yours: the store does not track or update it.
                            </p>
                        ) : content ? (
                            <p>
                                Imports the {TYPE_LABELS[entry.type] || entry.type} <strong>{entry.name}</strong> from{' '}
                                <span className="mono">{entry.repo}</span> ({entry.tag}). It takes effect immediately — no engine restart.
                            </p>
                        ) : (
                            <p>
                                This installs <span className="mono">{entry.repo}</span> release{' '}
                                <span className="mono">{entry.tag}</span> into the engine's extensions directory after sha256 verification.
                            </p>
                        )}
                        {wantsLibrary ? (
                            <div className="mt-3">
                                <div className="text-text-dim mb-1">Add to library:</div>
                                <label className="flex items-center gap-2 mb-1" style={{ cursor: 'pointer' }}>
                                    <input type="radio" name="cs-lib" checked={libMode === 'new'} onChange={() => setLibMode('new')} />
                                    Create new library:
                                    <input className="field" style={{ maxWidth: 220 }} value={newLib} placeholder="Library name"
                                        onFocus={() => setLibMode('new')} onChange={(e) => setNewLib(e.target.value)} />
                                </label>
                                <label className="flex items-center gap-2" style={{ cursor: libraries.length ? 'pointer' : 'default' }}>
                                    <input type="radio" name="cs-lib" checked={libMode === 'existing'} disabled={!libraries.length} onChange={() => setLibMode('existing')} />
                                    Existing library:
                                    <select className="field" style={{ maxWidth: 220 }} value={existingLib} disabled={!libraries.length}
                                        onChange={(e) => { setExistingLib(e.target.value); setLibMode('existing'); }}>
                                        <option value="">{libraries.length ? 'Select a library…' : 'No libraries yet'}</option>
                                        {libraries.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
                                    </select>
                                </label>
                            </div>
                        ) : null}
                        <p className="hint mt-2">
                            Community content is published by third parties and is not vetted by the Open
                            Integration Engine project. Installing runs its code in the engine. Install only
                            from publishers you trust.
                        </p>
                    </div>
                )}
            </ConfirmOverlay>
        );
    }

    return { requestInstall, requestUpdate, requestCopy, requestRemove, overlay, busy };
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
            return renderDocsHtml(docs.markdown, docs.repo, docs.tag, docs.images,
                { linkBase: docs.linkBase, imageBase: docs.imageBase });
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

// Match the host navigation glyphs and stroke weight (core/icons.ts).
const TYPE_ICONS = {
    'connector': 'M8 2v6M16 2v6M5 8h14v4a7 7 0 0 1-14 0V8zM12 19v3',
    'plugin': 'M8 2v6M16 2v6M5 8h14v4a7 7 0 0 1-14 0V8zM12 19v3',
    'datatype': 'M8 2v6M16 2v6M5 8h14v4a7 7 0 0 1-14 0V8zM12 19v3',
    'channel': 'M2 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M16 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M16 19a3 3 0 1 0 6 0a3 3 0 1 0-6 0M7.7 10.7l8.6-4.4M7.7 13.3l8.6 4.4',
    'code-template': 'M8 7l-5 5 5 5M16 7l5 5-5 5M13 4l-2 16',
    'code-template-library': 'M8 7l-5 5 5 5M16 7l5 5-5 5M13 4l-2 16',
};
function PackageIcon({ type }) {
    return <span className="cs-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={TYPE_ICONS[type] || TYPE_ICONS.plugin} /></svg></span>;
}
function PackageStatus({ entry }) {
    if (entry.revoked) return <span className="cs-pill error">{entry.revokedReason === 'blocked' ? 'Blocked by source' : 'Removed from source'}</span>;
    if (entry.stagedVersion) return <span className="cs-pill warn">Restart pending</span>;
    if (entry.modified) return <span className="cs-pill warn">{entry.driftTracked === false ? 'Changes unknown' : 'Locally modified'}</span>;
    if (entry.updateAvailable) return <span className="cs-pill update">Update available</span>;
    if (!entry.compatible) return <span className="cs-pill warn">Incompatible</span>;
    if (entry.deprecated) return <span className="cs-pill warn">Deprecated</span>;
    if (entry.installedVersion) return <span className="cs-pill ok">Installed</span>;
    return <span className="cs-pill">Available to {isContentType(entry.type) ? 'import' : 'install'}</span>;
}
function safeExternalUrl(value) {
    try { const url = new URL(value); return ['https:', 'http:'].includes(url.protocol) ? url.href : null; }
    catch { return null; }
}
function ExternalLink({ href, children }) {
    const safe = safeExternalUrl(href);
    return safe ? <a href={safe} target="_blank" rel="noopener noreferrer">{children}</a> : null;
}
function DetailView({ entry, actions }) {
    const [docsOpen, setDocsOpen] = React.useState(true);
    React.useEffect(() => setDocsOpen(true), [entry?.id]);
    if (!entry) return <aside className="cs-detail"><h2>Package details</h2><p className="cs-detail-description">Select a package to review its compatibility, source, and installation options.</p></aside>;
    const content = isContentType(entry.type);
    const channelCopy = entry.type === 'channel' && entry.installedVersion;
    const update = entry.updateAvailable || (content && entry.installedVersion && !channelCopy);
    const actionable = canInstall() && entry.installable && entry.compatible && !entry.revoked && !entry.stagedVersion
        && (content || !entry.installedVersion || entry.updateAvailable);
    const label = channelCopy ? 'Import as copy' : update ? entry.updateAvailable ? `Review update to ${entry.version}` : 'Review re-import'
        : content ? 'Review import' : 'Review installation';
    return <aside className="cs-detail" aria-label="Selected package">
        <PackageIcon type={entry.type} />
        <h2>{entry.name}</h2>
        <div className="cs-meta">{TYPE_LABELS[entry.type] || entry.type}{entry.authors?.length ? ` · by ${entry.authors.join(', ')}` : ''}</div>
        <p className="cs-detail-description">{entry.description || 'No description provided.'}</p>
        <PackageStatus entry={entry} />
        <dl className="cs-facts">
            <div className="cs-fact"><dt>Offered version</dt><dd>{entry.revoked ? 'Unavailable' : entry.version}</dd></div>
            <div className="cs-fact"><dt>Installed version</dt><dd>{entry.installedVersion || 'Not installed'}</dd></div>
            {entry.stagedVersion ? <div className="cs-fact"><dt>Staged version</dt><dd>{entry.stagedVersion}</dd></div> : null}
            <div className="cs-fact"><dt>Engine compatibility</dt><dd>{entry.minEngineVersion || 'Unspecified'}{entry.maxEngineVersion ? ` – ${entry.maxEngineVersion}` : entry.minEngineVersion ? '+' : ''}</dd></div>
        </dl>
        {entry.revoked ? <p className="cs-notice error">This package is no longer offered by its source. Review whether you still trust it.</p>
            : entry.stagedVersion ? <p className="cs-notice warn">Version {entry.stagedVersion} is staged. Restart the engine to activate it.</p>
            : !entry.compatible ? <p className="cs-notice warn">No compatible version is available for this engine.</p>
            : <p className="cs-notice">{content ? 'Imported content is available immediately. No restart needed.' : 'Engine restart required after installation.'}</p>}
        {entry.modified ? <p className="cs-notice warn">{entry.driftTracked === false ? 'Local changes are unknown with the previous tracking format.' : 'Local edits detected.'} Review before replacing this content. You can keep your changes by importing a copy.</p> : null}
        {entry.deprecated ? <p className="cs-notice warn">Deprecated by the publisher{entry.deprecationMessage ? `: ${entry.deprecationMessage}` : '.'}</p> : null}
        {entry.newerSnapshot ? <p className="cs-notice">Newer snapshot available: {entry.newerSnapshot}. Import as a copy to keep the installed channel.</p> : null}
        {actionable ? <button className="btn btn-primary cs-primary-action" disabled={actions.busy}
            onClick={() => channelCopy ? actions.requestCopy(entry) : update ? actions.requestUpdate(entry) : actions.requestInstall(entry)}>{label}</button> : null}
        <p className="cs-footnote">Community published. A checksum verifies artifact integrity, not publisher identity.</p>
        <details className="cs-package-info"><summary>Package information</summary><dl className="cs-facts">
            <div className="cs-fact"><dt>License</dt><dd>{entry.license || 'Unspecified'}</dd></div>
            <div className="cs-fact"><dt>Repository</dt><dd><ExternalLink href={entry.repoUrl || `https://github.com/${entry.repo}`}>{entry.repo || 'Repository'}</ExternalLink></dd></div>
            <div className="cs-fact"><dt>Source</dt><dd>{entry.source}</dd></div>
            <div className="cs-fact"><dt>Artifact integrity</dt><dd>{entry.sha256 || entry.checksumUrl ? 'SHA-256 on install' : 'No published checksum'}</dd></div>
            {entry.publishedAt ? <div className="cs-fact"><dt>Published</dt><dd>{new Date(entry.publishedAt).toLocaleDateString()}</dd></div> : null}
            {!entry.offeredIsLatest && entry.latestTag ? <div className="cs-fact"><dt>Latest release</dt><dd>{entry.latestTag} (offering the compatible version)</dd></div> : null}
        </dl></details>
        <div className="cs-detail-links">
            <ExternalLink href={entry.documentation}>Documentation ↗</ExternalLink>
            <ExternalLink href={entry.releaseUrl}>Release notes ↗</ExternalLink>
        </div>
        {!entry.revoked ? <>
            <button className="btn cs-docs-toggle" aria-expanded={docsOpen} onClick={() => setDocsOpen(!docsOpen)}>{docsOpen ? 'Hide publisher documentation' : 'Read publisher documentation'}</button>
            {docsOpen ? <DocsPanel entry={entry} /> : null}
        </> : null}
        {entry.installedVersion ? <div className="cs-facts">
            {content && entry.type !== 'channel' && canRemove() ? <button className="btn btn-danger" disabled={actions.busy} onClick={() => actions.requestRemove(entry)}>Remove from engine…</button>
                : <p className="cs-footnote">{entry.type === 'channel' ? 'Manage or delete this channel in Channels.' : 'Manage or uninstall this package in Extensions.'}</p>}
        </div> : null}
    </aside>;
}
function statusGroup(e) {
    if (e.stagedVersion) return 'Restart pending';
    if (e.revoked) return 'Needs attention';
    if (e.updateAvailable) return 'Updates available';
    return e.installedVersion ? 'Installed' : 'Available';
}
const STATUS_ORDER = ['Restart pending', 'Needs attention', 'Updates available', 'Installed', 'Available'];
function CatalogView({ catalog, tab, selectedId, onSelect, actions }) {
    const [search, setSearch] = React.useState('');
    const [typeFilter, setTypeFilter] = React.useState('');
    const [groupBy, setGroupBy] = React.useState(() => getPref('groupBy', 'status'));
    const [sortBy, setSortBy] = React.useState(() => getPref('sortBy', 'name'));
    const [collapsed, setCollapsed] = React.useState({});
    const visible = (catalog.entries || []).filter(e => e.installedVersion || e.stagedVersion || showsInWebUi(e));
    const entries = visible.filter(e => (tab === 'installed' ? e.installedVersion || e.stagedVersion
        : tab === 'updates' ? e.updateAvailable && !e.stagedVersion && !e.revoked : !e.revoked)
        && (!typeFilter || e.type === typeFilter)
        && `${e.name} ${e.description} ${e.repo} ${(e.keywords || []).join(' ')}`.toLowerCase().includes(search.toLowerCase()))
        .sort((a,b) => (sortBy === 'type' ? typeRank(a.type) - typeRank(b.type) : sortBy === 'status' ? STATUS_ORDER.indexOf(statusGroup(a)) - STATUS_ORDER.indexOf(statusGroup(b)) : 0) || a.name.localeCompare(b.name));
    const types = [...new Set(visible.map(e => e.type))].sort((a,b) => typeRank(a) - typeRank(b));
    const groups = new Map();
    for (const entry of entries) {
        const key = groupBy === 'type' ? entry.type : groupBy === 'status' ? statusGroup(entry) : 'All packages';
        if (!groups.has(key)) groups.set(key, []);
        groups.get(key).push(entry);
    }
    const orderedGroups = [...groups].sort(([a],[b]) => groupBy === 'type' ? typeRank(a)-typeRank(b) : groupBy === 'status' ? STATUS_ORDER.indexOf(a)-STATUS_ORDER.indexOf(b) : 0);
    const selected = visible.find(e => e.id === selectedId);
    return <div className="cs-catalog">
        <div className="cs-toolbar">
            <label className="cs-search"><input className="field" aria-label="Search packages" placeholder="Search community packages…" value={search} onChange={e => setSearch(e.target.value)} /></label>
            <select className="field" aria-label="Package type" value={typeFilter} onChange={e => setTypeFilter(e.target.value)}><option value="">All package types</option>{types.map(type => <option key={type} value={type}>{TYPE_LABELS[type] || type}</option>)}</select>
            <select className="field" aria-label="Group packages" value={groupBy} onChange={e => {setGroupBy(e.target.value);setPref('groupBy',e.target.value);}}><option value="status">Group by status</option><option value="type">Group by type</option><option value="none">No grouping</option></select>
            <select className="field" aria-label="Sort packages" value={sortBy} onChange={e => {setSortBy(e.target.value);setPref('sortBy',e.target.value);}}><option value="name">Sort by name</option><option value="type">Sort by type</option><option value="status">Sort by status</option></select>
            <span className="cs-result-count" role="status">{entries.length} package{entries.length === 1 ? '' : 's'}</span>
        </div>
        <div className="cs-workspace" tabIndex={0} aria-label="Package list">
            <table className="cs-table"><thead><tr><th scope="col">Package</th><th scope="col">Type</th><th scope="col">Installed</th><th scope="col">Available</th><th scope="col">Status</th></tr></thead>
                {orderedGroups.map(([key, items]) => <tbody key={key}>
                    {groupBy !== 'none' ? <tr className="cs-group"><th colSpan={5} scope="rowgroup"><button aria-expanded={!collapsed[groupBy+key]} onClick={() => setCollapsed(old => ({...old,[groupBy+key]:!old[groupBy+key]}))}><span aria-hidden="true">{collapsed[groupBy+key] ? '▸' : '▾'}</span> {groupBy === 'type' ? TYPE_LABELS[key] || key : key} <span className="cs-count">{items.length}</span></button></th></tr> : null}
                    {(groupBy === 'none' || !collapsed[groupBy+key]) && items.map(entry => <tr key={entry.id} className="cs-package-row" onClick={() => onSelect(entry.id)}>
                        <td><button className="cs-package" aria-haspopup="dialog" onClick={e => {e.stopPropagation();onSelect(entry.id);}}><PackageIcon type={entry.type} /><span><span className="cs-name">{entry.name}</span><span className="cs-description">{entry.description}</span></span></button></td>
                        <td>{TYPE_LABELS[entry.type] || entry.type}</td><td>{entry.installedVersion || '—'}</td><td>{entry.revoked ? '—' : entry.version}</td><td><PackageStatus entry={entry} /></td>
                    </tr>)}
                </tbody>)}
            </table>
            {!entries.length ? <div className="cs-empty">{search || typeFilter ? 'No matches. Try another search or package type.' : tab === 'updates' ? 'No updates available in the current catalog.' : tab === 'installed' ? 'No store packages are installed on this engine.' : 'No packages available. Check your sources and sync status in Settings.'}</div> : null}
        </div>
        {selected ? <ConfirmOverlay documentation closeLabel="Close package details" inactive={!!actions.overlay} title={selected.name} onCancel={() => onSelect(null)}><DetailView key={selected.id} entry={selected} actions={actions} /></ConfirmOverlay> : null}
    </div>;
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
        const source = newKind === 'catalog'
            ? { kind: 'catalog', url: value }
            : newKind === 'org'
                ? { kind: 'org', org: value, topic: newTopic.trim() || 'oie-plugin' }
                : { kind: 'repo', repo: value };
        setSettings({ ...settings, customSources: [...settings.customSources, source] });
        setNewValue('');
    };

    const describeSource = (s) => s.kind === 'catalog' ? `catalog: ${s.url}`
        : s.kind === 'org' ? `org: ${s.org} (topic: ${s.topic})` : `repo: ${s.repo}`;

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
                                    <td className="mono">{describeSource(s)}</td>
                                    <td className="text-text-dim">bundled</td><td></td>
                                </tr>
                            ))}
                            {settings.customSources.map((s, i) => (
                                <tr key={`c${i}`}>
                                    <td className="mono">{describeSource(s)}</td>
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
                            <option value="catalog">catalog</option>
                        </select>
                        <input className="field" style={{ maxWidth: newKind === 'catalog' ? 380 : 260 }} value={newValue} onChange={(e) => setNewValue(e.target.value)}
                            placeholder={newKind === 'catalog' ? 'https://…/index.json' : newKind === 'org' ? 'organization or user login' : 'owner/repository'} />
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
    const [selectedId, setSelectedId] = React.useState(null);
    const [completion, setCompletion] = React.useState(null);
    const [staged, setStaged] = React.useState({});
    const request = React.useRef(0);
    const refresh = async (force) => {
        const current = ++request.current;
        setLoading(true); setError(null);
        try {
            const data = await apiGet(`${BASE}/catalog?refresh=${force ? 'true' : 'false'}`);
            if (request.current !== current) return;
            setCatalog(data);
            setStaged(previous => Object.fromEntries(Object.entries(previous).filter(([id, version]) =>
                !(data.entries || []).some(e => e.id === id && e.installedVersion === version))));
        } catch (e) { if (request.current === current) setError(errText(e)); }
        finally { if (request.current === current) setLoading(false); }
    };
    React.useEffect(() => { refresh(false); return () => { request.current++; }; }, []);
    const actions = useStoreActions(refresh, result => {
        setCompletion(result);
        if (result.restartRequired) setStaged(previous => ({ ...previous, [result.entry.id]: result.entry.version }));
    });
    const data = catalog ? { ...catalog, entries: (catalog.entries || []).map(entry => ({...entry, stagedVersion: staged[entry.id]})) } : null;
    const visible = (data?.entries || []).filter(e => e.installedVersion || e.stagedVersion || showsInWebUi(e));
    const counts = {
        browse: visible.filter(e => !e.revoked).length,
        installed: visible.filter(e => e.installedVersion || e.stagedVersion).length,
        updates: visible.filter(e => e.updateAvailable && !e.stagedVersion && !e.revoked).length,
    };
    return <div className="view cs-store flex flex-col flex-1 min-h-0">
        <style>{STORE_CSS}</style>
        {actions.overlay}
        <div className="cs-header">
            <header className="cs-heading">
                <div><h1>Community Store</h1><p>Extend your engine. Make it your own.</p></div>
                <div className="cs-sync"><button className="btn" onClick={() => refresh(true)} disabled={loading || actions.busy}>{loading ? 'Syncing…' : '↻ Sync sources'}</button><div>{catalog ? `Engine ${catalog.engineVersion} · Synced ${new Date(catalog.generatedAt).toLocaleTimeString([], {hour:'2-digit', minute:'2-digit'})}` : 'Connecting to engine'}</div></div>
            </header>
            <nav className="cs-tabs" aria-label="Community Store views">
                {[['browse','Discover'],['installed','Installed'],['updates','Updates'], ...(canEditSettings() ? [['settings','Settings']] : [])].map(([id,label]) =>
                    <button key={id} className={`cs-tab ${tab === id ? 'active' : ''}`} aria-current={tab === id ? 'page' : undefined} onClick={() => setTab(id)}>{label}{id !== 'settings' && data ? <span className="cs-count">{counts[id]}</span> : null}</button>)}
            </nav>
        </div>
        <div className="view-body cs-body">
            {error ? <div className="cs-notice error" role="alert">Could not load the catalog: {error} <button className="btn btn-sm" onClick={() => refresh(true)} disabled={loading}>Retry</button></div> : null}
            {data?.errors?.length ? <div className="cs-notice warn" role="status"><strong>Some sources could not sync.</strong> Results may be incomplete.{data.errors.map((e,i) => <div key={i}>{e.source}: {e.message}</div>)}</div> : null}
            {completion ? <div className="cs-notice" role="status">{completion.restartRequired ? `${completion.entry.name} ${completion.entry.version} is staged. Restart the engine to activate it.` : completion.mode === 'remove' ? `${completion.entry.name} was removed.` : `${completion.entry.name} was imported${completion.mode === 'copy' ? ' as a copy' : ''}. It is available now.`} <button className="btn btn-sm" onClick={() => setCompletion(null)} aria-label="Dismiss result">Dismiss</button></div> : null}
            {tab === 'settings' && canEditSettings() ? <div className="cs-settings-scroll"><SettingsView catalog={catalog} onSaved={() => refresh(true)} /></div>
                : data ? <CatalogView catalog={data} tab={tab} selectedId={selectedId} onSelect={setSelectedId} actions={actions} />
                    : loading ? <div className="cs-empty" role="status">Loading community packages…</div> : null}
        </div>
    </div>;
}

/* ------------------------------------------------------------------ */
/* Registration                                                        */
/* ------------------------------------------------------------------ */

export function register() {
    platform.registerNavItem({
        id: 'community-store',
        label: 'Community Store',
        icon: 'store',
        path: '/community-store',
        section: 'Engine',
        order: 80,
        // The store's own task, declared in CommunityStoreServicePlugin's
        // ExtensionPermissions → "View Community Store". RBAC merges it via
        // /task-permissions; without RBAC the nav is always visible.
        task: 'doShowCommunityStore',
    });
    platform.registerView('/community-store', platform.reactView(CommunityStoreView), { title: 'Community Store' });
}
