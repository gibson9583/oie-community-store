/* Scoped to the plugin; all colors and typography follow the administrator theme. */
export const STORE_CSS = `
.cs-store { font-family: var(--font-ui); color: var(--text); }
.cs-store { min-height:0; overflow:hidden; }
.cs-store .cs-header { flex:none; padding:24px 24px 0; }
.cs-store .cs-body { padding:0 24px 24px; overflow:hidden; min-height:0; display:flex; flex-direction:column; }
.cs-store .cs-catalog { display:flex; flex-direction:column; flex:1; min-height:0; }
.cs-store .cs-toolbar { flex:none; }
.cs-store .cs-settings-scroll { overflow:auto; min-height:0; }
.cs-store .cs-body > .cs-notice { flex-shrink:0; max-height:25%; overflow:auto; }
.cs-store .cs-heading { display:flex; align-items:center; justify-content:space-between; gap:20px; margin-bottom:22px; }
.cs-store .cs-heading h1 { margin:0 0 4px; font-size:22px; font-weight:700; letter-spacing:-.7px; }
.cs-store .cs-heading p { margin:0; color:var(--text-dim); }
.cs-store .cs-sync { text-align:right; font-size:11px; color:var(--text-dim); }
.cs-store .cs-sync button { margin-bottom:6px; }
.cs-store .cs-tabs { display:flex; gap:24px; border-bottom:1px solid var(--line); margin-bottom:22px; }
.cs-store .cs-tab { padding:10px 0 13px; border:0; border-bottom:3px solid transparent; background:none; color:var(--text-dim); cursor:pointer; font:inherit; }
.cs-store .cs-tab.active { color:var(--accent); border-bottom-color:var(--accent); font-weight:650; }
.cs-store .cs-count { margin-left:6px; padding:2px 6px; border-radius:5px; font-size:11px; background:var(--accent-glow); }
.cs-store .cs-toolbar { display:flex; align-items:center; gap:12px; flex-wrap:wrap; margin-bottom:20px; }
.cs-store .cs-search { flex:1; min-width:180px; }
.cs-store .cs-search .field { width:100%; padding:11px 14px; }
.cs-store .cs-toolbar select { width:auto; max-width:230px; padding:10px 32px 10px 12px; }
.cs-store .cs-result-count { color:var(--text-dim); font-size:12px; white-space:nowrap; }
.cs-store .cs-workspace { overflow:auto; min-height:0; flex:1; border:1px solid var(--line); border-radius:8px; }
.cs-store .cs-package { width:100%; display:flex; gap:12px; align-items:center; text-align:left; border:0; padding:0; background:none; color:var(--text); font:inherit; cursor:pointer; }
.cs-store .cs-icon { flex-shrink:0; display:grid; place-items:center; width:44px; height:44px; border-radius:11px; border:1px solid var(--line); background:var(--accent-glow); color:var(--accent); }
.cs-store .cs-icon svg { width:23px; height:23px; }
.cs-store .cs-name { display:block; font-size:14px; font-weight:650; margin:0 0 5px; overflow-wrap:anywhere; }
.cs-store .cs-description { display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; color:var(--text-dim); font-size:12px; line-height:1.6; }
.cs-store .cs-meta { display:flex; gap:9px; flex-wrap:wrap; color:var(--text-dim); font-size:11px; margin-top:10px; overflow-wrap:anywhere; }
.cs-store .cs-pill { display:inline-block; border-radius:5px; padding:3px 8px; color:var(--text-dim); background:var(--bg3); font-size:11px; line-height:1.5; white-space:nowrap; }
.cs-store .cs-pill.update { color:var(--accent); background:var(--accent-glow); }
.cs-store .cs-pill.ok { color:var(--ok); background:color-mix(in srgb,var(--ok) 12%,transparent); }
.cs-store .cs-pill.warn { color:var(--warn); background:color-mix(in srgb,var(--warn) 12%,transparent); }
.cs-store .cs-pill.error { color:var(--err); background:color-mix(in srgb,var(--err) 12%,transparent); }
.cs-store .cs-detail { padding:0; min-width:0; }
.cs-store .cs-detail h2 { margin:16px 0 5px; font-size:21px; line-height:1.3; letter-spacing:-.4px; overflow-wrap:anywhere; }
.cs-store .cs-detail-description { color:var(--text-dim); line-height:1.7; margin:17px 0; }
.cs-store .cs-facts { border-top:1px solid var(--line); padding-top:12px; margin:20px 0; font-size:12px; }
.cs-store .cs-fact { display:flex; gap:12px; justify-content:space-between; padding:7px 0; }
.cs-store .cs-fact dt { color:var(--text-dim); }
.cs-store .cs-fact dd { margin:0; text-align:right; overflow-wrap:anywhere; min-width:0; }
.cs-store .cs-notice { padding:12px 14px; background:var(--bg2); border:1px solid var(--line); border-radius:8px; margin-bottom:15px; font-size:12px; overflow-wrap:anywhere; }
.cs-store .cs-notice.warn { color:var(--warn); border-color:color-mix(in srgb,var(--warn) 30%,var(--line)); }
.cs-store .cs-notice.error { color:var(--err); border-color:color-mix(in srgb,var(--err) 30%,var(--line)); }
.cs-store .cs-primary-action { width:100%; justify-content:center; padding:11px; }
.cs-store .cs-package-info { font-size:12px; margin-top:18px; }
.cs-store .cs-package-info summary { cursor:pointer; color:var(--text-dim); }
.cs-store .cs-detail-links { display:flex; gap:14px; flex-wrap:wrap; margin-top:18px; font-size:12px; }
.cs-store .cs-detail-links a { overflow-wrap:anywhere; }
.cs-store .cs-footnote { font-size:11px; line-height:1.6; color:var(--text-dim); margin:12px 0; }
.cs-store .cs-empty { padding:28px; color:var(--text-dim); }
.cs-store .cs-docs-toggle { width:100%; text-align:left; margin-top:20px; }
.cs-store .tag { white-space:nowrap; }
.cs-store .cs-docs { font-size:12px; }
.cs-store button:focus-visible, .cs-store a:focus-visible { outline:2px solid var(--accent); outline-offset:3px; }
.cs-store .cs-package:focus-visible { outline-offset:-3px; }
.cs-store .cs-overlay { position:fixed; inset:0; display:flex; align-items:center; justify-content:center; background:rgba(0,0,0,.5); z-index:1000; padding:20px; }
.cs-store .cs-dialog { width:500px; max-width:100%; max-height:90vh; overflow:auto; box-shadow:var(--shadow); }
.cs-store .cs-documentation-dialog { width:1000px; height: min(85vh,900px); display:flex; flex-direction:column; overflow:hidden; }
.cs-store .cs-documentation-dialog > .panel-header { flex:none; display:flex; align-items:center; justify-content:space-between; gap:16px; }
.cs-store .cs-documentation-dialog > .panel-body { overflow:auto; min-height:0; flex:1; }
.cs-store .cs-documentation-dialog .cs-docs { font-size:14px; line-height:1.7; }
.cs-store .cs-documentation-dialog .panel { margin:0; border:0; box-shadow:none; }
.cs-store .cs-dialog-actions { display:flex; gap:8px; justify-content:flex-end; flex-wrap:wrap; margin-top:20px; }
.cs-store .cs-dialog .field { max-width:100% !important; }
.cs-store .cs-table { width:100%; border-collapse:separate; border-spacing:0; text-align:left; }
.cs-store .cs-table th, .cs-store .cs-table td { padding:12px 16px; border-bottom:1px solid var(--line); font-size:12px; }
.cs-store .cs-table thead th { position:sticky; top:0; z-index:1; background:var(--bg2); color:var(--text-dim); white-space:nowrap; }
.cs-store .cs-sort-heading { border:0; padding:0; background:none; color:inherit; font:inherit; font-weight:600; cursor:pointer; text-align:left; width:100%; }
.cs-store .cs-table td:first-child { width:52%; min-width:260px; }
.cs-store .cs-table td:not(:first-child) { white-space:nowrap; }
.cs-store .cs-package-row { background:var(--bg1); cursor:pointer; }
.cs-store .cs-package-row:hover { background:var(--bg2); }
.cs-store .cs-group th { background:var(--bg2); padding:0; }
.cs-store .cs-group button { width:100%; padding:12px 16px; text-align:left; border:0; background:none; color:var(--text); font:inherit; cursor:pointer; }
.cs-store .cs-table .cs-icon { width:30px; height:30px; border:0; border-radius:0; background:none; }
@media(max-width:800px) { .cs-store .cs-workspace { overflow:auto; min-height:0; flex:1; border:1px solid var(--line); border-radius:8px; } .cs-store .cs-body { padding:0 16px 16px; } .cs-store .cs-header { padding:16px 16px 0; } .cs-store .cs-tabs { gap:18px; flex-wrap:wrap; } .cs-store .cs-heading { align-items:flex-start; } .cs-store .cs-search { min-width:100%; } }
`;
