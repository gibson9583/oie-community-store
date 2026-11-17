/* Scoped to the plugin; all colors and typography follow the administrator theme. */
export const STORE_CSS = `
.cs-store { font-family: var(--font-ui); color: var(--text); min-height:0; overflow:hidden; }
.cs-store .cs-header { flex:none; display:flex; align-items:center; gap:10px; flex-wrap:wrap; padding:10px 16px 0; }
.cs-store .cs-tabs { margin:0; }
.cs-store .cs-count { margin-left:6px; font-family:var(--font-mono); font-size:10px; color:var(--text-faint); }
.cs-store .cs-sync { margin-left:auto; font-size:10.5px; color:var(--text-faint); white-space:nowrap; }
.cs-store .cs-body { padding:10px 16px 14px; overflow:hidden; min-height:0; display:flex; flex-direction:column; }
.cs-store .cs-catalog { display:flex; flex-direction:column; flex:1; min-height:0; }
.cs-store .cs-settings-scroll { overflow:auto; min-height:0; }
.cs-store .cs-body > .cs-notice { flex-shrink:0; max-height:25%; overflow:auto; }
.cs-store .cs-toolbar { flex:none; display:flex; align-items:center; gap:8px; flex-wrap:wrap; margin-bottom:10px; }
.cs-store .cs-search { position:relative; flex:1; min-width:200px; max-width:420px; }
.cs-store .cs-search input { padding-right:30px; }
.cs-store .cs-search-clear { position:absolute; right:3px; top:50%; transform:translateY(-50%); }
.cs-store .cs-toolbar select { width:auto; max-width:230px; }
.cs-store .cs-result-count { margin-left:auto; color:var(--text-faint); font-family:var(--font-mono); font-size:10px; white-space:nowrap; }
.cs-store .cs-grid { flex:1; min-height:0; display:flex; flex-direction:column; }
.cs-store .cs-grid > .dt-wrap { flex:1; min-height:0; }
.cs-store .cs-package-row { cursor:pointer; }
.cs-store .cs-package { display:flex; align-items:center; gap:8px; max-width:100%; min-width:0; border:0; padding:0; background:none; color:var(--text); font:inherit; cursor:pointer; text-align:left; }
.cs-store .cs-name { font-weight:600; white-space:nowrap; }
.cs-store .cs-description { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:var(--text-faint); }
.cs-store .cs-group-toggle { width:100%; border:0; padding:0; background:none; color:inherit; font:inherit; text-align:left; cursor:pointer; }
.cs-store .cs-tags { display:inline-flex; gap:4px; flex-wrap:wrap; }
.cs-store .cs-table .cs-tags { flex-wrap:nowrap; }
.cs-store .tag.ok { color:var(--ok); border-color:color-mix(in srgb,var(--ok) 40%,transparent); background:color-mix(in srgb,var(--ok) 10%,transparent); }
.cs-store .cs-icon { flex-shrink:0; display:grid; place-items:center; width:32px; height:32px; border-radius:8px; border:1px solid var(--line); background:var(--accent-glow); color:var(--accent); }
.cs-store .cs-icon svg { width:18px; height:18px; }
.cs-store .cs-table .cs-icon { width:16px; height:16px; border:0; border-radius:0; background:none; }
.cs-store .cs-table .cs-icon svg { width:15px; height:15px; }
.cs-store .cs-detail { min-width:0; font-size:12px; }
.cs-store .cs-detail-title { display:flex; align-items:center; gap:10px; }
.cs-store .cs-detail h2 { margin:0; font-size:16px; line-height:1.3; letter-spacing:-.2px; overflow-wrap:anywhere; }
.cs-store .cs-meta { display:flex; align-items:center; gap:10px; flex-wrap:wrap; margin-top:6px; color:var(--text-dim); font-size:11px; overflow-wrap:anywhere; }
.cs-store .cs-detail-description { color:var(--text-dim); line-height:1.6; margin:10px 0 12px; }
.cs-store .cs-decide { border:1px solid var(--line); border-radius:var(--radius); background:var(--bg2); padding:10px 12px; margin-bottom:12px; }
.cs-store .cs-flow { font-family:var(--font-mono); font-size:12px; margin-bottom:8px; }
.cs-store .cs-flow-to { color:var(--accent); }
.cs-store .cs-dim { color:var(--text-faint); }
.cs-store .cs-facts { margin:0 0 10px; font-size:11.5px; }
.cs-store .cs-fact { display:grid; grid-template-columns:170px 1fr; gap:12px; padding:3px 0; }
.cs-store .cs-fact dt { color:var(--text-dim); }
.cs-store .cs-fact dd { margin:0; min-width:0; overflow-wrap:anywhere; }
.cs-store .cs-notice { padding:8px 12px; background:var(--bg2); border:1px solid var(--line); border-radius:var(--radius); margin-bottom:10px; font-size:11.5px; overflow-wrap:anywhere; }
.cs-store .cs-notice.warn { color:var(--warn); border-color:color-mix(in srgb,var(--warn) 35%,var(--line)); }
.cs-store .cs-notice.error { color:var(--err); border-color:color-mix(in srgb,var(--err) 35%,var(--line)); }
.cs-store .cs-package-info { font-size:11.5px; margin:10px 0; }
.cs-store .cs-package-info summary { cursor:pointer; color:var(--text-dim); }
.cs-store .cs-package-info .cs-facts { margin-top:8px; }
.cs-store .cs-detail-links { display:flex; gap:14px; flex-wrap:wrap; margin:10px 0; font-size:11.5px; }
.cs-store .cs-detail-links a { overflow-wrap:anywhere; }
.cs-store .cs-footnote { font-size:10.5px; line-height:1.55; color:var(--text-faint); margin:6px 0 0; }
.cs-store .cs-manage { border-top:1px solid var(--line); margin-top:14px; padding-top:12px; }
.cs-store .cs-empty { padding:28px; color:var(--text-dim); }
.cs-store .cs-docs-toggle { margin-top:6px; }
.cs-store .cs-docs { font-size:12px; }
.cs-store button:focus-visible, .cs-store a:focus-visible, .cs-store th:focus-visible { outline:2px solid var(--accent); outline-offset:-2px; }
.cs-store .cs-documentation-dialog { height:min(85vh,900px); }
.cs-store .cs-documentation-dialog > .modal-body { flex:1; min-height:0; }
.cs-store .cs-documentation-dialog .cs-docs { font-size:13px; line-height:1.65; }
.cs-store .cs-close { margin-left:auto; }
.cs-store .cs-dialog .modal-body { font-size:12px; line-height:1.55; }
.cs-store .modal input:not([type=radio]), .cs-store .modal select { max-width:100% !important; }
@media(max-width:800px) { .cs-store .cs-body { padding:8px 10px 10px; } .cs-store .cs-header { padding:8px 10px 0; } .cs-store .cs-sync { margin-left:0; } .cs-store .cs-search { min-width:100%; } .cs-store .cs-fact { grid-template-columns:130px 1fr; } }
`;
