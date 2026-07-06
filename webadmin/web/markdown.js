/*
 * Markdown rendering for publisher documentation.
 *
 * Third-party markdown rendered inside an admin session is an XSS vector, so this
 * module is the single, dependency-free (marked only) place that turns publisher
 * markdown into HTML safe to inject:
 *
 *   - raw HTML in the source is escaped, never passed through (block AND inline);
 *   - link and image URLs are protocol-allowlisted (javascript:, data:, etc. dropped);
 *   - relative paths resolve against the repo at the release tag (blob for links,
 *     raw for images) so docs stay version-pinned;
 *   - external links open in a new tab with no opener reference.
 *
 * It is deliberately isolated from the React shell so it can be unit-tested in
 * plain node (see markdown.test.mjs). If you change anything here, run that test —
 * the whole anti-XSS guarantee rests on this file.
 */

import { Marked } from 'marked';

export function escapeHtml(value) {
    return String(value)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

/**
 * Resolve a link/image target from publisher markdown to something safe to emit.
 * Absolute http(s)/mailto and in-page fragments pass through; any other explicit
 * scheme (javascript:, data:, vbscript:, file:, …) and protocol-relative URLs are
 * dropped; everything else is treated as a repo-relative path against `base`.
 */
export function resolveDocUrl(href, base) {
    if (!href) return '';
    const value = String(href).trim();
    if (/^(https?:|mailto:)/i.test(value) || value.startsWith('#')) return value;
    if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('//')) return ''; // block javascript:, data:, protocol-relative
    return base + value.replace(/^\.?\//, '');
}

/**
 * Render publisher markdown to sanitized HTML. `repo` is "owner/name" and `tag`
 * is the release tag; relative links/images resolve against that repo at that tag.
 *
 * `images` is an optional { relativePath -> dataUrl } map the backend supplies: it
 * fetches the repo's doc images server side and inlines them as data: URLs, because
 * the admin's CSP blocks external image hosts (img-src 'self' data:) and the browser
 * has no credentials for the artifact host. A referenced image present in the map
 * renders from that (trusted, raster-only) data URL; anything else falls back to the
 * resolved base URL.
 *
 * `bases` optionally overrides the GitHub-derived resolution bases — catalog-index
 * docs live at an absolute docsUrl on any host, so the backend supplies
 * { linkBase, imageBase } (the docsUrl's directory) instead.
 */
export function renderDocsHtml(markdown, repo, tag, images, bases) {
    const rawBase = (bases && bases.imageBase) || `https://raw.githubusercontent.com/${repo}/${tag}/`;
    const blobBase = (bases && bases.linkBase) || `https://github.com/${repo}/blob/${tag}/`;
    const imageMap = images || {};
    const md = new Marked();
    md.use({
        gfm: true,
        walkTokens(token) {
            if (token.type === 'link') token.href = resolveDocUrl(token.href, blobBase);
            if (token.type === 'image') {
                const key = String(token.href || '').trim().replace(/^\.?\//, '');
                token.href = Object.prototype.hasOwnProperty.call(imageMap, key)
                    ? imageMap[key]
                    : resolveDocUrl(token.href, rawBase);
            }
        },
        renderer: {
            // Raw HTML (block and inline) is escaped rather than emitted, so publisher
            // markup can never introduce a live element into the admin DOM.
            html(token) {
                const raw = token && typeof token === 'object'
                    ? (token.text != null ? token.text : token.raw)
                    : token;
                return escapeHtml(raw != null ? raw : '');
            },
        },
    });
    let html = md.parse(markdown, { async: false });
    // External links open in a new tab without an opener reference.
    html = html.replace(/<a href="(https?:[^"]*)"/g, '<a target="_blank" rel="noopener noreferrer" href="$1"');
    return html;
}
