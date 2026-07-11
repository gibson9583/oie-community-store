/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

/**
 * Anti-XSS tests for {@link DocsMarkdown}, mirroring webadmin/web/markdown.test.mjs. The
 * docs panel's safety guarantee rests on DocsMarkdown neutralizing untrusted publisher
 * markdown, so these lock the behavior against regressions. Plain main class — this build
 * has no test framework.
 *
 * Run:
 *   mvn -q -ntp test-compile
 *   java -cp target/classes:target/test-classes \
 *       org.openintegrationengine.plugins.communitystore.ui.DocsMarkdownTest
 */
public final class DocsMarkdownTest {

    private static int failures = 0;

    public static void main(String[] args) {
        System.out.println("DocsMarkdownTest");

        /* ---- raw HTML is escaped, never emitted live ---- */

        test("block <script> is escaped, not executed", () -> {
            String html = DocsMarkdown.toHtml("# Title\n\n<script>alert(document.cookie)</script>\n");
            assertTrue(!html.toLowerCase().contains("<script"), "a live <script> tag leaked through");
            assertTrue(html.contains("&lt;script&gt;"), "script was not escaped");
        });

        test("inline <img onerror=...> is escaped", () -> {
            String html = DocsMarkdown.toHtml("Hello <img src=x onerror=alert(1)> world");
            assertTrue(!html.toLowerCase().contains("<img"), "a live <img> tag leaked through");
            assertTrue(html.contains("&lt;img"), "inline html was not escaped");
        });

        test("inline event-handler markup on a span is escaped", () -> {
            String html = DocsMarkdown.toHtml("text <span onmouseover=\"alert(1)\">x</span>");
            assertTrue(!html.toLowerCase().contains("<span"), "a live <span> tag leaked through");
            assertTrue(html.contains("&lt;span"), "inline html was not escaped");
        });

        test("svg/iframe/object payloads are escaped", () -> {
            for (String payload : new String[] {
                    "<svg onload=alert(1)>", "<iframe src=javascript:alert(1)>", "<object data=x>" }) {
                String html = DocsMarkdown.toHtml("before " + payload + " after").toLowerCase();
                assertTrue(!html.contains("<svg") && !html.contains("<iframe") && !html.contains("<object"),
                        payload + " leaked through");
            }
        });

        /* ---- link protocols are allowlisted to http/https ---- */

        test("javascript: link is dropped to plain label text", () -> {
            String html = DocsMarkdown.toHtml("[click me](javascript:alert(1))");
            assertTrue(!html.toLowerCase().contains("href=\"javascript:"), "javascript: href survived");
            assertTrue(!html.contains("<a "), "an anchor was emitted for a blocked scheme");
            assertTrue(html.contains("click me"), "the label text was lost");
        });

        test("data:, vbscript: and file: links are dropped", () -> {
            for (String target : new String[] {
                    "data:text/html,<script>alert(1)</script>", "vbscript:msgbox(1)", "file:///etc/passwd" }) {
                String html = DocsMarkdown.toHtml("[x](" + target + ")").toLowerCase();
                assertTrue(!html.contains("href=\"data:") && !html.contains("href=\"vbscript:")
                        && !html.contains("href=\"file:"), target + " survived");
            }
        });

        test("whitespace/case-obfuscated javascript: is dropped", () -> {
            for (String href : new String[] { "  JavaScript:alert(1)", "JAVASCRIPT:alert(1)" }) {
                String html = DocsMarkdown.toHtml("[x](" + href + ")");
                assertTrue(!html.toLowerCase().contains("javascript:"), href + " survived");
                assertTrue(!html.contains("<a "), "an anchor was emitted for " + href);
            }
        });

        test("mailto:, #fragment and relative links are demoted to plain text (Swing port)", () -> {
            for (String target : new String[] { "mailto:a@b.c", "#overview", "./CHANGELOG.md", "//evil.example" }) {
                String html = DocsMarkdown.toHtml("[label](" + target + ")");
                assertTrue(!html.contains("<a "), target + " produced an anchor");
                assertTrue(html.contains("label"), "the label text was lost for " + target);
            }
        });

        /* ---- images never render ---- */

        test("image is stripped to [image: alt] text", () -> {
            String html = DocsMarkdown.toHtml("![diagram](https://example.com/a.png)");
            assertTrue(!html.toLowerCase().contains("<img"), "an <img> tag was emitted");
            assertTrue(html.contains("[image: diagram]"), "alt text placeholder missing");
        });

        test("image with empty alt becomes [image]", () -> {
            String html = DocsMarkdown.toHtml("![](https://example.com/a.png)");
            assertTrue(html.contains("[image]"), "empty-alt placeholder missing");
        });

        test("data: image is never emitted", () -> {
            String html = DocsMarkdown.toHtml("![x](data:image/svg+xml,<svg onload=alert(1)>)");
            assertTrue(!html.toLowerCase().contains("<img") && !html.toLowerCase().contains("src=\"data:"),
                    "a data: image survived");
            assertTrue(html.contains("[image: x]"), "alt text placeholder missing");
        });

        /* ---- legitimate content still renders ---- */

        test("https link is kept", () -> {
            String html = DocsMarkdown.toHtml("[docs](https://example.com/guide)");
            assertTrue(html.contains("<a href=\"https://example.com/guide\">docs</a>"), "https link was dropped");
        });

        test("ampersands in a kept URL are escaped exactly once in the attribute", () -> {
            String html = DocsMarkdown.toHtml("[q](https://example.com/?a=1&b=2)");
            assertTrue(html.contains("href=\"https://example.com/?a=1&amp;b=2\""), "URL was double- or un-escaped");
        });

        test("bare URLs are autolinked", () -> {
            String html = DocsMarkdown.toHtml("see https://example.com/x for details");
            assertTrue(html.contains("<a href=\"https://example.com/x\">https://example.com/x</a>"),
                    "bare URL was not autolinked");
        });

        test("ordinary markdown (headings, code, tables) renders", () -> {
            String html = DocsMarkdown.toHtml("# H1\n\n`inline code`\n\n| a | b |\n|---|---|\n| 1 | 2 |\n");
            assertTrue(html.contains("<h1>"), "heading did not render");
            assertTrue(html.contains("<code>inline code</code>"), "inline code did not render");
            assertTrue(html.contains("<table border=\"0\">") && html.contains("<td><b>a</b></td>")
                    && html.contains("<td>1</td>"), "table did not render");
        });

        test("md h5/h6 map to h4 for HTMLEditorKit", () -> {
            String html = DocsMarkdown.toHtml("##### five\n\n###### six");
            assertTrue(html.contains("<h4>five</h4>") && html.contains("<h4>six</h4>"), "h5/h6 not mapped to h4");
        });

        test("unordered and ordered lists render, with one nesting level", () -> {
            String html = DocsMarkdown.toHtml("- a\n- b\n  - b1\n\n1. one\n2. two\n");
            assertTrue(html.contains("<ul><li>a</li><li>b<ul><li>b1</li></ul></li></ul>"),
                    "nested unordered list did not render: " + html);
            assertTrue(html.contains("<ol><li>one</li><li>two</li></ol>"), "ordered list did not render");
        });

        test("bold and italic render as <b>/<i>", () -> {
            String html = DocsMarkdown.toHtml("**bold** and *italic* and __also bold__ and _also italic_");
            assertTrue(html.contains("<b>bold</b>") && html.contains("<i>italic</i>")
                    && html.contains("<b>also bold</b>") && html.contains("<i>also italic</i>"),
                    "emphasis did not render: " + html);
        });

        test("blockquote and hr render", () -> {
            String html = DocsMarkdown.toHtml("> quoted\n\n---\n");
            assertTrue(html.contains("<blockquote><p>quoted</p></blockquote>"), "blockquote did not render");
            assertTrue(html.contains("<hr>"), "hr did not render");
        });

        test("fenced code is escape-only — no inline processing inside", () -> {
            String html = DocsMarkdown.toHtml("```\n<b>**x**</b>\n```\n");
            assertTrue(html.contains("<pre><code>&lt;b&gt;**x**&lt;/b&gt;\n</code></pre>"),
                    "fence content was transformed: " + html);
        });

        test("inline code content is exempt from the other inline transforms", () -> {
            String html = DocsMarkdown.toHtml("use `**not bold** [x](https://a.b)` here");
            assertTrue(html.contains("<code>**not bold** [x](https://a.b)</code>"),
                    "inline code content was transformed: " + html);
        });

        test("underscores in a kept URL are not italicized", () -> {
            String html = DocsMarkdown.toHtml("[x](https://example.com/_some_path_)");
            assertTrue(html.contains("href=\"https://example.com/_some_path_\""), "href was mangled: " + html);
        });

        test("escapeHtml neutralizes the five significant characters", () -> {
            assertEquals("&lt;&gt;&amp;&quot;&#39;", DocsMarkdown.escapeHtml("<>&\"'"));
        });

        test("toHtml wraps in <html><body>", () -> {
            String html = DocsMarkdown.toHtml("hi");
            assertTrue(html.startsWith("<html><body>") && html.endsWith("</body></html>"), "missing wrapper");
        });

        if (failures > 0) {
            System.err.println("\n" + failures + " test(s) failed");
            System.exit(1);
        }
        System.out.println("  all passed");
    }

    private static void test(String name, Runnable body) {
        try {
            body.run();
            System.out.println("  ok  - " + name);
        } catch (AssertionError e) {
            failures++;
            System.err.println("  FAIL - " + name + "\n       " + e.getMessage());
        }
    }

    private static void assertTrue(boolean condition, String message) {
        if (!condition) {
            throw new AssertionError(message);
        }
    }

    private static void assertEquals(String expected, String actual) {
        if (!expected.equals(actual)) {
            throw new AssertionError("expected <" + expected + "> but was <" + actual + ">");
        }
    }
}
