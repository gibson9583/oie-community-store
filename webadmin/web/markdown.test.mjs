/*
 * Anti-XSS tests for the publisher-documentation renderer. The entire safety
 * guarantee of the docs panel rests on markdown.js neutralizing untrusted
 * publisher markdown, so these lock the behavior against regressions (e.g. a
 * marked upgrade that changes how raw HTML tokenizes).
 *
 * Run: node web/markdown.test.mjs   (from webadmin/, after `npm install`)
 */

import assert from 'node:assert';
import { renderDocsHtml, resolveDocUrl, escapeHtml } from './markdown.js';

const REPO = 'acme/oie-widget';
const TAG = 'v1.2.3';
const render = (md) => renderDocsHtml(md, REPO, TAG);

let failures = 0;
function test(name, fn) {
    try { fn(); console.log('  ok  -', name); }
    catch (e) { failures++; console.error('  FAIL -', name, '\n      ', e.message); }
}

console.log('markdown.test.mjs');

/* ---- raw HTML is escaped, never emitted live ---- */

test('block <script> is escaped, not executed', () => {
    const html = render('# Title\n\n<script>alert(document.cookie)</script>\n');
    assert.ok(!/<script/i.test(html), 'a live <script> tag leaked through');
    assert.ok(html.includes('&lt;script&gt;'), 'script was not escaped');
});

test('inline <img onerror=...> is escaped', () => {
    const html = render('Hello <img src=x onerror=alert(1)> world');
    assert.ok(!/<img/i.test(html), 'a live <img> tag leaked through');
    assert.ok(html.includes('&lt;img'), 'inline html was not escaped');
});

test('inline event-handler markup on a span is escaped', () => {
    const html = render('text <span onmouseover="alert(1)">x</span>');
    assert.ok(!/onmouseover=/i.test(html) || html.includes('&lt;span'), 'inline event handler leaked');
    assert.ok(!/<span/i.test(html), 'a live <span> tag leaked through');
});

test('svg/iframe/object payloads are escaped', () => {
    for (const payload of ['<svg onload=alert(1)>', '<iframe src=javascript:alert(1)>', '<object data=x>']) {
        const html = render(`before ${payload} after`);
        assert.ok(!/<(svg|iframe|object)/i.test(html), `${payload} leaked through`);
    }
});

/* ---- link/image protocols are allowlisted ---- */

test('javascript: link is dropped', () => {
    const html = render('[click me](javascript:alert(1))');
    assert.ok(!/href="javascript:/i.test(html), 'javascript: href survived');
});

test('data: and vbscript: links are dropped', () => {
    for (const scheme of ['data:text/html,<script>alert(1)</script>', 'vbscript:msgbox(1)', 'file:///etc/passwd']) {
        const html = render(`[x](${scheme})`);
        assert.ok(!new RegExp(`href="${scheme.split(':')[0]}:`, 'i').test(html), `${scheme} survived`);
    }
});

test('data: image is dropped', () => {
    const html = render('![x](data:image/svg+xml,<svg onload=alert(1)>)');
    assert.ok(!/src="data:/i.test(html), 'data: image src survived');
});

test('whitespace/case-obfuscated javascript: is dropped', () => {
    for (const href of ['  JavaScript:alert(1)', 'JAVASCRIPT:alert(1)']) {
        assert.strictEqual(resolveDocUrl(href, 'https://github.com/acme/oie-widget/blob/v1/'), '');
    }
});

/* ---- legitimate content still renders ---- */

test('https link is kept and opens in a new tab safely', () => {
    const html = render('[docs](https://example.com/guide)');
    assert.ok(html.includes('href="https://example.com/guide"'), 'https link was dropped');
    assert.ok(/rel="noopener noreferrer"/.test(html), 'external link missing rel=noopener');
    assert.ok(/target="_blank"/.test(html), 'external link missing target=_blank');
});

test('relative link resolves against the repo blob at the tag', () => {
    const html = render('[changelog](./CHANGELOG.md)');
    assert.ok(html.includes(`href="https://github.com/${REPO}/blob/${TAG}/CHANGELOG.md"`), 'relative link not pinned to repo@tag');
});

test('relative image resolves against raw content at the tag', () => {
    const html = render('![diagram](docs/arch.png)');
    assert.ok(html.includes(`src="https://raw.githubusercontent.com/${REPO}/${TAG}/docs/arch.png"`), 'relative image not pinned to raw@tag');
});

test('a mapped relative image renders from the backend-provided data URL', () => {
    const html = renderDocsHtml('![shot](docs/a.png)', REPO, TAG, { 'docs/a.png': 'data:image/png;base64,AAAA' });
    assert.ok(html.includes('src="data:image/png;base64,AAAA"'), 'mapped image did not use the data URL');
});

test('a ./-prefixed reference matches the map key', () => {
    const html = renderDocsHtml('![shot](./docs/a.png)', REPO, TAG, { 'docs/a.png': 'data:image/png;base64,BBBB' });
    assert.ok(html.includes('src="data:image/png;base64,BBBB"'), './-prefixed image did not match the map key');
});

test('an unmapped relative image falls back to the raw GitHub URL', () => {
    const html = renderDocsHtml('![shot](docs/b.png)', REPO, TAG, {});
    assert.ok(html.includes(`src="https://raw.githubusercontent.com/${REPO}/${TAG}/docs/b.png"`), 'unmapped image not pinned to raw@tag');
});

test('an explicit data: image reference is still dropped when not from the map', () => {
    const html = renderDocsHtml('![x](data:image/svg+xml,<svg onload=alert(1)>)', REPO, TAG, {});
    assert.ok(!/src="data:/i.test(html), 'a publisher-authored data: image survived');
});

test('in-page fragment link is preserved', () => {
    const html = render('[top](#overview)');
    assert.ok(html.includes('href="#overview"'), 'fragment link was dropped');
});

test('ordinary markdown (headings, code, tables) renders', () => {
    const html = render('# H1\n\n`inline code`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n');
    assert.ok(/<h1/.test(html) && /<code>/.test(html) && /<table/.test(html), 'basic markdown did not render');
});

test('escapeHtml neutralizes the five significant characters', () => {
    assert.strictEqual(escapeHtml(`<>&"'`), '&lt;&gt;&amp;&quot;&#39;');
});

if (failures) { console.error(`\n${failures} test(s) failed`); process.exit(1); }
console.log('  all passed');
