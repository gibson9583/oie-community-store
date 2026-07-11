/*
 * OIE Community Store — Swing Administrator client.
 *
 * Published under the terms of the Mozilla Public License 2.0.
 */

package org.openintegrationengine.plugins.communitystore.ui;

import java.util.ArrayList;
import java.util.List;
import java.util.function.Function;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Minimal markdown → HTML converter for the publisher documentation panel — a
 * dependency-free Swing port of {@code webadmin/web/markdown.js}, targeting the HTML 3.2
 * subset that {@code HTMLEditorKit} renders reliably.
 *
 * <p>Third-party markdown rendered inside the Administrator is an injection vector, so the
 * same security rules as the web renderer apply:
 *
 * <ul>
 *   <li>every character of publisher input is escaped ({@code &} first, then {@code <},
 *       {@code >}, {@code "}, {@code '}) <b>before</b> any tag is emitted around it, so raw
 *       HTML in the source — block and inline — always renders as text and the only live
 *       tags in the output are ones this class constructs;</li>
 *   <li>link URLs are protocol-allowlisted after {@code trim()}, case-insensitively, to
 *       {@code http:}/{@code https:} only. {@code javascript:}, {@code data:},
 *       {@code vbscript:}, {@code file:} and protocol-relative URLs are dropped, and —
 *       unlike the web renderer, which has a repo/tag base to resolve against —
 *       {@code mailto:}, {@code #fragment} and relative targets are demoted too: the link
 *       renders as its plain label text with no anchor;</li>
 *   <li>no attribute value is ever built from unescaped input;</li>
 *   <li>images never render: they are stripped to {@code [image: alt]} text, because
 *       data-URI images are unreliable in Swing text components and fetching remote images
 *       from the admin is undesirable.</li>
 * </ul>
 *
 * <p>Supported transforms: headings h1–h4 (md h5/h6 map to h4), bold/italic (as
 * {@code <b>}/{@code <i>}), inline code, fenced code blocks (escape-only, no inline
 * processing inside), unordered/ordered lists with one nesting level, links, autolinked
 * bare http(s) URLs, GFM pipe tables (header cells as {@code <td><b>}; HTMLEditorKit
 * renders {@code <th>} inconsistently), blockquotes, horizontal rules and paragraphs.
 * GFM extras (strikethrough, task lists, autolinked emails) are out of scope and render
 * literally.
 *
 * <p>See {@code DocsMarkdownTest} (plain main class mirroring
 * {@code webadmin/web/markdown.test.mjs}) — run it if you change anything here.
 */
final class DocsMarkdown {

    private static final Pattern HEADING = Pattern.compile("^(#{1,6})\\s+(.*)$");
    private static final Pattern TRAILING_HASHES = Pattern.compile("\\s+#+\\s*$");
    private static final Pattern HR = Pattern.compile("^\\s{0,3}(-{3,}|\\*{3,}|_{3,})\\s*$");
    private static final Pattern LIST_ITEM = Pattern.compile("^(\\s*)([-*+]|\\d+[.)])\\s+(.*)$");
    private static final Pattern TABLE_DELIMITER = Pattern.compile("^\\s*\\|?[\\s:|-]+\\|?\\s*$");

    private static final Pattern INLINE_CODE = Pattern.compile("`([^`]+)`");
    private static final Pattern IMAGE = Pattern.compile("!\\[([^\\]]*)\\]\\(([^)]*)\\)");
    private static final Pattern LINK = Pattern.compile("\\[([^\\]]+)\\]\\(\\s*([^)\\s]*)(?:\\s+[^)]*)?\\)");
    private static final Pattern AUTOLINK = Pattern.compile("(?i)\\bhttps?://\\S+");
    private static final Pattern BOLD_STAR = Pattern.compile("\\*\\*(.+?)\\*\\*");
    private static final Pattern BOLD_UNDERSCORE = Pattern.compile("__(.+?)__");
    private static final Pattern ITALIC_STAR = Pattern.compile("\\*([^*\\n]+)\\*");
    private static final Pattern ITALIC_UNDERSCORE = Pattern.compile("\\b_([^_\\n]+)_\\b");
    private static final Pattern ALLOWED_URL = Pattern.compile("(?i)^https?:");

    private DocsMarkdown() {}

    /** Render publisher markdown to a complete sanitized HTML document. */
    static String toHtml(String markdown) {
        return "<html><body>" + toBodyHtml(markdown) + "</body></html>";
    }

    /** Render publisher markdown to sanitized HTML block content, without the document wrapper. */
    static String toBodyHtml(String markdown) {
        String source = markdown == null ? "" : markdown
                .replace("\r\n", "\n")
                .replace('\r', '\n')
                // The inline pass uses \u0001<n>\u0002 placeholders; make sure publisher
                // input can never collide with them.
                .replace("\u0001", "")
                .replace("\u0002", "");
        StringBuilder out = new StringBuilder();
        renderBlocks(source.split("\n", -1), out);
        return out.toString();
    }

    /** The web renderer's five-character escape — {@code &} first, always before any tag is emitted. */
    static String escapeHtml(String value) {
        if (value == null) {
            return "";
        }
        return value
                .replace("&", "&amp;")
                .replace("<", "&lt;")
                .replace(">", "&gt;")
                .replace("\"", "&quot;")
                .replace("'", "&#39;");
    }

    /* ---- block pass ------------------------------------------------------------ */

    private static void renderBlocks(String[] lines, StringBuilder out) {
        List<String> paragraph = new ArrayList<>();
        int i = 0;
        while (i < lines.length) {
            String line = lines[i];

            // Code fence: verbatim until the closing fence — escape-only, no inline pass.
            if (line.startsWith("```")) {
                flushParagraph(paragraph, out);
                StringBuilder code = new StringBuilder();
                i++;
                while (i < lines.length && !lines[i].startsWith("```")) {
                    code.append(lines[i]).append('\n');
                    i++;
                }
                i++; // skip the closing fence (or run off the end of an unclosed block)
                out.append("<pre><code>").append(escapeHtml(code.toString())).append("</code></pre>");
                continue;
            }

            Matcher heading = HEADING.matcher(line);
            if (heading.matches()) {
                flushParagraph(paragraph, out);
                // HTMLEditorKit only renders h1-h4 sensibly; map md h5/h6 down to h4.
                int level = Math.min(heading.group(1).length(), 4);
                String text = TRAILING_HASHES.matcher(heading.group(2)).replaceFirst("").trim();
                out.append("<h").append(level).append('>')
                        .append(inline(escapeHtml(text)))
                        .append("</h").append(level).append('>');
                i++;
                continue;
            }

            if (HR.matcher(line).matches()) {
                flushParagraph(paragraph, out);
                out.append("<hr>");
                i++;
                continue;
            }

            if (line.startsWith(">")) {
                flushParagraph(paragraph, out);
                List<String> inner = new ArrayList<>();
                while (i < lines.length && lines[i].startsWith(">")) {
                    inner.add(lines[i].replaceFirst("^>\\s?", ""));
                    i++;
                }
                out.append("<blockquote>");
                renderBlocks(inner.toArray(new String[0]), out);
                out.append("</blockquote>");
                continue;
            }

            if (LIST_ITEM.matcher(line).matches()) {
                flushParagraph(paragraph, out);
                i = renderList(lines, i, out);
                continue;
            }

            // GFM pipe table: a row with | followed by a delimiter row (which must itself
            // contain a pipe, so a plain --- line stays a rule, not a table).
            if (line.indexOf('|') >= 0 && i + 1 < lines.length
                    && lines[i + 1].indexOf('|') >= 0 && lines[i + 1].indexOf('-') >= 0
                    && TABLE_DELIMITER.matcher(lines[i + 1]).matches()) {
                flushParagraph(paragraph, out);
                out.append("<table border=\"0\">");
                appendTableRow(line, true, out);
                i += 2; // header + delimiter (alignment colons are ignored)
                while (i < lines.length && lines[i].indexOf('|') >= 0) {
                    appendTableRow(lines[i], false, out);
                    i++;
                }
                out.append("</table>");
                continue;
            }

            if (line.trim().isEmpty()) {
                flushParagraph(paragraph, out);
                i++;
                continue;
            }

            paragraph.add(line.trim());
            i++;
        }
        flushParagraph(paragraph, out);
    }

    private static void flushParagraph(List<String> paragraph, StringBuilder out) {
        if (paragraph.isEmpty()) {
            return;
        }
        out.append("<p>").append(inline(escapeHtml(String.join(" ", paragraph)))).append("</p>");
        paragraph.clear();
    }

    /** Renders one run of list items (with one nesting level by indent) and returns the next line index. */
    private static int renderList(String[] lines, int start, StringBuilder out) {
        List<Integer> indents = new ArrayList<>();
        List<Boolean> ordered = new ArrayList<>();
        List<StringBuilder> texts = new ArrayList<>();

        int i = start;
        while (i < lines.length) {
            String line = lines[i];
            Matcher item = LIST_ITEM.matcher(line);
            if (item.matches()) {
                indents.add(item.group(1).length());
                ordered.add(Character.isDigit(item.group(2).charAt(0)));
                texts.add(new StringBuilder(item.group(3)));
                i++;
            } else if (!line.trim().isEmpty() && !startsBlock(line)) {
                // Lazy continuation joins the previous item.
                texts.get(texts.size() - 1).append(' ').append(line.trim());
                i++;
            } else {
                break;
            }
        }

        int base = indents.get(0);
        String outerTag = ordered.get(0) ? "ol" : "ul";
        out.append('<').append(outerTag).append('>');
        boolean itemOpen = false;
        String nestedTag = null;
        for (int k = 0; k < texts.size(); k++) {
            String html = inline(escapeHtml(texts.get(k).toString().trim()));
            if (indents.get(k) >= base + 2) {
                if (nestedTag == null) {
                    nestedTag = ordered.get(k) ? "ol" : "ul";
                    out.append('<').append(nestedTag).append('>');
                }
                out.append("<li>").append(html).append("</li>");
            } else {
                if (nestedTag != null) {
                    out.append("</").append(nestedTag).append('>');
                    nestedTag = null;
                }
                if (itemOpen) {
                    out.append("</li>");
                }
                out.append("<li>").append(html);
                itemOpen = true;
            }
        }
        if (nestedTag != null) {
            out.append("</").append(nestedTag).append('>');
        }
        if (itemOpen) {
            out.append("</li>");
        }
        out.append("</").append(outerTag).append('>');
        return i;
    }

    private static boolean startsBlock(String line) {
        return line.startsWith("```") || line.startsWith(">")
                || HEADING.matcher(line).matches() || HR.matcher(line).matches();
    }

    private static void appendTableRow(String line, boolean header, StringBuilder out) {
        out.append("<tr>");
        for (String cell : splitCells(line)) {
            // Header cells as <td><b> — HTMLEditorKit renders <th> inconsistently.
            String html = inline(escapeHtml(cell.trim()));
            out.append("<td>");
            if (header) {
                out.append("<b>").append(html).append("</b>");
            } else {
                out.append(html);
            }
            out.append("</td>");
        }
        out.append("</tr>");
    }

    /** Splits a table row on unescaped pipes and drops the empty edge cells from leading/trailing pipes. */
    private static List<String> splitCells(String line) {
        List<String> cells = new ArrayList<>();
        String row = line.trim();
        StringBuilder cell = new StringBuilder();
        for (int i = 0; i < row.length(); i++) {
            char c = row.charAt(i);
            if (c == '\\' && i + 1 < row.length() && row.charAt(i + 1) == '|') {
                cell.append('|');
                i++;
            } else if (c == '|') {
                cells.add(cell.toString());
                cell.setLength(0);
            } else {
                cell.append(c);
            }
        }
        cells.add(cell.toString());
        if (!cells.isEmpty() && cells.get(0).trim().isEmpty()) {
            cells.remove(0);
        }
        if (!cells.isEmpty() && cells.get(cells.size() - 1).trim().isEmpty()) {
            cells.remove(cells.size() - 1);
        }
        return cells;
    }

    /* ---- inline pass ----------------------------------------------------------- */

    /**
     * Inline transforms over already-escaped text (it can no longer contain live
     * {@code < > " '}), in a load-bearing order: inline code first (its content is exempt
     * from everything else), then images, links and autolinks (whose emitted tags are
     * stashed as placeholders so bold/italic can't mangle hrefs), then bold before italic
     * so {@code **} is consumed before {@code *}.
     */
    private static String inline(String escapedText) {
        List<String> chunks = new ArrayList<>();
        String s = escapedText;

        s = replaceEach(INLINE_CODE, s, m -> stash(chunks, "<code>" + m.group(1) + "</code>"));

        // Images are stripped to text — never an <img>, regardless of URL.
        s = replaceEach(IMAGE, s, m -> {
            String alt = m.group(1).trim();
            return alt.isEmpty() ? "[image]" : "[image: " + alt + "]";
        });

        // Links: http/https only; anything else renders as the bare label text.
        s = replaceEach(LINK, s, m -> {
            String url = resolveUrl(m.group(2));
            if (url == null) {
                return m.group(1);
            }
            // Only the anchor tags are stashed, so bold/italic still format the label.
            return stash(chunks, "<a href=\"" + escapeHtml(url) + "\">") + m.group(1) + stash(chunks, "</a>");
        });

        // Autolink bare URLs (GFM parity), leaving trailing punctuation outside the link.
        s = replaceEach(AUTOLINK, s, m -> {
            String match = m.group();
            int end = match.length();
            while (end > 0 && ".,;:!?)".indexOf(match.charAt(end - 1)) >= 0) {
                end--;
            }
            String url = resolveUrl(match.substring(0, end));
            if (url == null) {
                return match;
            }
            return stash(chunks, "<a href=\"" + escapeHtml(url) + "\">" + match.substring(0, end) + "</a>")
                    + match.substring(end);
        });

        s = BOLD_STAR.matcher(s).replaceAll("<b>$1</b>");
        s = BOLD_UNDERSCORE.matcher(s).replaceAll("<b>$1</b>");
        s = ITALIC_STAR.matcher(s).replaceAll("<i>$1</i>");
        s = ITALIC_UNDERSCORE.matcher(s).replaceAll("<i>$1</i>");

        return restore(chunks, s);
    }

    /**
     * The port of the web renderer's {@code resolveDocUrl} allowlist: trim, then require an
     * explicit http/https scheme (case-insensitive). Everything else — javascript:, data:,
     * mailto:, #fragments, protocol-relative and relative paths (there is no repo/tag base
     * to resolve against here) — returns null and renders as plain text. The input arrives
     * escaped; it is unescaped for the check and re-escaped by the caller for the attribute.
     */
    private static String resolveUrl(String escapedHref) {
        if (escapedHref == null) {
            return null;
        }
        String value = unescapeHtml(escapedHref).trim();
        if (!ALLOWED_URL.matcher(value).find()) {
            return null;
        }
        return value;
    }

    /** Reverses {@link #escapeHtml} (entities first, {@code &amp;} last). */
    private static String unescapeHtml(String value) {
        return value
                .replace("&#39;", "'")
                .replace("&quot;", "\"")
                .replace("&gt;", ">")
                .replace("&lt;", "<")
                .replace("&amp;", "&");
    }

    /** Literal (non-template) regex replacement — replacements are appended verbatim. */
    private static String replaceEach(Pattern pattern, String input, Function<Matcher, String> replacement) {
        Matcher m = pattern.matcher(input);
        StringBuilder sb = new StringBuilder();
        int last = 0;
        while (m.find()) {
            sb.append(input, last, m.start());
            sb.append(replacement.apply(m));
            last = m.end();
        }
        sb.append(input, last, input.length());
        return sb.toString();
    }

    private static String stash(List<String> chunks, String html) {
        chunks.add(html);
        return "\u0001" + (chunks.size() - 1) + "\u0002";
    }

    /**
     * Restores stashed fragments, highest index first: a later chunk (a link) may contain
     * the placeholder of an earlier one (inline code in its label), so unwinding in reverse
     * re-exposes those tokens before their own turn comes.
     */
    private static String restore(List<String> chunks, String text) {
        String result = text;
        for (int i = chunks.size() - 1; i >= 0; i--) {
            String token = "\u0001" + i + "\u0002";
            int at = result.indexOf(token);
            if (at >= 0) {
                result = result.substring(0, at) + chunks.get(i) + result.substring(at + token.length());
            }
        }
        return result;
    }
}
