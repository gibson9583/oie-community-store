// web/plugin.jsx
import { platform } from "@oie/web-shell";

// node_modules/marked/lib/marked.esm.js
function _getDefaults() {
  return {
    async: false,
    breaks: false,
    extensions: null,
    gfm: true,
    hooks: null,
    pedantic: false,
    renderer: null,
    silent: false,
    tokenizer: null,
    walkTokens: null
  };
}
var _defaults = _getDefaults();
function changeDefaults(newDefaults) {
  _defaults = newDefaults;
}
var escapeTest = /[&<>"']/;
var escapeReplace = new RegExp(escapeTest.source, "g");
var escapeTestNoEncode = /[<>"']|&(?!(#\d{1,7}|#[Xx][a-fA-F0-9]{1,6}|\w+);)/;
var escapeReplaceNoEncode = new RegExp(escapeTestNoEncode.source, "g");
var escapeReplacements = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;"
};
var getEscapeReplacement = (ch) => escapeReplacements[ch];
function escape$1(html2, encode) {
  if (encode) {
    if (escapeTest.test(html2)) {
      return html2.replace(escapeReplace, getEscapeReplacement);
    }
  } else {
    if (escapeTestNoEncode.test(html2)) {
      return html2.replace(escapeReplaceNoEncode, getEscapeReplacement);
    }
  }
  return html2;
}
var caret = /(^|[^\[])\^/g;
function edit(regex, opt) {
  let source = typeof regex === "string" ? regex : regex.source;
  opt = opt || "";
  const obj = {
    replace: (name, val) => {
      let valSource = typeof val === "string" ? val : val.source;
      valSource = valSource.replace(caret, "$1");
      source = source.replace(name, valSource);
      return obj;
    },
    getRegex: () => {
      return new RegExp(source, opt);
    }
  };
  return obj;
}
function cleanUrl(href) {
  try {
    href = encodeURI(href).replace(/%25/g, "%");
  } catch {
    return null;
  }
  return href;
}
var noopTest = { exec: () => null };
function splitCells(tableRow, count) {
  const row = tableRow.replace(/\|/g, (match, offset, str) => {
    let escaped = false;
    let curr = offset;
    while (--curr >= 0 && str[curr] === "\\")
      escaped = !escaped;
    if (escaped) {
      return "|";
    } else {
      return " |";
    }
  }), cells = row.split(/ \|/);
  let i = 0;
  if (!cells[0].trim()) {
    cells.shift();
  }
  if (cells.length > 0 && !cells[cells.length - 1].trim()) {
    cells.pop();
  }
  if (count) {
    if (cells.length > count) {
      cells.splice(count);
    } else {
      while (cells.length < count)
        cells.push("");
    }
  }
  for (; i < cells.length; i++) {
    cells[i] = cells[i].trim().replace(/\\\|/g, "|");
  }
  return cells;
}
function rtrim(str, c, invert) {
  const l = str.length;
  if (l === 0) {
    return "";
  }
  let suffLen = 0;
  while (suffLen < l) {
    const currChar = str.charAt(l - suffLen - 1);
    if (currChar === c && !invert) {
      suffLen++;
    } else if (currChar !== c && invert) {
      suffLen++;
    } else {
      break;
    }
  }
  return str.slice(0, l - suffLen);
}
function findClosingBracket(str, b) {
  if (str.indexOf(b[1]) === -1) {
    return -1;
  }
  let level = 0;
  for (let i = 0; i < str.length; i++) {
    if (str[i] === "\\") {
      i++;
    } else if (str[i] === b[0]) {
      level++;
    } else if (str[i] === b[1]) {
      level--;
      if (level < 0) {
        return i;
      }
    }
  }
  return -1;
}
function outputLink(cap, link2, raw, lexer2) {
  const href = link2.href;
  const title = link2.title ? escape$1(link2.title) : null;
  const text = cap[1].replace(/\\([\[\]])/g, "$1");
  if (cap[0].charAt(0) !== "!") {
    lexer2.state.inLink = true;
    const token = {
      type: "link",
      raw,
      href,
      title,
      text,
      tokens: lexer2.inlineTokens(text)
    };
    lexer2.state.inLink = false;
    return token;
  }
  return {
    type: "image",
    raw,
    href,
    title,
    text: escape$1(text)
  };
}
function indentCodeCompensation(raw, text) {
  const matchIndentToCode = raw.match(/^(\s+)(?:```)/);
  if (matchIndentToCode === null) {
    return text;
  }
  const indentToCode = matchIndentToCode[1];
  return text.split("\n").map((node) => {
    const matchIndentInNode = node.match(/^\s+/);
    if (matchIndentInNode === null) {
      return node;
    }
    const [indentInNode] = matchIndentInNode;
    if (indentInNode.length >= indentToCode.length) {
      return node.slice(indentToCode.length);
    }
    return node;
  }).join("\n");
}
var _Tokenizer = class {
  options;
  rules;
  // set by the lexer
  lexer;
  // set by the lexer
  constructor(options2) {
    this.options = options2 || _defaults;
  }
  space(src) {
    const cap = this.rules.block.newline.exec(src);
    if (cap && cap[0].length > 0) {
      return {
        type: "space",
        raw: cap[0]
      };
    }
  }
  code(src) {
    const cap = this.rules.block.code.exec(src);
    if (cap) {
      const text = cap[0].replace(/^(?: {1,4}| {0,3}\t)/gm, "");
      return {
        type: "code",
        raw: cap[0],
        codeBlockStyle: "indented",
        text: !this.options.pedantic ? rtrim(text, "\n") : text
      };
    }
  }
  fences(src) {
    const cap = this.rules.block.fences.exec(src);
    if (cap) {
      const raw = cap[0];
      const text = indentCodeCompensation(raw, cap[3] || "");
      return {
        type: "code",
        raw,
        lang: cap[2] ? cap[2].trim().replace(this.rules.inline.anyPunctuation, "$1") : cap[2],
        text
      };
    }
  }
  heading(src) {
    const cap = this.rules.block.heading.exec(src);
    if (cap) {
      let text = cap[2].trim();
      if (/#$/.test(text)) {
        const trimmed = rtrim(text, "#");
        if (this.options.pedantic) {
          text = trimmed.trim();
        } else if (!trimmed || / $/.test(trimmed)) {
          text = trimmed.trim();
        }
      }
      return {
        type: "heading",
        raw: cap[0],
        depth: cap[1].length,
        text,
        tokens: this.lexer.inline(text)
      };
    }
  }
  hr(src) {
    const cap = this.rules.block.hr.exec(src);
    if (cap) {
      return {
        type: "hr",
        raw: rtrim(cap[0], "\n")
      };
    }
  }
  blockquote(src) {
    const cap = this.rules.block.blockquote.exec(src);
    if (cap) {
      let lines = rtrim(cap[0], "\n").split("\n");
      let raw = "";
      let text = "";
      const tokens = [];
      while (lines.length > 0) {
        let inBlockquote = false;
        const currentLines = [];
        let i;
        for (i = 0; i < lines.length; i++) {
          if (/^ {0,3}>/.test(lines[i])) {
            currentLines.push(lines[i]);
            inBlockquote = true;
          } else if (!inBlockquote) {
            currentLines.push(lines[i]);
          } else {
            break;
          }
        }
        lines = lines.slice(i);
        const currentRaw = currentLines.join("\n");
        const currentText = currentRaw.replace(/\n {0,3}((?:=+|-+) *)(?=\n|$)/g, "\n    $1").replace(/^ {0,3}>[ \t]?/gm, "");
        raw = raw ? `${raw}
${currentRaw}` : currentRaw;
        text = text ? `${text}
${currentText}` : currentText;
        const top = this.lexer.state.top;
        this.lexer.state.top = true;
        this.lexer.blockTokens(currentText, tokens, true);
        this.lexer.state.top = top;
        if (lines.length === 0) {
          break;
        }
        const lastToken = tokens[tokens.length - 1];
        if (lastToken?.type === "code") {
          break;
        } else if (lastToken?.type === "blockquote") {
          const oldToken = lastToken;
          const newText = oldToken.raw + "\n" + lines.join("\n");
          const newToken = this.blockquote(newText);
          tokens[tokens.length - 1] = newToken;
          raw = raw.substring(0, raw.length - oldToken.raw.length) + newToken.raw;
          text = text.substring(0, text.length - oldToken.text.length) + newToken.text;
          break;
        } else if (lastToken?.type === "list") {
          const oldToken = lastToken;
          const newText = oldToken.raw + "\n" + lines.join("\n");
          const newToken = this.list(newText);
          tokens[tokens.length - 1] = newToken;
          raw = raw.substring(0, raw.length - lastToken.raw.length) + newToken.raw;
          text = text.substring(0, text.length - oldToken.raw.length) + newToken.raw;
          lines = newText.substring(tokens[tokens.length - 1].raw.length).split("\n");
          continue;
        }
      }
      return {
        type: "blockquote",
        raw,
        tokens,
        text
      };
    }
  }
  list(src) {
    let cap = this.rules.block.list.exec(src);
    if (cap) {
      let bull = cap[1].trim();
      const isordered = bull.length > 1;
      const list2 = {
        type: "list",
        raw: "",
        ordered: isordered,
        start: isordered ? +bull.slice(0, -1) : "",
        loose: false,
        items: []
      };
      bull = isordered ? `\\d{1,9}\\${bull.slice(-1)}` : `\\${bull}`;
      if (this.options.pedantic) {
        bull = isordered ? bull : "[*+-]";
      }
      const itemRegex = new RegExp(`^( {0,3}${bull})((?:[	 ][^\\n]*)?(?:\\n|$))`);
      let endsWithBlankLine = false;
      while (src) {
        let endEarly = false;
        let raw = "";
        let itemContents = "";
        if (!(cap = itemRegex.exec(src))) {
          break;
        }
        if (this.rules.block.hr.test(src)) {
          break;
        }
        raw = cap[0];
        src = src.substring(raw.length);
        let line = cap[2].split("\n", 1)[0].replace(/^\t+/, (t) => " ".repeat(3 * t.length));
        let nextLine = src.split("\n", 1)[0];
        let blankLine = !line.trim();
        let indent = 0;
        if (this.options.pedantic) {
          indent = 2;
          itemContents = line.trimStart();
        } else if (blankLine) {
          indent = cap[1].length + 1;
        } else {
          indent = cap[2].search(/[^ ]/);
          indent = indent > 4 ? 1 : indent;
          itemContents = line.slice(indent);
          indent += cap[1].length;
        }
        if (blankLine && /^[ \t]*$/.test(nextLine)) {
          raw += nextLine + "\n";
          src = src.substring(nextLine.length + 1);
          endEarly = true;
        }
        if (!endEarly) {
          const nextBulletRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:[*+-]|\\d{1,9}[.)])((?:[ 	][^\\n]*)?(?:\\n|$))`);
          const hrRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}((?:- *){3,}|(?:_ *){3,}|(?:\\* *){3,})(?:\\n+|$)`);
          const fencesBeginRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}(?:\`\`\`|~~~)`);
          const headingBeginRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}#`);
          const htmlBeginRegex = new RegExp(`^ {0,${Math.min(3, indent - 1)}}<[a-z].*>`, "i");
          while (src) {
            const rawLine = src.split("\n", 1)[0];
            let nextLineWithoutTabs;
            nextLine = rawLine;
            if (this.options.pedantic) {
              nextLine = nextLine.replace(/^ {1,4}(?=( {4})*[^ ])/g, "  ");
              nextLineWithoutTabs = nextLine;
            } else {
              nextLineWithoutTabs = nextLine.replace(/\t/g, "    ");
            }
            if (fencesBeginRegex.test(nextLine)) {
              break;
            }
            if (headingBeginRegex.test(nextLine)) {
              break;
            }
            if (htmlBeginRegex.test(nextLine)) {
              break;
            }
            if (nextBulletRegex.test(nextLine)) {
              break;
            }
            if (hrRegex.test(nextLine)) {
              break;
            }
            if (nextLineWithoutTabs.search(/[^ ]/) >= indent || !nextLine.trim()) {
              itemContents += "\n" + nextLineWithoutTabs.slice(indent);
            } else {
              if (blankLine) {
                break;
              }
              if (line.replace(/\t/g, "    ").search(/[^ ]/) >= 4) {
                break;
              }
              if (fencesBeginRegex.test(line)) {
                break;
              }
              if (headingBeginRegex.test(line)) {
                break;
              }
              if (hrRegex.test(line)) {
                break;
              }
              itemContents += "\n" + nextLine;
            }
            if (!blankLine && !nextLine.trim()) {
              blankLine = true;
            }
            raw += rawLine + "\n";
            src = src.substring(rawLine.length + 1);
            line = nextLineWithoutTabs.slice(indent);
          }
        }
        if (!list2.loose) {
          if (endsWithBlankLine) {
            list2.loose = true;
          } else if (/\n[ \t]*\n[ \t]*$/.test(raw)) {
            endsWithBlankLine = true;
          }
        }
        let istask = null;
        let ischecked;
        if (this.options.gfm) {
          istask = /^\[[ xX]\] /.exec(itemContents);
          if (istask) {
            ischecked = istask[0] !== "[ ] ";
            itemContents = itemContents.replace(/^\[[ xX]\] +/, "");
          }
        }
        list2.items.push({
          type: "list_item",
          raw,
          task: !!istask,
          checked: ischecked,
          loose: false,
          text: itemContents,
          tokens: []
        });
        list2.raw += raw;
      }
      list2.items[list2.items.length - 1].raw = list2.items[list2.items.length - 1].raw.trimEnd();
      list2.items[list2.items.length - 1].text = list2.items[list2.items.length - 1].text.trimEnd();
      list2.raw = list2.raw.trimEnd();
      for (let i = 0; i < list2.items.length; i++) {
        this.lexer.state.top = false;
        list2.items[i].tokens = this.lexer.blockTokens(list2.items[i].text, []);
        if (!list2.loose) {
          const spacers = list2.items[i].tokens.filter((t) => t.type === "space");
          const hasMultipleLineBreaks = spacers.length > 0 && spacers.some((t) => /\n.*\n/.test(t.raw));
          list2.loose = hasMultipleLineBreaks;
        }
      }
      if (list2.loose) {
        for (let i = 0; i < list2.items.length; i++) {
          list2.items[i].loose = true;
        }
      }
      return list2;
    }
  }
  html(src) {
    const cap = this.rules.block.html.exec(src);
    if (cap) {
      const token = {
        type: "html",
        block: true,
        raw: cap[0],
        pre: cap[1] === "pre" || cap[1] === "script" || cap[1] === "style",
        text: cap[0]
      };
      return token;
    }
  }
  def(src) {
    const cap = this.rules.block.def.exec(src);
    if (cap) {
      const tag2 = cap[1].toLowerCase().replace(/\s+/g, " ");
      const href = cap[2] ? cap[2].replace(/^<(.*)>$/, "$1").replace(this.rules.inline.anyPunctuation, "$1") : "";
      const title = cap[3] ? cap[3].substring(1, cap[3].length - 1).replace(this.rules.inline.anyPunctuation, "$1") : cap[3];
      return {
        type: "def",
        tag: tag2,
        raw: cap[0],
        href,
        title
      };
    }
  }
  table(src) {
    const cap = this.rules.block.table.exec(src);
    if (!cap) {
      return;
    }
    if (!/[:|]/.test(cap[2])) {
      return;
    }
    const headers = splitCells(cap[1]);
    const aligns = cap[2].replace(/^\||\| *$/g, "").split("|");
    const rows = cap[3] && cap[3].trim() ? cap[3].replace(/\n[ \t]*$/, "").split("\n") : [];
    const item = {
      type: "table",
      raw: cap[0],
      header: [],
      align: [],
      rows: []
    };
    if (headers.length !== aligns.length) {
      return;
    }
    for (const align of aligns) {
      if (/^ *-+: *$/.test(align)) {
        item.align.push("right");
      } else if (/^ *:-+: *$/.test(align)) {
        item.align.push("center");
      } else if (/^ *:-+ *$/.test(align)) {
        item.align.push("left");
      } else {
        item.align.push(null);
      }
    }
    for (let i = 0; i < headers.length; i++) {
      item.header.push({
        text: headers[i],
        tokens: this.lexer.inline(headers[i]),
        header: true,
        align: item.align[i]
      });
    }
    for (const row of rows) {
      item.rows.push(splitCells(row, item.header.length).map((cell, i) => {
        return {
          text: cell,
          tokens: this.lexer.inline(cell),
          header: false,
          align: item.align[i]
        };
      }));
    }
    return item;
  }
  lheading(src) {
    const cap = this.rules.block.lheading.exec(src);
    if (cap) {
      return {
        type: "heading",
        raw: cap[0],
        depth: cap[2].charAt(0) === "=" ? 1 : 2,
        text: cap[1],
        tokens: this.lexer.inline(cap[1])
      };
    }
  }
  paragraph(src) {
    const cap = this.rules.block.paragraph.exec(src);
    if (cap) {
      const text = cap[1].charAt(cap[1].length - 1) === "\n" ? cap[1].slice(0, -1) : cap[1];
      return {
        type: "paragraph",
        raw: cap[0],
        text,
        tokens: this.lexer.inline(text)
      };
    }
  }
  text(src) {
    const cap = this.rules.block.text.exec(src);
    if (cap) {
      return {
        type: "text",
        raw: cap[0],
        text: cap[0],
        tokens: this.lexer.inline(cap[0])
      };
    }
  }
  escape(src) {
    const cap = this.rules.inline.escape.exec(src);
    if (cap) {
      return {
        type: "escape",
        raw: cap[0],
        text: escape$1(cap[1])
      };
    }
  }
  tag(src) {
    const cap = this.rules.inline.tag.exec(src);
    if (cap) {
      if (!this.lexer.state.inLink && /^<a /i.test(cap[0])) {
        this.lexer.state.inLink = true;
      } else if (this.lexer.state.inLink && /^<\/a>/i.test(cap[0])) {
        this.lexer.state.inLink = false;
      }
      if (!this.lexer.state.inRawBlock && /^<(pre|code|kbd|script)(\s|>)/i.test(cap[0])) {
        this.lexer.state.inRawBlock = true;
      } else if (this.lexer.state.inRawBlock && /^<\/(pre|code|kbd|script)(\s|>)/i.test(cap[0])) {
        this.lexer.state.inRawBlock = false;
      }
      return {
        type: "html",
        raw: cap[0],
        inLink: this.lexer.state.inLink,
        inRawBlock: this.lexer.state.inRawBlock,
        block: false,
        text: cap[0]
      };
    }
  }
  link(src) {
    const cap = this.rules.inline.link.exec(src);
    if (cap) {
      const trimmedUrl = cap[2].trim();
      if (!this.options.pedantic && /^</.test(trimmedUrl)) {
        if (!/>$/.test(trimmedUrl)) {
          return;
        }
        const rtrimSlash = rtrim(trimmedUrl.slice(0, -1), "\\");
        if ((trimmedUrl.length - rtrimSlash.length) % 2 === 0) {
          return;
        }
      } else {
        const lastParenIndex = findClosingBracket(cap[2], "()");
        if (lastParenIndex > -1) {
          const start = cap[0].indexOf("!") === 0 ? 5 : 4;
          const linkLen = start + cap[1].length + lastParenIndex;
          cap[2] = cap[2].substring(0, lastParenIndex);
          cap[0] = cap[0].substring(0, linkLen).trim();
          cap[3] = "";
        }
      }
      let href = cap[2];
      let title = "";
      if (this.options.pedantic) {
        const link2 = /^([^'"]*[^\s])\s+(['"])(.*)\2/.exec(href);
        if (link2) {
          href = link2[1];
          title = link2[3];
        }
      } else {
        title = cap[3] ? cap[3].slice(1, -1) : "";
      }
      href = href.trim();
      if (/^</.test(href)) {
        if (this.options.pedantic && !/>$/.test(trimmedUrl)) {
          href = href.slice(1);
        } else {
          href = href.slice(1, -1);
        }
      }
      return outputLink(cap, {
        href: href ? href.replace(this.rules.inline.anyPunctuation, "$1") : href,
        title: title ? title.replace(this.rules.inline.anyPunctuation, "$1") : title
      }, cap[0], this.lexer);
    }
  }
  reflink(src, links) {
    let cap;
    if ((cap = this.rules.inline.reflink.exec(src)) || (cap = this.rules.inline.nolink.exec(src))) {
      const linkString = (cap[2] || cap[1]).replace(/\s+/g, " ");
      const link2 = links[linkString.toLowerCase()];
      if (!link2) {
        const text = cap[0].charAt(0);
        return {
          type: "text",
          raw: text,
          text
        };
      }
      return outputLink(cap, link2, cap[0], this.lexer);
    }
  }
  emStrong(src, maskedSrc, prevChar = "") {
    let match = this.rules.inline.emStrongLDelim.exec(src);
    if (!match)
      return;
    if (match[3] && prevChar.match(/[\p{L}\p{N}]/u))
      return;
    const nextChar = match[1] || match[2] || "";
    if (!nextChar || !prevChar || this.rules.inline.punctuation.exec(prevChar)) {
      const lLength = [...match[0]].length - 1;
      let rDelim, rLength, delimTotal = lLength, midDelimTotal = 0;
      const endReg = match[0][0] === "*" ? this.rules.inline.emStrongRDelimAst : this.rules.inline.emStrongRDelimUnd;
      endReg.lastIndex = 0;
      maskedSrc = maskedSrc.slice(-1 * src.length + lLength);
      while ((match = endReg.exec(maskedSrc)) != null) {
        rDelim = match[1] || match[2] || match[3] || match[4] || match[5] || match[6];
        if (!rDelim)
          continue;
        rLength = [...rDelim].length;
        if (match[3] || match[4]) {
          delimTotal += rLength;
          continue;
        } else if (match[5] || match[6]) {
          if (lLength % 3 && !((lLength + rLength) % 3)) {
            midDelimTotal += rLength;
            continue;
          }
        }
        delimTotal -= rLength;
        if (delimTotal > 0)
          continue;
        rLength = Math.min(rLength, rLength + delimTotal + midDelimTotal);
        const lastCharLength = [...match[0]][0].length;
        const raw = src.slice(0, lLength + match.index + lastCharLength + rLength);
        if (Math.min(lLength, rLength) % 2) {
          const text2 = raw.slice(1, -1);
          return {
            type: "em",
            raw,
            text: text2,
            tokens: this.lexer.inlineTokens(text2)
          };
        }
        const text = raw.slice(2, -2);
        return {
          type: "strong",
          raw,
          text,
          tokens: this.lexer.inlineTokens(text)
        };
      }
    }
  }
  codespan(src) {
    const cap = this.rules.inline.code.exec(src);
    if (cap) {
      let text = cap[2].replace(/\n/g, " ");
      const hasNonSpaceChars = /[^ ]/.test(text);
      const hasSpaceCharsOnBothEnds = /^ /.test(text) && / $/.test(text);
      if (hasNonSpaceChars && hasSpaceCharsOnBothEnds) {
        text = text.substring(1, text.length - 1);
      }
      text = escape$1(text, true);
      return {
        type: "codespan",
        raw: cap[0],
        text
      };
    }
  }
  br(src) {
    const cap = this.rules.inline.br.exec(src);
    if (cap) {
      return {
        type: "br",
        raw: cap[0]
      };
    }
  }
  del(src) {
    const cap = this.rules.inline.del.exec(src);
    if (cap) {
      return {
        type: "del",
        raw: cap[0],
        text: cap[2],
        tokens: this.lexer.inlineTokens(cap[2])
      };
    }
  }
  autolink(src) {
    const cap = this.rules.inline.autolink.exec(src);
    if (cap) {
      let text, href;
      if (cap[2] === "@") {
        text = escape$1(cap[1]);
        href = "mailto:" + text;
      } else {
        text = escape$1(cap[1]);
        href = text;
      }
      return {
        type: "link",
        raw: cap[0],
        text,
        href,
        tokens: [
          {
            type: "text",
            raw: text,
            text
          }
        ]
      };
    }
  }
  url(src) {
    let cap;
    if (cap = this.rules.inline.url.exec(src)) {
      let text, href;
      if (cap[2] === "@") {
        text = escape$1(cap[0]);
        href = "mailto:" + text;
      } else {
        let prevCapZero;
        do {
          prevCapZero = cap[0];
          cap[0] = this.rules.inline._backpedal.exec(cap[0])?.[0] ?? "";
        } while (prevCapZero !== cap[0]);
        text = escape$1(cap[0]);
        if (cap[1] === "www.") {
          href = "http://" + cap[0];
        } else {
          href = cap[0];
        }
      }
      return {
        type: "link",
        raw: cap[0],
        text,
        href,
        tokens: [
          {
            type: "text",
            raw: text,
            text
          }
        ]
      };
    }
  }
  inlineText(src) {
    const cap = this.rules.inline.text.exec(src);
    if (cap) {
      let text;
      if (this.lexer.state.inRawBlock) {
        text = cap[0];
      } else {
        text = escape$1(cap[0]);
      }
      return {
        type: "text",
        raw: cap[0],
        text
      };
    }
  }
};
var newline = /^(?:[ \t]*(?:\n|$))+/;
var blockCode = /^((?: {4}| {0,3}\t)[^\n]+(?:\n(?:[ \t]*(?:\n|$))*)?)+/;
var fences = /^ {0,3}(`{3,}(?=[^`\n]*(?:\n|$))|~{3,})([^\n]*)(?:\n|$)(?:|([\s\S]*?)(?:\n|$))(?: {0,3}\1[~`]* *(?=\n|$)|$)/;
var hr = /^ {0,3}((?:-[\t ]*){3,}|(?:_[ \t]*){3,}|(?:\*[ \t]*){3,})(?:\n+|$)/;
var heading = /^ {0,3}(#{1,6})(?=\s|$)(.*)(?:\n+|$)/;
var bullet = /(?:[*+-]|\d{1,9}[.)])/;
var lheading = edit(/^(?!bull |blockCode|fences|blockquote|heading|html)((?:.|\n(?!\s*?\n|bull |blockCode|fences|blockquote|heading|html))+?)\n {0,3}(=+|-+) *(?:\n+|$)/).replace(/bull/g, bullet).replace(/blockCode/g, /(?: {4}| {0,3}\t)/).replace(/fences/g, / {0,3}(?:`{3,}|~{3,})/).replace(/blockquote/g, / {0,3}>/).replace(/heading/g, / {0,3}#{1,6}/).replace(/html/g, / {0,3}<[^\n>]+>\n/).getRegex();
var _paragraph = /^([^\n]+(?:\n(?!hr|heading|lheading|blockquote|fences|list|html|table| +\n)[^\n]+)*)/;
var blockText = /^[^\n]+/;
var _blockLabel = /(?!\s*\])(?:\\.|[^\[\]\\])+/;
var def = edit(/^ {0,3}\[(label)\]: *(?:\n[ \t]*)?([^<\s][^\s]*|<.*?>)(?:(?: +(?:\n[ \t]*)?| *\n[ \t]*)(title))? *(?:\n+|$)/).replace("label", _blockLabel).replace("title", /(?:"(?:\\"?|[^"\\])*"|'[^'\n]*(?:\n[^'\n]+)*\n?'|\([^()]*\))/).getRegex();
var list = edit(/^( {0,3}bull)([ \t][^\n]+?)?(?:\n|$)/).replace(/bull/g, bullet).getRegex();
var _tag = "address|article|aside|base|basefont|blockquote|body|caption|center|col|colgroup|dd|details|dialog|dir|div|dl|dt|fieldset|figcaption|figure|footer|form|frame|frameset|h[1-6]|head|header|hr|html|iframe|legend|li|link|main|menu|menuitem|meta|nav|noframes|ol|optgroup|option|p|param|search|section|summary|table|tbody|td|tfoot|th|thead|title|tr|track|ul";
var _comment = /<!--(?:-?>|[\s\S]*?(?:-->|$))/;
var html = edit("^ {0,3}(?:<(script|pre|style|textarea)[\\s>][\\s\\S]*?(?:</\\1>[^\\n]*\\n+|$)|comment[^\\n]*(\\n+|$)|<\\?[\\s\\S]*?(?:\\?>\\n*|$)|<![A-Z][\\s\\S]*?(?:>\\n*|$)|<!\\[CDATA\\[[\\s\\S]*?(?:\\]\\]>\\n*|$)|</?(tag)(?: +|\\n|/?>)[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|<(?!script|pre|style|textarea)([a-z][\\w-]*)(?:attribute)*? */?>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$)|</(?!script|pre|style|textarea)[a-z][\\w-]*\\s*>(?=[ \\t]*(?:\\n|$))[\\s\\S]*?(?:(?:\\n[ 	]*)+\\n|$))", "i").replace("comment", _comment).replace("tag", _tag).replace("attribute", / +[a-zA-Z:_][\w.:-]*(?: *= *"[^"\n]*"| *= *'[^'\n]*'| *= *[^\s"'=<>`]+)?/).getRegex();
var paragraph = edit(_paragraph).replace("hr", hr).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("|table", "").replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", _tag).getRegex();
var blockquote = edit(/^( {0,3}> ?(paragraph|[^\n]*)(?:\n|$))+/).replace("paragraph", paragraph).getRegex();
var blockNormal = {
  blockquote,
  code: blockCode,
  def,
  fences,
  heading,
  hr,
  html,
  lheading,
  list,
  newline,
  paragraph,
  table: noopTest,
  text: blockText
};
var gfmTable = edit("^ *([^\\n ].*)\\n {0,3}((?:\\| *)?:?-+:? *(?:\\| *:?-+:? *)*(?:\\| *)?)(?:\\n((?:(?! *\\n|hr|heading|blockquote|code|fences|list|html).*(?:\\n|$))*)\\n*|$)").replace("hr", hr).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("blockquote", " {0,3}>").replace("code", "(?: {4}| {0,3}	)[^\\n]").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", _tag).getRegex();
var blockGfm = {
  ...blockNormal,
  table: gfmTable,
  paragraph: edit(_paragraph).replace("hr", hr).replace("heading", " {0,3}#{1,6}(?:\\s|$)").replace("|lheading", "").replace("table", gfmTable).replace("blockquote", " {0,3}>").replace("fences", " {0,3}(?:`{3,}(?=[^`\\n]*\\n)|~{3,})[^\\n]*\\n").replace("list", " {0,3}(?:[*+-]|1[.)]) ").replace("html", "</?(?:tag)(?: +|\\n|/?>)|<(?:script|pre|style|textarea|!--)").replace("tag", _tag).getRegex()
};
var blockPedantic = {
  ...blockNormal,
  html: edit(`^ *(?:comment *(?:\\n|\\s*$)|<(tag)[\\s\\S]+?</\\1> *(?:\\n{2,}|\\s*$)|<tag(?:"[^"]*"|'[^']*'|\\s[^'"/>\\s]*)*?/?> *(?:\\n{2,}|\\s*$))`).replace("comment", _comment).replace(/tag/g, "(?!(?:a|em|strong|small|s|cite|q|dfn|abbr|data|time|code|var|samp|kbd|sub|sup|i|b|u|mark|ruby|rt|rp|bdi|bdo|span|br|wbr|ins|del|img)\\b)\\w+(?!:|[^\\w\\s@]*@)\\b").getRegex(),
  def: /^ *\[([^\]]+)\]: *<?([^\s>]+)>?(?: +(["(][^\n]+[")]))? *(?:\n+|$)/,
  heading: /^(#{1,6})(.*)(?:\n+|$)/,
  fences: noopTest,
  // fences not supported
  lheading: /^(.+?)\n {0,3}(=+|-+) *(?:\n+|$)/,
  paragraph: edit(_paragraph).replace("hr", hr).replace("heading", " *#{1,6} *[^\n]").replace("lheading", lheading).replace("|table", "").replace("blockquote", " {0,3}>").replace("|fences", "").replace("|list", "").replace("|html", "").replace("|tag", "").getRegex()
};
var escape = /^\\([!"#$%&'()*+,\-./:;<=>?@\[\]\\^_`{|}~])/;
var inlineCode = /^(`+)([^`]|[^`][\s\S]*?[^`])\1(?!`)/;
var br = /^( {2,}|\\)\n(?!\s*$)/;
var inlineText = /^(`+|[^`])(?:(?= {2,}\n)|[\s\S]*?(?:(?=[\\<!\[`*_]|\b_|$)|[^ ](?= {2,}\n)))/;
var _punctuation = "\\p{P}\\p{S}";
var punctuation = edit(/^((?![*_])[\spunctuation])/, "u").replace(/punctuation/g, _punctuation).getRegex();
var blockSkip = /\[[^[\]]*?\]\([^\(\)]*?\)|`[^`]*?`|<[^<>]*?>/g;
var emStrongLDelim = edit(/^(?:\*+(?:((?!\*)[punct])|[^\s*]))|^_+(?:((?!_)[punct])|([^\s_]))/, "u").replace(/punct/g, _punctuation).getRegex();
var emStrongRDelimAst = edit("^[^_*]*?__[^_*]*?\\*[^_*]*?(?=__)|[^*]+(?=[^*])|(?!\\*)[punct](\\*+)(?=[\\s]|$)|[^punct\\s](\\*+)(?!\\*)(?=[punct\\s]|$)|(?!\\*)[punct\\s](\\*+)(?=[^punct\\s])|[\\s](\\*+)(?!\\*)(?=[punct])|(?!\\*)[punct](\\*+)(?!\\*)(?=[punct])|[^punct\\s](\\*+)(?=[^punct\\s])", "gu").replace(/punct/g, _punctuation).getRegex();
var emStrongRDelimUnd = edit("^[^_*]*?\\*\\*[^_*]*?_[^_*]*?(?=\\*\\*)|[^_]+(?=[^_])|(?!_)[punct](_+)(?=[\\s]|$)|[^punct\\s](_+)(?!_)(?=[punct\\s]|$)|(?!_)[punct\\s](_+)(?=[^punct\\s])|[\\s](_+)(?!_)(?=[punct])|(?!_)[punct](_+)(?!_)(?=[punct])", "gu").replace(/punct/g, _punctuation).getRegex();
var anyPunctuation = edit(/\\([punct])/, "gu").replace(/punct/g, _punctuation).getRegex();
var autolink = edit(/^<(scheme:[^\s\x00-\x1f<>]*|email)>/).replace("scheme", /[a-zA-Z][a-zA-Z0-9+.-]{1,31}/).replace("email", /[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+(@)[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)+(?![-_])/).getRegex();
var _inlineComment = edit(_comment).replace("(?:-->|$)", "-->").getRegex();
var tag = edit("^comment|^</[a-zA-Z][\\w:-]*\\s*>|^<[a-zA-Z][\\w-]*(?:attribute)*?\\s*/?>|^<\\?[\\s\\S]*?\\?>|^<![a-zA-Z]+\\s[\\s\\S]*?>|^<!\\[CDATA\\[[\\s\\S]*?\\]\\]>").replace("comment", _inlineComment).replace("attribute", /\s+[a-zA-Z:_][\w.:-]*(?:\s*=\s*"[^"]*"|\s*=\s*'[^']*'|\s*=\s*[^\s"'=<>`]+)?/).getRegex();
var _inlineLabel = /(?:\[(?:\\.|[^\[\]\\])*\]|\\.|`[^`]*`|[^\[\]\\`])*?/;
var link = edit(/^!?\[(label)\]\(\s*(href)(?:\s+(title))?\s*\)/).replace("label", _inlineLabel).replace("href", /<(?:\\.|[^\n<>\\])+>|[^\s\x00-\x1f]*/).replace("title", /"(?:\\"?|[^"\\])*"|'(?:\\'?|[^'\\])*'|\((?:\\\)?|[^)\\])*\)/).getRegex();
var reflink = edit(/^!?\[(label)\]\[(ref)\]/).replace("label", _inlineLabel).replace("ref", _blockLabel).getRegex();
var nolink = edit(/^!?\[(ref)\](?:\[\])?/).replace("ref", _blockLabel).getRegex();
var reflinkSearch = edit("reflink|nolink(?!\\()", "g").replace("reflink", reflink).replace("nolink", nolink).getRegex();
var inlineNormal = {
  _backpedal: noopTest,
  // only used for GFM url
  anyPunctuation,
  autolink,
  blockSkip,
  br,
  code: inlineCode,
  del: noopTest,
  emStrongLDelim,
  emStrongRDelimAst,
  emStrongRDelimUnd,
  escape,
  link,
  nolink,
  punctuation,
  reflink,
  reflinkSearch,
  tag,
  text: inlineText,
  url: noopTest
};
var inlinePedantic = {
  ...inlineNormal,
  link: edit(/^!?\[(label)\]\((.*?)\)/).replace("label", _inlineLabel).getRegex(),
  reflink: edit(/^!?\[(label)\]\s*\[([^\]]*)\]/).replace("label", _inlineLabel).getRegex()
};
var inlineGfm = {
  ...inlineNormal,
  escape: edit(escape).replace("])", "~|])").getRegex(),
  url: edit(/^((?:ftp|https?):\/\/|www\.)(?:[a-zA-Z0-9\-]+\.?)+[^\s<]*|^email/, "i").replace("email", /[A-Za-z0-9._+-]+(@)[a-zA-Z0-9-_]+(?:\.[a-zA-Z0-9-_]*[a-zA-Z0-9])+(?![-_])/).getRegex(),
  _backpedal: /(?:[^?!.,:;*_'"~()&]+|\([^)]*\)|&(?![a-zA-Z0-9]+;$)|[?!.,:;*_'"~)]+(?!$))+/,
  del: /^(~~?)(?=[^\s~])([\s\S]*?[^\s~])\1(?=[^~]|$)/,
  text: /^([`~]+|[^`~])(?:(?= {2,}\n)|(?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)|[\s\S]*?(?:(?=[\\<!\[`*~_]|\b_|https?:\/\/|ftp:\/\/|www\.|$)|[^ ](?= {2,}\n)|[^a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-](?=[a-zA-Z0-9.!#$%&'*+\/=?_`{\|}~-]+@)))/
};
var inlineBreaks = {
  ...inlineGfm,
  br: edit(br).replace("{2,}", "*").getRegex(),
  text: edit(inlineGfm.text).replace("\\b_", "\\b_| {2,}\\n").replace(/\{2,\}/g, "*").getRegex()
};
var block = {
  normal: blockNormal,
  gfm: blockGfm,
  pedantic: blockPedantic
};
var inline = {
  normal: inlineNormal,
  gfm: inlineGfm,
  breaks: inlineBreaks,
  pedantic: inlinePedantic
};
var _Lexer = class __Lexer {
  tokens;
  options;
  state;
  tokenizer;
  inlineQueue;
  constructor(options2) {
    this.tokens = [];
    this.tokens.links = /* @__PURE__ */ Object.create(null);
    this.options = options2 || _defaults;
    this.options.tokenizer = this.options.tokenizer || new _Tokenizer();
    this.tokenizer = this.options.tokenizer;
    this.tokenizer.options = this.options;
    this.tokenizer.lexer = this;
    this.inlineQueue = [];
    this.state = {
      inLink: false,
      inRawBlock: false,
      top: true
    };
    const rules = {
      block: block.normal,
      inline: inline.normal
    };
    if (this.options.pedantic) {
      rules.block = block.pedantic;
      rules.inline = inline.pedantic;
    } else if (this.options.gfm) {
      rules.block = block.gfm;
      if (this.options.breaks) {
        rules.inline = inline.breaks;
      } else {
        rules.inline = inline.gfm;
      }
    }
    this.tokenizer.rules = rules;
  }
  /**
   * Expose Rules
   */
  static get rules() {
    return {
      block,
      inline
    };
  }
  /**
   * Static Lex Method
   */
  static lex(src, options2) {
    const lexer2 = new __Lexer(options2);
    return lexer2.lex(src);
  }
  /**
   * Static Lex Inline Method
   */
  static lexInline(src, options2) {
    const lexer2 = new __Lexer(options2);
    return lexer2.inlineTokens(src);
  }
  /**
   * Preprocessing
   */
  lex(src) {
    src = src.replace(/\r\n|\r/g, "\n");
    this.blockTokens(src, this.tokens);
    for (let i = 0; i < this.inlineQueue.length; i++) {
      const next = this.inlineQueue[i];
      this.inlineTokens(next.src, next.tokens);
    }
    this.inlineQueue = [];
    return this.tokens;
  }
  blockTokens(src, tokens = [], lastParagraphClipped = false) {
    if (this.options.pedantic) {
      src = src.replace(/\t/g, "    ").replace(/^ +$/gm, "");
    }
    let token;
    let lastToken;
    let cutSrc;
    while (src) {
      if (this.options.extensions && this.options.extensions.block && this.options.extensions.block.some((extTokenizer) => {
        if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }
      if (token = this.tokenizer.space(src)) {
        src = src.substring(token.raw.length);
        if (token.raw.length === 1 && tokens.length > 0) {
          tokens[tokens.length - 1].raw += "\n";
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (token = this.tokenizer.code(src)) {
        src = src.substring(token.raw.length);
        lastToken = tokens[tokens.length - 1];
        if (lastToken && (lastToken.type === "paragraph" || lastToken.type === "text")) {
          lastToken.raw += "\n" + token.raw;
          lastToken.text += "\n" + token.text;
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (token = this.tokenizer.fences(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.heading(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.hr(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.blockquote(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.list(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.html(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.def(src)) {
        src = src.substring(token.raw.length);
        lastToken = tokens[tokens.length - 1];
        if (lastToken && (lastToken.type === "paragraph" || lastToken.type === "text")) {
          lastToken.raw += "\n" + token.raw;
          lastToken.text += "\n" + token.raw;
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else if (!this.tokens.links[token.tag]) {
          this.tokens.links[token.tag] = {
            href: token.href,
            title: token.title
          };
        }
        continue;
      }
      if (token = this.tokenizer.table(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.lheading(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      cutSrc = src;
      if (this.options.extensions && this.options.extensions.startBlock) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        let tempStart;
        this.options.extensions.startBlock.forEach((getStartIndex) => {
          tempStart = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof tempStart === "number" && tempStart >= 0) {
            startIndex = Math.min(startIndex, tempStart);
          }
        });
        if (startIndex < Infinity && startIndex >= 0) {
          cutSrc = src.substring(0, startIndex + 1);
        }
      }
      if (this.state.top && (token = this.tokenizer.paragraph(cutSrc))) {
        lastToken = tokens[tokens.length - 1];
        if (lastParagraphClipped && lastToken?.type === "paragraph") {
          lastToken.raw += "\n" + token.raw;
          lastToken.text += "\n" + token.text;
          this.inlineQueue.pop();
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else {
          tokens.push(token);
        }
        lastParagraphClipped = cutSrc.length !== src.length;
        src = src.substring(token.raw.length);
        continue;
      }
      if (token = this.tokenizer.text(src)) {
        src = src.substring(token.raw.length);
        lastToken = tokens[tokens.length - 1];
        if (lastToken && lastToken.type === "text") {
          lastToken.raw += "\n" + token.raw;
          lastToken.text += "\n" + token.text;
          this.inlineQueue.pop();
          this.inlineQueue[this.inlineQueue.length - 1].src = lastToken.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (src) {
        const errMsg = "Infinite loop on byte: " + src.charCodeAt(0);
        if (this.options.silent) {
          console.error(errMsg);
          break;
        } else {
          throw new Error(errMsg);
        }
      }
    }
    this.state.top = true;
    return tokens;
  }
  inline(src, tokens = []) {
    this.inlineQueue.push({ src, tokens });
    return tokens;
  }
  /**
   * Lexing/Compiling
   */
  inlineTokens(src, tokens = []) {
    let token, lastToken, cutSrc;
    let maskedSrc = src;
    let match;
    let keepPrevChar, prevChar;
    if (this.tokens.links) {
      const links = Object.keys(this.tokens.links);
      if (links.length > 0) {
        while ((match = this.tokenizer.rules.inline.reflinkSearch.exec(maskedSrc)) != null) {
          if (links.includes(match[0].slice(match[0].lastIndexOf("[") + 1, -1))) {
            maskedSrc = maskedSrc.slice(0, match.index) + "[" + "a".repeat(match[0].length - 2) + "]" + maskedSrc.slice(this.tokenizer.rules.inline.reflinkSearch.lastIndex);
          }
        }
      }
    }
    while ((match = this.tokenizer.rules.inline.blockSkip.exec(maskedSrc)) != null) {
      maskedSrc = maskedSrc.slice(0, match.index) + "[" + "a".repeat(match[0].length - 2) + "]" + maskedSrc.slice(this.tokenizer.rules.inline.blockSkip.lastIndex);
    }
    while ((match = this.tokenizer.rules.inline.anyPunctuation.exec(maskedSrc)) != null) {
      maskedSrc = maskedSrc.slice(0, match.index) + "++" + maskedSrc.slice(this.tokenizer.rules.inline.anyPunctuation.lastIndex);
    }
    while (src) {
      if (!keepPrevChar) {
        prevChar = "";
      }
      keepPrevChar = false;
      if (this.options.extensions && this.options.extensions.inline && this.options.extensions.inline.some((extTokenizer) => {
        if (token = extTokenizer.call({ lexer: this }, src, tokens)) {
          src = src.substring(token.raw.length);
          tokens.push(token);
          return true;
        }
        return false;
      })) {
        continue;
      }
      if (token = this.tokenizer.escape(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.tag(src)) {
        src = src.substring(token.raw.length);
        lastToken = tokens[tokens.length - 1];
        if (lastToken && token.type === "text" && lastToken.type === "text") {
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (token = this.tokenizer.link(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.reflink(src, this.tokens.links)) {
        src = src.substring(token.raw.length);
        lastToken = tokens[tokens.length - 1];
        if (lastToken && token.type === "text" && lastToken.type === "text") {
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (token = this.tokenizer.emStrong(src, maskedSrc, prevChar)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.codespan(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.br(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.del(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (token = this.tokenizer.autolink(src)) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      if (!this.state.inLink && (token = this.tokenizer.url(src))) {
        src = src.substring(token.raw.length);
        tokens.push(token);
        continue;
      }
      cutSrc = src;
      if (this.options.extensions && this.options.extensions.startInline) {
        let startIndex = Infinity;
        const tempSrc = src.slice(1);
        let tempStart;
        this.options.extensions.startInline.forEach((getStartIndex) => {
          tempStart = getStartIndex.call({ lexer: this }, tempSrc);
          if (typeof tempStart === "number" && tempStart >= 0) {
            startIndex = Math.min(startIndex, tempStart);
          }
        });
        if (startIndex < Infinity && startIndex >= 0) {
          cutSrc = src.substring(0, startIndex + 1);
        }
      }
      if (token = this.tokenizer.inlineText(cutSrc)) {
        src = src.substring(token.raw.length);
        if (token.raw.slice(-1) !== "_") {
          prevChar = token.raw.slice(-1);
        }
        keepPrevChar = true;
        lastToken = tokens[tokens.length - 1];
        if (lastToken && lastToken.type === "text") {
          lastToken.raw += token.raw;
          lastToken.text += token.text;
        } else {
          tokens.push(token);
        }
        continue;
      }
      if (src) {
        const errMsg = "Infinite loop on byte: " + src.charCodeAt(0);
        if (this.options.silent) {
          console.error(errMsg);
          break;
        } else {
          throw new Error(errMsg);
        }
      }
    }
    return tokens;
  }
};
var _Renderer = class {
  options;
  parser;
  // set by the parser
  constructor(options2) {
    this.options = options2 || _defaults;
  }
  space(token) {
    return "";
  }
  code({ text, lang, escaped }) {
    const langString = (lang || "").match(/^\S*/)?.[0];
    const code = text.replace(/\n$/, "") + "\n";
    if (!langString) {
      return "<pre><code>" + (escaped ? code : escape$1(code, true)) + "</code></pre>\n";
    }
    return '<pre><code class="language-' + escape$1(langString) + '">' + (escaped ? code : escape$1(code, true)) + "</code></pre>\n";
  }
  blockquote({ tokens }) {
    const body = this.parser.parse(tokens);
    return `<blockquote>
${body}</blockquote>
`;
  }
  html({ text }) {
    return text;
  }
  heading({ tokens, depth }) {
    return `<h${depth}>${this.parser.parseInline(tokens)}</h${depth}>
`;
  }
  hr(token) {
    return "<hr>\n";
  }
  list(token) {
    const ordered = token.ordered;
    const start = token.start;
    let body = "";
    for (let j = 0; j < token.items.length; j++) {
      const item = token.items[j];
      body += this.listitem(item);
    }
    const type = ordered ? "ol" : "ul";
    const startAttr = ordered && start !== 1 ? ' start="' + start + '"' : "";
    return "<" + type + startAttr + ">\n" + body + "</" + type + ">\n";
  }
  listitem(item) {
    let itemBody = "";
    if (item.task) {
      const checkbox = this.checkbox({ checked: !!item.checked });
      if (item.loose) {
        if (item.tokens.length > 0 && item.tokens[0].type === "paragraph") {
          item.tokens[0].text = checkbox + " " + item.tokens[0].text;
          if (item.tokens[0].tokens && item.tokens[0].tokens.length > 0 && item.tokens[0].tokens[0].type === "text") {
            item.tokens[0].tokens[0].text = checkbox + " " + item.tokens[0].tokens[0].text;
          }
        } else {
          item.tokens.unshift({
            type: "text",
            raw: checkbox + " ",
            text: checkbox + " "
          });
        }
      } else {
        itemBody += checkbox + " ";
      }
    }
    itemBody += this.parser.parse(item.tokens, !!item.loose);
    return `<li>${itemBody}</li>
`;
  }
  checkbox({ checked }) {
    return "<input " + (checked ? 'checked="" ' : "") + 'disabled="" type="checkbox">';
  }
  paragraph({ tokens }) {
    return `<p>${this.parser.parseInline(tokens)}</p>
`;
  }
  table(token) {
    let header = "";
    let cell = "";
    for (let j = 0; j < token.header.length; j++) {
      cell += this.tablecell(token.header[j]);
    }
    header += this.tablerow({ text: cell });
    let body = "";
    for (let j = 0; j < token.rows.length; j++) {
      const row = token.rows[j];
      cell = "";
      for (let k = 0; k < row.length; k++) {
        cell += this.tablecell(row[k]);
      }
      body += this.tablerow({ text: cell });
    }
    if (body)
      body = `<tbody>${body}</tbody>`;
    return "<table>\n<thead>\n" + header + "</thead>\n" + body + "</table>\n";
  }
  tablerow({ text }) {
    return `<tr>
${text}</tr>
`;
  }
  tablecell(token) {
    const content = this.parser.parseInline(token.tokens);
    const type = token.header ? "th" : "td";
    const tag2 = token.align ? `<${type} align="${token.align}">` : `<${type}>`;
    return tag2 + content + `</${type}>
`;
  }
  /**
   * span level renderer
   */
  strong({ tokens }) {
    return `<strong>${this.parser.parseInline(tokens)}</strong>`;
  }
  em({ tokens }) {
    return `<em>${this.parser.parseInline(tokens)}</em>`;
  }
  codespan({ text }) {
    return `<code>${text}</code>`;
  }
  br(token) {
    return "<br>";
  }
  del({ tokens }) {
    return `<del>${this.parser.parseInline(tokens)}</del>`;
  }
  link({ href, title, tokens }) {
    const text = this.parser.parseInline(tokens);
    const cleanHref = cleanUrl(href);
    if (cleanHref === null) {
      return text;
    }
    href = cleanHref;
    let out = '<a href="' + href + '"';
    if (title) {
      out += ' title="' + title + '"';
    }
    out += ">" + text + "</a>";
    return out;
  }
  image({ href, title, text }) {
    const cleanHref = cleanUrl(href);
    if (cleanHref === null) {
      return text;
    }
    href = cleanHref;
    let out = `<img src="${href}" alt="${text}"`;
    if (title) {
      out += ` title="${title}"`;
    }
    out += ">";
    return out;
  }
  text(token) {
    return "tokens" in token && token.tokens ? this.parser.parseInline(token.tokens) : token.text;
  }
};
var _TextRenderer = class {
  // no need for block level renderers
  strong({ text }) {
    return text;
  }
  em({ text }) {
    return text;
  }
  codespan({ text }) {
    return text;
  }
  del({ text }) {
    return text;
  }
  html({ text }) {
    return text;
  }
  text({ text }) {
    return text;
  }
  link({ text }) {
    return "" + text;
  }
  image({ text }) {
    return "" + text;
  }
  br() {
    return "";
  }
};
var _Parser = class __Parser {
  options;
  renderer;
  textRenderer;
  constructor(options2) {
    this.options = options2 || _defaults;
    this.options.renderer = this.options.renderer || new _Renderer();
    this.renderer = this.options.renderer;
    this.renderer.options = this.options;
    this.renderer.parser = this;
    this.textRenderer = new _TextRenderer();
  }
  /**
   * Static Parse Method
   */
  static parse(tokens, options2) {
    const parser2 = new __Parser(options2);
    return parser2.parse(tokens);
  }
  /**
   * Static Parse Inline Method
   */
  static parseInline(tokens, options2) {
    const parser2 = new __Parser(options2);
    return parser2.parseInline(tokens);
  }
  /**
   * Parse Loop
   */
  parse(tokens, top = true) {
    let out = "";
    for (let i = 0; i < tokens.length; i++) {
      const anyToken = tokens[i];
      if (this.options.extensions && this.options.extensions.renderers && this.options.extensions.renderers[anyToken.type]) {
        const genericToken = anyToken;
        const ret = this.options.extensions.renderers[genericToken.type].call({ parser: this }, genericToken);
        if (ret !== false || !["space", "hr", "heading", "code", "table", "blockquote", "list", "html", "paragraph", "text"].includes(genericToken.type)) {
          out += ret || "";
          continue;
        }
      }
      const token = anyToken;
      switch (token.type) {
        case "space": {
          out += this.renderer.space(token);
          continue;
        }
        case "hr": {
          out += this.renderer.hr(token);
          continue;
        }
        case "heading": {
          out += this.renderer.heading(token);
          continue;
        }
        case "code": {
          out += this.renderer.code(token);
          continue;
        }
        case "table": {
          out += this.renderer.table(token);
          continue;
        }
        case "blockquote": {
          out += this.renderer.blockquote(token);
          continue;
        }
        case "list": {
          out += this.renderer.list(token);
          continue;
        }
        case "html": {
          out += this.renderer.html(token);
          continue;
        }
        case "paragraph": {
          out += this.renderer.paragraph(token);
          continue;
        }
        case "text": {
          let textToken = token;
          let body = this.renderer.text(textToken);
          while (i + 1 < tokens.length && tokens[i + 1].type === "text") {
            textToken = tokens[++i];
            body += "\n" + this.renderer.text(textToken);
          }
          if (top) {
            out += this.renderer.paragraph({
              type: "paragraph",
              raw: body,
              text: body,
              tokens: [{ type: "text", raw: body, text: body }]
            });
          } else {
            out += body;
          }
          continue;
        }
        default: {
          const errMsg = 'Token with "' + token.type + '" type was not found.';
          if (this.options.silent) {
            console.error(errMsg);
            return "";
          } else {
            throw new Error(errMsg);
          }
        }
      }
    }
    return out;
  }
  /**
   * Parse Inline Tokens
   */
  parseInline(tokens, renderer) {
    renderer = renderer || this.renderer;
    let out = "";
    for (let i = 0; i < tokens.length; i++) {
      const anyToken = tokens[i];
      if (this.options.extensions && this.options.extensions.renderers && this.options.extensions.renderers[anyToken.type]) {
        const ret = this.options.extensions.renderers[anyToken.type].call({ parser: this }, anyToken);
        if (ret !== false || !["escape", "html", "link", "image", "strong", "em", "codespan", "br", "del", "text"].includes(anyToken.type)) {
          out += ret || "";
          continue;
        }
      }
      const token = anyToken;
      switch (token.type) {
        case "escape": {
          out += renderer.text(token);
          break;
        }
        case "html": {
          out += renderer.html(token);
          break;
        }
        case "link": {
          out += renderer.link(token);
          break;
        }
        case "image": {
          out += renderer.image(token);
          break;
        }
        case "strong": {
          out += renderer.strong(token);
          break;
        }
        case "em": {
          out += renderer.em(token);
          break;
        }
        case "codespan": {
          out += renderer.codespan(token);
          break;
        }
        case "br": {
          out += renderer.br(token);
          break;
        }
        case "del": {
          out += renderer.del(token);
          break;
        }
        case "text": {
          out += renderer.text(token);
          break;
        }
        default: {
          const errMsg = 'Token with "' + token.type + '" type was not found.';
          if (this.options.silent) {
            console.error(errMsg);
            return "";
          } else {
            throw new Error(errMsg);
          }
        }
      }
    }
    return out;
  }
};
var _Hooks = class {
  options;
  block;
  constructor(options2) {
    this.options = options2 || _defaults;
  }
  static passThroughHooks = /* @__PURE__ */ new Set([
    "preprocess",
    "postprocess",
    "processAllTokens"
  ]);
  /**
   * Process markdown before marked
   */
  preprocess(markdown) {
    return markdown;
  }
  /**
   * Process HTML after marked is finished
   */
  postprocess(html2) {
    return html2;
  }
  /**
   * Process all tokens before walk tokens
   */
  processAllTokens(tokens) {
    return tokens;
  }
  /**
   * Provide function to tokenize markdown
   */
  provideLexer() {
    return this.block ? _Lexer.lex : _Lexer.lexInline;
  }
  /**
   * Provide function to parse tokens
   */
  provideParser() {
    return this.block ? _Parser.parse : _Parser.parseInline;
  }
};
var Marked = class {
  defaults = _getDefaults();
  options = this.setOptions;
  parse = this.parseMarkdown(true);
  parseInline = this.parseMarkdown(false);
  Parser = _Parser;
  Renderer = _Renderer;
  TextRenderer = _TextRenderer;
  Lexer = _Lexer;
  Tokenizer = _Tokenizer;
  Hooks = _Hooks;
  constructor(...args) {
    this.use(...args);
  }
  /**
   * Run callback for every token
   */
  walkTokens(tokens, callback) {
    let values = [];
    for (const token of tokens) {
      values = values.concat(callback.call(this, token));
      switch (token.type) {
        case "table": {
          const tableToken = token;
          for (const cell of tableToken.header) {
            values = values.concat(this.walkTokens(cell.tokens, callback));
          }
          for (const row of tableToken.rows) {
            for (const cell of row) {
              values = values.concat(this.walkTokens(cell.tokens, callback));
            }
          }
          break;
        }
        case "list": {
          const listToken = token;
          values = values.concat(this.walkTokens(listToken.items, callback));
          break;
        }
        default: {
          const genericToken = token;
          if (this.defaults.extensions?.childTokens?.[genericToken.type]) {
            this.defaults.extensions.childTokens[genericToken.type].forEach((childTokens) => {
              const tokens2 = genericToken[childTokens].flat(Infinity);
              values = values.concat(this.walkTokens(tokens2, callback));
            });
          } else if (genericToken.tokens) {
            values = values.concat(this.walkTokens(genericToken.tokens, callback));
          }
        }
      }
    }
    return values;
  }
  use(...args) {
    const extensions = this.defaults.extensions || { renderers: {}, childTokens: {} };
    args.forEach((pack) => {
      const opts = { ...pack };
      opts.async = this.defaults.async || opts.async || false;
      if (pack.extensions) {
        pack.extensions.forEach((ext) => {
          if (!ext.name) {
            throw new Error("extension name required");
          }
          if ("renderer" in ext) {
            const prevRenderer = extensions.renderers[ext.name];
            if (prevRenderer) {
              extensions.renderers[ext.name] = function(...args2) {
                let ret = ext.renderer.apply(this, args2);
                if (ret === false) {
                  ret = prevRenderer.apply(this, args2);
                }
                return ret;
              };
            } else {
              extensions.renderers[ext.name] = ext.renderer;
            }
          }
          if ("tokenizer" in ext) {
            if (!ext.level || ext.level !== "block" && ext.level !== "inline") {
              throw new Error("extension level must be 'block' or 'inline'");
            }
            const extLevel = extensions[ext.level];
            if (extLevel) {
              extLevel.unshift(ext.tokenizer);
            } else {
              extensions[ext.level] = [ext.tokenizer];
            }
            if (ext.start) {
              if (ext.level === "block") {
                if (extensions.startBlock) {
                  extensions.startBlock.push(ext.start);
                } else {
                  extensions.startBlock = [ext.start];
                }
              } else if (ext.level === "inline") {
                if (extensions.startInline) {
                  extensions.startInline.push(ext.start);
                } else {
                  extensions.startInline = [ext.start];
                }
              }
            }
          }
          if ("childTokens" in ext && ext.childTokens) {
            extensions.childTokens[ext.name] = ext.childTokens;
          }
        });
        opts.extensions = extensions;
      }
      if (pack.renderer) {
        const renderer = this.defaults.renderer || new _Renderer(this.defaults);
        for (const prop in pack.renderer) {
          if (!(prop in renderer)) {
            throw new Error(`renderer '${prop}' does not exist`);
          }
          if (["options", "parser"].includes(prop)) {
            continue;
          }
          const rendererProp = prop;
          const rendererFunc = pack.renderer[rendererProp];
          const prevRenderer = renderer[rendererProp];
          renderer[rendererProp] = (...args2) => {
            let ret = rendererFunc.apply(renderer, args2);
            if (ret === false) {
              ret = prevRenderer.apply(renderer, args2);
            }
            return ret || "";
          };
        }
        opts.renderer = renderer;
      }
      if (pack.tokenizer) {
        const tokenizer = this.defaults.tokenizer || new _Tokenizer(this.defaults);
        for (const prop in pack.tokenizer) {
          if (!(prop in tokenizer)) {
            throw new Error(`tokenizer '${prop}' does not exist`);
          }
          if (["options", "rules", "lexer"].includes(prop)) {
            continue;
          }
          const tokenizerProp = prop;
          const tokenizerFunc = pack.tokenizer[tokenizerProp];
          const prevTokenizer = tokenizer[tokenizerProp];
          tokenizer[tokenizerProp] = (...args2) => {
            let ret = tokenizerFunc.apply(tokenizer, args2);
            if (ret === false) {
              ret = prevTokenizer.apply(tokenizer, args2);
            }
            return ret;
          };
        }
        opts.tokenizer = tokenizer;
      }
      if (pack.hooks) {
        const hooks = this.defaults.hooks || new _Hooks();
        for (const prop in pack.hooks) {
          if (!(prop in hooks)) {
            throw new Error(`hook '${prop}' does not exist`);
          }
          if (["options", "block"].includes(prop)) {
            continue;
          }
          const hooksProp = prop;
          const hooksFunc = pack.hooks[hooksProp];
          const prevHook = hooks[hooksProp];
          if (_Hooks.passThroughHooks.has(prop)) {
            hooks[hooksProp] = (arg) => {
              if (this.defaults.async) {
                return Promise.resolve(hooksFunc.call(hooks, arg)).then((ret2) => {
                  return prevHook.call(hooks, ret2);
                });
              }
              const ret = hooksFunc.call(hooks, arg);
              return prevHook.call(hooks, ret);
            };
          } else {
            hooks[hooksProp] = (...args2) => {
              let ret = hooksFunc.apply(hooks, args2);
              if (ret === false) {
                ret = prevHook.apply(hooks, args2);
              }
              return ret;
            };
          }
        }
        opts.hooks = hooks;
      }
      if (pack.walkTokens) {
        const walkTokens2 = this.defaults.walkTokens;
        const packWalktokens = pack.walkTokens;
        opts.walkTokens = function(token) {
          let values = [];
          values.push(packWalktokens.call(this, token));
          if (walkTokens2) {
            values = values.concat(walkTokens2.call(this, token));
          }
          return values;
        };
      }
      this.defaults = { ...this.defaults, ...opts };
    });
    return this;
  }
  setOptions(opt) {
    this.defaults = { ...this.defaults, ...opt };
    return this;
  }
  lexer(src, options2) {
    return _Lexer.lex(src, options2 ?? this.defaults);
  }
  parser(tokens, options2) {
    return _Parser.parse(tokens, options2 ?? this.defaults);
  }
  parseMarkdown(blockType) {
    const parse = (src, options2) => {
      const origOpt = { ...options2 };
      const opt = { ...this.defaults, ...origOpt };
      const throwError = this.onError(!!opt.silent, !!opt.async);
      if (this.defaults.async === true && origOpt.async === false) {
        return throwError(new Error("marked(): The async option was set to true by an extension. Remove async: false from the parse options object to return a Promise."));
      }
      if (typeof src === "undefined" || src === null) {
        return throwError(new Error("marked(): input parameter is undefined or null"));
      }
      if (typeof src !== "string") {
        return throwError(new Error("marked(): input parameter is of type " + Object.prototype.toString.call(src) + ", string expected"));
      }
      if (opt.hooks) {
        opt.hooks.options = opt;
        opt.hooks.block = blockType;
      }
      const lexer2 = opt.hooks ? opt.hooks.provideLexer() : blockType ? _Lexer.lex : _Lexer.lexInline;
      const parser2 = opt.hooks ? opt.hooks.provideParser() : blockType ? _Parser.parse : _Parser.parseInline;
      if (opt.async) {
        return Promise.resolve(opt.hooks ? opt.hooks.preprocess(src) : src).then((src2) => lexer2(src2, opt)).then((tokens) => opt.hooks ? opt.hooks.processAllTokens(tokens) : tokens).then((tokens) => opt.walkTokens ? Promise.all(this.walkTokens(tokens, opt.walkTokens)).then(() => tokens) : tokens).then((tokens) => parser2(tokens, opt)).then((html2) => opt.hooks ? opt.hooks.postprocess(html2) : html2).catch(throwError);
      }
      try {
        if (opt.hooks) {
          src = opt.hooks.preprocess(src);
        }
        let tokens = lexer2(src, opt);
        if (opt.hooks) {
          tokens = opt.hooks.processAllTokens(tokens);
        }
        if (opt.walkTokens) {
          this.walkTokens(tokens, opt.walkTokens);
        }
        let html2 = parser2(tokens, opt);
        if (opt.hooks) {
          html2 = opt.hooks.postprocess(html2);
        }
        return html2;
      } catch (e) {
        return throwError(e);
      }
    };
    return parse;
  }
  onError(silent, async) {
    return (e) => {
      e.message += "\nPlease report this to https://github.com/markedjs/marked.";
      if (silent) {
        const msg = "<p>An error occurred:</p><pre>" + escape$1(e.message + "", true) + "</pre>";
        if (async) {
          return Promise.resolve(msg);
        }
        return msg;
      }
      if (async) {
        return Promise.reject(e);
      }
      throw e;
    };
  }
};
var markedInstance = new Marked();
function marked(src, opt) {
  return markedInstance.parse(src, opt);
}
marked.options = marked.setOptions = function(options2) {
  markedInstance.setOptions(options2);
  marked.defaults = markedInstance.defaults;
  changeDefaults(marked.defaults);
  return marked;
};
marked.getDefaults = _getDefaults;
marked.defaults = _defaults;
marked.use = function(...args) {
  markedInstance.use(...args);
  marked.defaults = markedInstance.defaults;
  changeDefaults(marked.defaults);
  return marked;
};
marked.walkTokens = function(tokens, callback) {
  return markedInstance.walkTokens(tokens, callback);
};
marked.parseInline = markedInstance.parseInline;
marked.Parser = _Parser;
marked.parser = _Parser.parse;
marked.Renderer = _Renderer;
marked.TextRenderer = _TextRenderer;
marked.Lexer = _Lexer;
marked.lexer = _Lexer.lex;
marked.Tokenizer = _Tokenizer;
marked.Hooks = _Hooks;
marked.parse = marked;
var options = marked.options;
var setOptions = marked.setOptions;
var use = marked.use;
var walkTokens = marked.walkTokens;
var parseInline = marked.parseInline;
var parser = _Parser.parse;
var lexer = _Lexer.lex;

// web/markdown.js
function escapeHtml(value) {
  return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
function resolveDocUrl(href, base) {
  if (!href) return "";
  const value = String(href).trim();
  if (/^(https?:|mailto:)/i.test(value) || value.startsWith("#")) return value;
  if (/^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//")) return "";
  return base + value.replace(/^\.?\//, "");
}
function renderDocsHtml(markdown, repo, tag2, images, bases) {
  const rawBase = bases && bases.imageBase || `https://raw.githubusercontent.com/${repo}/${tag2}/`;
  const blobBase = bases && bases.linkBase || `https://github.com/${repo}/blob/${tag2}/`;
  const imageMap = images || {};
  const md = new Marked();
  md.use({
    gfm: true,
    walkTokens(token) {
      if (token.type === "link") token.href = resolveDocUrl(token.href, blobBase);
      if (token.type === "image") {
        const key = String(token.href || "").trim().replace(/^\.?\//, "");
        token.href = Object.prototype.hasOwnProperty.call(imageMap, key) ? imageMap[key] : resolveDocUrl(token.href, rawBase);
      }
    },
    renderer: {
      // Raw HTML (block and inline) is escaped rather than emitted, so publisher
      // markup can never introduce a live element into the admin DOM.
      html(token) {
        const raw = token && typeof token === "object" ? token.text != null ? token.text : token.raw : token;
        return escapeHtml(raw != null ? raw : "");
      }
    }
  });
  let html2 = md.parse(markdown, { async: false });
  html2 = html2.replace(/<a href="(https?:[^"]*)"/g, '<a target="_blank" rel="noopener noreferrer" href="$1"');
  return html2;
}

// web/plugin.jsx
var React = platform.React;
var BASE = "/extensions/communitystore";
var DOCS_CSS = `
.cs-docs { line-height: 1.55; overflow-wrap: break-word; }
.cs-docs img { max-width: 100%; }
.cs-docs pre { overflow-x: auto; padding: 8px 10px; border: 1px solid var(--line, #8884); border-radius: 4px; }
.cs-docs code { font-family: monospace; font-size: 0.9em; }
.cs-docs table { border-collapse: collapse; }
.cs-docs th, .cs-docs td { border: 1px solid var(--line, #8884); padding: 4px 8px; }
.cs-docs blockquote { border-left: 3px solid var(--line, #8884); margin-left: 0; padding-left: 12px; }
.cs-docs h1, .cs-docs h2 { border-bottom: 1px solid var(--line, #8884); padding-bottom: 4px; }
`;
function parseMaybeJson(value) {
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch (e) {
      return value;
    }
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
  try {
    platform.ui.toast(message, kind);
  } catch (e) {
  }
}
function errText(e) {
  return e && (e.message || e.statusText) ? e.message || e.statusText : String(e);
}
var TYPE_LABELS = {
  connector: "Connector",
  plugin: "Plugin",
  datatype: "Data Type",
  channel: "Channel",
  "code-template-library": "Code Template Library",
  "code-template": "Code Template"
};
var TYPE_ORDER = ["connector", "plugin", "datatype", "channel", "code-template-library", "code-template"];
var typeRank = (t) => {
  const i = TYPE_ORDER.indexOf(t);
  return i < 0 ? TYPE_ORDER.length : i;
};
var CONTENT_TYPES = ["channel", "code-template-library", "code-template"];
var isContentType = (t) => CONTENT_TYPES.includes(t);
function normalizeLibraries(resp) {
  let node = resp && resp.list !== void 0 ? resp.list : resp;
  let arr = node && node.codeTemplateLibrary;
  if (!arr) return [];
  if (!Array.isArray(arr)) arr = [arr];
  return arr.map((l) => ({ id: l && l.id, name: l && l.name || l.id })).filter((l) => l.id);
}
function getPref(key, fallback) {
  try {
    const v = localStorage.getItem("communitystore." + key);
    return v === null ? fallback : v;
  } catch (e) {
    return fallback;
  }
}
function setPref(key, value) {
  try {
    localStorage.setItem("communitystore." + key, value);
  } catch (e) {
  }
}
function TypeTag({ type }) {
  return /* @__PURE__ */ React.createElement("span", { className: "tag" }, TYPE_LABELS[type] || type);
}
function Badges({ entry }) {
  return /* @__PURE__ */ React.createElement("span", { className: "flex gap-1 items-center flex-wrap" }, entry.installedVersion ? /* @__PURE__ */ React.createElement("span", { className: "tag" }, "Installed ", entry.installedVersion) : null, entry.updateAvailable ? /* @__PURE__ */ React.createElement("span", { className: "tag text-accent" }, "Update ", entry.version) : null, entry.revoked ? /* @__PURE__ */ React.createElement("span", { className: "tag text-err", title: entry.description }, entry.revokedReason === "blocked" ? "Blocked by source" : "Removed from source") : null, !entry.compatible && !entry.revoked ? /* @__PURE__ */ React.createElement("span", { className: "tag" }, "Incompatible") : null, entry.deprecated ? /* @__PURE__ */ React.createElement("span", { className: "tag" }, "Deprecated") : null);
}
function ConfirmOverlay({ title, children, confirmLabel, onConfirm, onCancel, busy }) {
  return /* @__PURE__ */ React.createElement("div", { className: "fixed inset-0 flex items-center justify-center", style: { background: "rgba(0,0,0,0.45)", zIndex: 1e3 } }, /* @__PURE__ */ React.createElement("div", { className: "panel", style: { width: 460, maxWidth: "90vw" } }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, title), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, children, /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mt-4", style: { justifyContent: "flex-end" } }, /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: onCancel, disabled: busy }, "Cancel"), /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: onConfirm, disabled: busy }, busy ? "Working\u2026" : confirmLabel)))));
}
function useStoreActions(refresh) {
  const [confirm, setConfirm] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const [libraries, setLibraries] = React.useState([]);
  const [libMode, setLibMode] = React.useState("new");
  const [newLib, setNewLib] = React.useState("");
  const [existingLib, setExistingLib] = React.useState("");
  const requestInstall = async (entry) => {
    setConfirm({ entry, mode: "install" });
    if (entry.type === "code-template") {
      setLibMode("new");
      setNewLib(entry.name || "Community Store");
      setExistingLib("");
      setLibraries([]);
      try {
        setLibraries(normalizeLibraries(await apiGet("/codeTemplateLibraries")));
      } catch (e) {
        setLibraries([]);
      }
    }
  };
  const execute = async () => {
    if (!confirm) return;
    const entry = confirm.entry;
    const content = isContentType(entry.type);
    setBusy(true);
    try {
      {
        const body = { id: entry.id, tag: entry.tag };
        if (entry.type === "code-template") {
          if (libMode === "existing") {
            if (!existingLib) {
              toast("Choose a library to add this code template to.", "warn");
              setBusy(false);
              return;
            }
            body.targetLibraryId = existingLib;
          } else {
            body.newLibrary = (newLib || "").trim() || "Community Store";
          }
        }
        await apiPost(`${BASE}/_install`, body);
        toast(content ? `Imported ${entry.name}. It's available now.` : `Installed ${entry.name} ${entry.version}. Restart the engine to activate it.`, "success");
        if (!content) {
          try {
            window.dispatchEvent(new Event("webadmin:restart-pending"));
          } catch (e) {
          }
        }
      }
      setConfirm(null);
      await refresh(false);
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setBusy(false);
    }
  };
  let overlay = null;
  if (confirm) {
    const entry = confirm.entry;
    const content = isContentType(entry.type);
    const isCodeTemplate = entry.type === "code-template";
    overlay = /* @__PURE__ */ React.createElement(
      ConfirmOverlay,
      {
        title: `${content ? "Import" : "Install"} ${entry.name}?`,
        confirmLabel: content ? "Import" : `Install ${entry.version}`,
        busy,
        onCancel: () => setConfirm(null),
        onConfirm: execute
      },
      /* @__PURE__ */ React.createElement("div", null, content ? /* @__PURE__ */ React.createElement("p", null, "Imports the ", TYPE_LABELS[entry.type] || entry.type, " ", /* @__PURE__ */ React.createElement("strong", null, entry.name), " from", " ", /* @__PURE__ */ React.createElement("span", { className: "mono" }, entry.repo), " (", entry.tag, "). It takes effect immediately \u2014 no engine restart.") : /* @__PURE__ */ React.createElement("p", null, "This installs ", /* @__PURE__ */ React.createElement("span", { className: "mono" }, entry.repo), " release", " ", /* @__PURE__ */ React.createElement("span", { className: "mono" }, entry.tag), " into the engine's extensions directory after sha256 verification."), isCodeTemplate ? /* @__PURE__ */ React.createElement("div", { className: "mt-3" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-dim mb-1" }, "Add to library:"), /* @__PURE__ */ React.createElement("label", { className: "flex items-center gap-2 mb-1", style: { cursor: "pointer" } }, /* @__PURE__ */ React.createElement("input", { type: "radio", name: "cs-lib", checked: libMode === "new", onChange: () => setLibMode("new") }), "Create new library:", /* @__PURE__ */ React.createElement(
        "input",
        {
          className: "field",
          style: { maxWidth: 220 },
          value: newLib,
          placeholder: "Library name",
          onFocus: () => setLibMode("new"),
          onChange: (e) => setNewLib(e.target.value)
        }
      )), /* @__PURE__ */ React.createElement("label", { className: "flex items-center gap-2", style: { cursor: libraries.length ? "pointer" : "default" } }, /* @__PURE__ */ React.createElement("input", { type: "radio", name: "cs-lib", checked: libMode === "existing", disabled: !libraries.length, onChange: () => setLibMode("existing") }), "Existing library:", /* @__PURE__ */ React.createElement(
        "select",
        {
          className: "field",
          style: { maxWidth: 220 },
          value: existingLib,
          disabled: !libraries.length,
          onChange: (e) => {
            setExistingLib(e.target.value);
            setLibMode("existing");
          }
        },
        /* @__PURE__ */ React.createElement("option", { value: "" }, libraries.length ? "Select a library\u2026" : "No libraries yet"),
        libraries.map((l) => /* @__PURE__ */ React.createElement("option", { key: l.id, value: l.id }, l.name))
      ))) : null, /* @__PURE__ */ React.createElement("p", { className: "hint mt-2" }, "Community content is published by third parties and is not vetted by the Open Integration Engine project. Installing runs its code in the engine. Install only from publishers you trust."))
    );
  }
  return { requestInstall, overlay };
}
function DocsPanel({ entry }) {
  const [docs, setDocs] = React.useState(null);
  const [error, setError] = React.useState(null);
  React.useEffect(() => {
    let cancelled = false;
    setDocs(null);
    setError(null);
    apiGet(`${BASE}/catalog/${encodeURIComponent(entry.id)}/docs`).then((result) => {
      if (!cancelled) setDocs(result);
    }).catch((e) => {
      if (!cancelled) setError(errText(e));
    });
    return () => {
      cancelled = true;
    };
  }, [entry.id, entry.tag]);
  const html2 = React.useMemo(() => {
    if (!docs || !docs.found) return null;
    try {
      return renderDocsHtml(
        docs.markdown,
        docs.repo,
        docs.tag,
        docs.images,
        { linkBase: docs.linkBase, imageBase: docs.imageBase }
      );
    } catch (e) {
      return null;
    }
  }, [docs]);
  return /* @__PURE__ */ React.createElement("div", { className: "panel mt-3" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header flex items-center gap-2" }, "Documentation", docs && docs.found ? /* @__PURE__ */ React.createElement("span", { className: "mono text-text-dim", style: { fontSize: "0.85em" } }, docs.path, " @ ", docs.tag) : null), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("style", null, DOCS_CSS), error ? /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, "Could not load documentation: ", error) : null, !error && !docs ? /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, "Loading documentation\u2026") : null, docs && !docs.found ? /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, "This publisher provides no store documentation. Publishers can add a store.md (or README.md) to their repository; it renders here, pinned to the release tag.") : null, html2 ? /* @__PURE__ */ React.createElement("div", { className: "cs-docs", dangerouslySetInnerHTML: { __html: html2 } }) : null, docs && docs.truncated ? /* @__PURE__ */ React.createElement("div", { className: "hint mt-2" }, "Documentation was truncated. The full file is available in the repository.") : null));
}
function DetailView({ entry, onBack, actions }) {
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 mb-3" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-sm", onClick: onBack }, "\u2190 Back"), /* @__PURE__ */ React.createElement("h2", { className: "m-0" }, entry.name), /* @__PURE__ */ React.createElement(TypeTag, { type: entry.type }), /* @__PURE__ */ React.createElement(Badges, { entry })), entry.revoked ? /* @__PURE__ */ React.createElement("div", { className: "panel mb-3" }, /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("span", { className: "text-err font-semibold" }, entry.revokedReason === "blocked" ? "Blocked by its catalog." : "Removed from its source."), " ", /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, entry.description))) : null, entry.deprecated ? /* @__PURE__ */ React.createElement("div", { className: "panel mb-3" }, /* @__PURE__ */ React.createElement("div", { className: "panel-body text-accent" }, "Deprecated by the publisher", entry.deprecationMessage ? `: ${entry.deprecationMessage}` : ".")) : null, !entry.compatible ? /* @__PURE__ */ React.createElement("div", { className: "panel mb-3" }, /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, "No release of this extension is compatible with this engine version", entry.minEngineVersion ? ` (requires engine ${entry.minEngineVersion}${entry.maxEngineVersion ? ` to ${entry.maxEngineVersion}` : " or later"})` : "", ".")) : null, /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "Details"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("p", null, entry.description || /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, "No description provided.")), /* @__PURE__ */ React.createElement("table", { className: "dt mt-3" }, /* @__PURE__ */ React.createElement("tbody", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "Repository"), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("a", { href: entry.repoUrl || `https://github.com/${entry.repo}`, target: "_blank", rel: "noreferrer" }, entry.repo))), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "Offered version"), /* @__PURE__ */ React.createElement("td", { className: "mono" }, entry.version, " (", entry.tag, ")", entry.offeredIsLatest ? "" : ` \u2014 newest compatible; latest release is ${entry.latestTag}`)), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "Engine compatibility"), /* @__PURE__ */ React.createElement("td", { className: "mono" }, entry.minEngineVersion || "unspecified", entry.maxEngineVersion ? ` to ${entry.maxEngineVersion}` : "+")), entry.installedVersion ? /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "Installed version"), /* @__PURE__ */ React.createElement("td", { className: "mono" }, entry.installedVersion)) : null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "License"), /* @__PURE__ */ React.createElement("td", null, entry.license || /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, "unspecified"))), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "Authors"), /* @__PURE__ */ React.createElement("td", null, (entry.authors || []).join(", ") || /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, "unspecified"))), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "Published"), /* @__PURE__ */ React.createElement("td", null, entry.publishedAt || "")), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "Source"), /* @__PURE__ */ React.createElement("td", { className: "mono" }, entry.source)), /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "Restart required"), /* @__PURE__ */ React.createElement("td", null, entry.restartRequired ? "Yes" : "No")))), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 mt-4" }, entry.installable && entry.compatible && (isContentType(entry.type) || !entry.installedVersion || entry.updateAvailable) ? /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: () => actions.requestInstall(entry) }, isContentType(entry.type) ? entry.installedVersion ? "Re-import" : "Import" : entry.installedVersion ? `Update to ${entry.version}` : `Install ${entry.version}`) : null, !entry.installable ? /* @__PURE__ */ React.createElement("span", { className: "hint" }, "This type is not installable through the store yet.") : null, entry.documentation ? /* @__PURE__ */ React.createElement("a", { className: "btn", href: entry.documentation, target: "_blank", rel: "noreferrer" }, "Documentation") : null, entry.releaseUrl ? /* @__PURE__ */ React.createElement("a", { className: "btn", href: entry.releaseUrl, target: "_blank", rel: "noreferrer" }, "Release notes") : null))), /* @__PURE__ */ React.createElement(DocsPanel, { entry }));
}
function EntryCard({ entry, onSelect }) {
  return /* @__PURE__ */ React.createElement("div", { className: "panel", style: { cursor: "pointer" }, onClick: () => onSelect(entry) }, /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2" }, /* @__PURE__ */ React.createElement("strong", null, entry.name), /* @__PURE__ */ React.createElement("span", { className: "mono text-text-dim" }, entry.version), /* @__PURE__ */ React.createElement(TypeTag, { type: entry.type })), /* @__PURE__ */ React.createElement("div", { className: "text-text-dim mt-1", style: { minHeight: "2.5em" } }, entry.description ? entry.description.length > 140 ? entry.description.slice(0, 140) + "\u2026" : entry.description : ""), /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 mt-2" }, /* @__PURE__ */ React.createElement("span", { className: "mono text-text-dim text-[12px]" }, entry.repo)), /* @__PURE__ */ React.createElement("div", { className: "mt-2" }, /* @__PURE__ */ React.createElement(Badges, { entry }))));
}
function CardsGrid({ entries, onSelect }) {
  return /* @__PURE__ */ React.createElement("div", { className: "grid gap-3", style: { gridTemplateColumns: "repeat(auto-fill, minmax(320px, 1fr))" } }, entries.map((entry) => /* @__PURE__ */ React.createElement(EntryCard, { key: entry.id, entry, onSelect })));
}
function EntryRow({ entry, onSelect }) {
  return /* @__PURE__ */ React.createElement("tr", { style: { cursor: "pointer" }, onClick: () => onSelect(entry) }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("a", { className: "text-accent" }, entry.name)), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(TypeTag, { type: entry.type })), /* @__PURE__ */ React.createElement("td", { className: "mono" }, entry.version), /* @__PURE__ */ React.createElement("td", { className: "mono text-text-dim" }, entry.repo), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(Badges, { entry })));
}
var TABLE_COLS = /* @__PURE__ */ React.createElement("colgroup", null, /* @__PURE__ */ React.createElement("col", null), /* @__PURE__ */ React.createElement("col", { style: { width: 170 } }), /* @__PURE__ */ React.createElement("col", { style: { width: 110 } }), /* @__PURE__ */ React.createElement("col", { style: { width: 320 } }), /* @__PURE__ */ React.createElement("col", { style: { width: 170 } }));
var TABLE_HEAD = /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Name"), /* @__PURE__ */ React.createElement("th", null, "Type"), /* @__PURE__ */ React.createElement("th", null, "Version"), /* @__PURE__ */ React.createElement("th", null, "Repository"), /* @__PURE__ */ React.createElement("th", null, "Status")));
function EntryTable({ entries, onSelect }) {
  return /* @__PURE__ */ React.createElement("table", { className: "dt" }, TABLE_COLS, TABLE_HEAD, /* @__PURE__ */ React.createElement("tbody", null, entries.map((entry) => /* @__PURE__ */ React.createElement(EntryRow, { key: entry.id, entry, onSelect }))));
}
function GroupedTable({ groups, onSelect }) {
  return /* @__PURE__ */ React.createElement("table", { className: "dt" }, TABLE_COLS, TABLE_HEAD, groups.map(({ type, entries }) => /* @__PURE__ */ React.createElement("tbody", { key: type }, /* @__PURE__ */ React.createElement("tr", { className: "group-row" }, /* @__PURE__ */ React.createElement("td", { colSpan: 5 }, /* @__PURE__ */ React.createElement("span", { className: "font-semibold" }, TYPE_LABELS[type] || type), " ", /* @__PURE__ */ React.createElement("span", { className: "text-text-faint text-[12px]" }, entries.length))), entries.map((entry) => /* @__PURE__ */ React.createElement(EntryRow, { key: entry.id, entry, onSelect })))));
}
function BrowseView({ catalog, onSelect }) {
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [viewMode, setViewMode] = React.useState(() => getPref("view", "cards"));
  const [groupByType, setGroupByType] = React.useState(() => getPref("group", "0") === "1");
  const setView = (v) => {
    setViewMode(v);
    setPref("view", v);
  };
  const setGroup = (g) => {
    setGroupByType(g);
    setPref("group", g ? "1" : "0");
  };
  const entries = (catalog.entries || []).filter((entry) => {
    if (entry.revoked) return false;
    if (typeFilter && entry.type !== typeFilter) return false;
    if (!search) return true;
    const haystack = `${entry.name} ${entry.description} ${entry.repo} ${(entry.keywords || []).join(" ")}`.toLowerCase();
    return haystack.includes(search.toLowerCase());
  });
  const types = [...new Set((catalog.entries || []).map((e) => e.type))].sort((a, b) => typeRank(a) - typeRank(b) || a.localeCompare(b));
  const render = (list2) => viewMode === "table" ? /* @__PURE__ */ React.createElement(EntryTable, { entries: list2, onSelect }) : /* @__PURE__ */ React.createElement(CardsGrid, { entries: list2, onSelect });
  return /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 items-center mb-3 flex-wrap" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "field",
      style: { maxWidth: 320 },
      placeholder: "Search name, description, keywords\u2026",
      value: search,
      onChange: (e) => setSearch(e.target.value)
    }
  ), /* @__PURE__ */ React.createElement("select", { className: "field", style: { maxWidth: 200 }, value: typeFilter, onChange: (e) => setTypeFilter(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "All types"), types.map((t) => /* @__PURE__ */ React.createElement("option", { key: t, value: t }, TYPE_LABELS[t] || t))), /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, entries.length, " of ", (catalog.entries || []).length, " item(s)"), /* @__PURE__ */ React.createElement("div", { className: "ml-auto flex items-center gap-3" }, /* @__PURE__ */ React.createElement("label", { className: "flex items-center gap-1.5 text-text-dim", style: { cursor: "pointer" } }, /* @__PURE__ */ React.createElement("input", { type: "checkbox", checked: groupByType, onChange: (e) => setGroup(e.target.checked) }), "Group by type"), /* @__PURE__ */ React.createElement("div", { className: "flex" }, /* @__PURE__ */ React.createElement("button", { className: `btn btn-sm ${viewMode === "cards" ? "btn-primary" : ""}`, onClick: () => setView("cards") }, "Cards"), /* @__PURE__ */ React.createElement("button", { className: `btn btn-sm ${viewMode === "table" ? "btn-primary" : ""}`, onClick: () => setView("table") }, "Table")))), entries.length === 0 ? /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-body text-text-dim" }, "No items match. Sources may still be syncing, or none are configured; check Settings.")) : groupByType ? (() => {
    const groups = types.filter((t) => entries.some((e) => e.type === t)).map((t) => ({ type: t, entries: entries.filter((e) => e.type === t) }));
    if (viewMode === "table") {
      return /* @__PURE__ */ React.createElement(GroupedTable, { groups, onSelect });
    }
    return /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-4" }, groups.map(({ type, entries: group }) => /* @__PURE__ */ React.createElement("div", { key: type }, /* @__PURE__ */ React.createElement("div", { className: "flex items-center gap-2 py-1.5 border-b border-line mb-2" }, /* @__PURE__ */ React.createElement("span", { className: "font-semibold" }, TYPE_LABELS[type] || type), /* @__PURE__ */ React.createElement("span", { className: "text-text-faint text-[12px]" }, group.length)), /* @__PURE__ */ React.createElement(CardsGrid, { entries: group, onSelect }))));
  })() : render(entries));
}
function InstalledView({ catalog, onSelect, actions }) {
  const installed = (catalog.entries || []).filter((e) => e.installedVersion);
  const revoked = installed.filter((e) => e.revoked);
  if (installed.length === 0) {
    return /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-body text-text-dim" }, "No store-tracked extensions are installed. Extensions installed manually appear here once their repository is listed in a configured source and the ids match."));
  }
  return /* @__PURE__ */ React.createElement("div", null, revoked.length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "panel mb-3" }, /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("span", { className: "text-err" }, revoked.length === 1 ? "An installed package is" : `${revoked.length} installed packages are`, " no longer offered by ", revoked.length === 1 ? "its" : "their", " source."), " ", /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, "Removed or blocked packages keep running on this engine until you act \u2014 review the flagged rows below and uninstall anything you no longer trust from the Extensions page."))) : null, /* @__PURE__ */ React.createElement("table", { className: "dt" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Name"), /* @__PURE__ */ React.createElement("th", null, "Type"), /* @__PURE__ */ React.createElement("th", null, "Installed"), /* @__PURE__ */ React.createElement("th", null, "Available"), /* @__PURE__ */ React.createElement("th", null, "Repository"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, installed.map((entry) => (
    // Revoked rows get an unmissable red treatment: tinted row + badge.
    /* @__PURE__ */ React.createElement("tr", { key: entry.id, style: entry.revoked ? { background: "color-mix(in srgb, var(--err) 10%, transparent)" } : void 0 }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("a", { onClick: () => onSelect(entry), style: { cursor: "pointer" } }, entry.name), entry.revoked ? /* @__PURE__ */ React.createElement("span", { className: "tag text-err", style: { marginLeft: 8 }, title: entry.description }, entry.revokedReason === "blocked" ? "Blocked by source" : "Removed from source") : null), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(TypeTag, { type: entry.type })), /* @__PURE__ */ React.createElement("td", { className: "mono" }, entry.installedVersion), /* @__PURE__ */ React.createElement("td", { className: "mono" }, entry.revoked ? /* @__PURE__ */ React.createElement("span", { className: "text-err" }, "\u2014") : entry.updateAvailable ? /* @__PURE__ */ React.createElement("span", { className: "text-accent" }, entry.version) : entry.version), /* @__PURE__ */ React.createElement("td", { className: "mono" }, entry.repo), /* @__PURE__ */ React.createElement("td", { className: "flex gap-1 items-center" }, entry.updateAvailable ? /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: () => actions.requestInstall(entry) }, "Update") : null, /* @__PURE__ */ React.createElement("span", { className: "hint" }, "Manage in ", isContentType(entry.type) ? TYPE_LABELS[entry.type] === "Channel" ? "Channels" : "Code Templates" : "Extensions")))
  )))));
}
function SettingsView({ catalog, onSaved }) {
  const [settings, setSettings] = React.useState(null);
  const [token, setToken] = React.useState(null);
  const [newKind, setNewKind] = React.useState("repo");
  const [newValue, setNewValue] = React.useState("");
  const [newTopic, setNewTopic] = React.useState("oie-plugin");
  const [newBlock, setNewBlock] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const load = async () => {
    try {
      setSettings(await apiGet(`${BASE}/settings`));
    } catch (e) {
      toast(errText(e), "error");
    }
  };
  React.useEffect(() => {
    load();
  }, []);
  if (!settings) return /* @__PURE__ */ React.createElement("div", { className: "text-text-dim" }, "Loading settings\u2026");
  const save = async () => {
    setSaving(true);
    try {
      const body = {
        customSources: settings.customSources,
        localBlocklist: settings.localBlocklist,
        betaChannel: settings.betaChannel
      };
      if (token !== null) body.token = token;
      const updated = await apiPut(`${BASE}/settings`, body);
      setSettings(updated);
      setToken(null);
      toast("Settings saved.", "success");
      onSaved();
    } catch (e) {
      toast(errText(e), "error");
    } finally {
      setSaving(false);
    }
  };
  const addSource = () => {
    const value = newValue.trim();
    if (!value) return;
    const source = newKind === "catalog" ? { kind: "catalog", url: value } : newKind === "org" ? { kind: "org", org: value, topic: newTopic.trim() || "oie-plugin" } : { kind: "repo", repo: value };
    setSettings({ ...settings, customSources: [...settings.customSources, source] });
    setNewValue("");
  };
  const describeSource = (s) => s.kind === "catalog" ? `catalog: ${s.url}` : s.kind === "org" ? `org: ${s.org} (topic: ${s.topic})` : `repo: ${s.repo}`;
  return /* @__PURE__ */ React.createElement("div", { className: "flex flex-col gap-3", style: { maxWidth: 760 } }, /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "Sources"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "hint mb-2" }, "Bundled sources ship with the store and update with store releases. Custom sources are additive and stored on this engine."), /* @__PURE__ */ React.createElement("table", { className: "dt" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, /* @__PURE__ */ React.createElement("th", null, "Source"), /* @__PURE__ */ React.createElement("th", null, "Origin"), /* @__PURE__ */ React.createElement("th", null))), /* @__PURE__ */ React.createElement("tbody", null, settings.bundledSources.map((s, i) => /* @__PURE__ */ React.createElement("tr", { key: `b${i}` }, /* @__PURE__ */ React.createElement("td", { className: "mono" }, describeSource(s)), /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "bundled"), /* @__PURE__ */ React.createElement("td", null))), settings.customSources.map((s, i) => /* @__PURE__ */ React.createElement("tr", { key: `c${i}` }, /* @__PURE__ */ React.createElement("td", { className: "mono" }, describeSource(s)), /* @__PURE__ */ React.createElement("td", { className: "text-text-dim" }, "custom"), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => setSettings({ ...settings, customSources: settings.customSources.filter((_, j) => j !== i) }) }, "Remove")))))), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 items-center mt-3" }, /* @__PURE__ */ React.createElement("select", { className: "field", style: { maxWidth: 110 }, value: newKind, onChange: (e) => setNewKind(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "repo" }, "repo"), /* @__PURE__ */ React.createElement("option", { value: "org" }, "org"), /* @__PURE__ */ React.createElement("option", { value: "catalog" }, "catalog")), /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "field",
      style: { maxWidth: newKind === "catalog" ? 380 : 260 },
      value: newValue,
      onChange: (e) => setNewValue(e.target.value),
      placeholder: newKind === "catalog" ? "https://\u2026/index.json" : newKind === "org" ? "organization or user login" : "owner/repository"
    }
  ), newKind === "org" ? /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "field",
      style: { maxWidth: 160 },
      value: newTopic,
      onChange: (e) => setNewTopic(e.target.value),
      placeholder: "topic filter"
    }
  ) : null, /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: addSource }, "Add source")))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "Blocklist"), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "hint mb-2" }, "Blocked repositories never appear in the catalog. The bundled blocklist cannot be removed here."), settings.bundledBlocklist.map((b, i) => /* @__PURE__ */ React.createElement("div", { key: `bb${i}`, className: "flex gap-2 items-center" }, /* @__PURE__ */ React.createElement("span", { className: "mono" }, b), /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, "(bundled)"))), settings.localBlocklist.map((b, i) => /* @__PURE__ */ React.createElement("div", { key: `lb${i}`, className: "flex gap-2 items-center" }, /* @__PURE__ */ React.createElement("span", { className: "mono" }, b), /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => setSettings({ ...settings, localBlocklist: settings.localBlocklist.filter((_, j) => j !== i) }) }, "Remove"))), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 items-center mt-2" }, /* @__PURE__ */ React.createElement("input", { className: "field", style: { maxWidth: 260 }, value: newBlock, onChange: (e) => setNewBlock(e.target.value), placeholder: "owner/repository" }), /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => {
    const value = newBlock.trim().toLowerCase();
    if (value) setSettings({ ...settings, localBlocklist: [...settings.localBlocklist, value] });
    setNewBlock("");
  } }, "Block")))), /* @__PURE__ */ React.createElement("div", { className: "panel" }, /* @__PURE__ */ React.createElement("div", { className: "panel-header" }, "GitHub access"), /* @__PURE__ */ React.createElement("div", { className: "panel-body flex flex-col gap-2" }, /* @__PURE__ */ React.createElement("label", { className: "flex gap-2 items-center" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      type: "checkbox",
      checked: settings.betaChannel,
      onChange: (e) => setSettings({ ...settings, betaChannel: e.target.checked })
    }
  ), "Include pre-releases (beta channel)"), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2 items-center" }, /* @__PURE__ */ React.createElement(
    "input",
    {
      className: "field",
      type: "password",
      style: { maxWidth: 340 },
      placeholder: settings.tokenSet ? "Token configured (leave blank to keep, save empty to clear)" : "Personal access token (optional)",
      value: token === null ? "" : token,
      onChange: (e) => setToken(e.target.value)
    }
  ), settings.tokenSet && token === null ? /* @__PURE__ */ React.createElement("span", { className: "tag" }, "set") : null), /* @__PURE__ */ React.createElement("div", { className: "hint" }, "A token raises the GitHub API rate limit and enables private sources. It is stored encrypted on the engine and never returned to the browser.", catalog && catalog.rateLimitRemaining ? ` Rate limit remaining: ${catalog.rateLimitRemaining}.` : ""))), /* @__PURE__ */ React.createElement("div", { className: "flex gap-2" }, /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: save, disabled: saving }, saving ? "Saving\u2026" : "Save settings")));
}
function CommunityStoreView() {
  const [tab, setTab] = React.useState("browse");
  const [catalog, setCatalog] = React.useState(null);
  const [error, setError] = React.useState(null);
  const [loading, setLoading] = React.useState(true);
  const [selected, setSelected] = React.useState(null);
  const refresh = async (force) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiGet(`${BASE}/catalog?refresh=${force ? "true" : "false"}`);
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
  React.useEffect(() => {
    refresh(false);
  }, []);
  const actions = useStoreActions(refresh);
  const updates = catalog ? (catalog.entries || []).filter((e) => e.updateAvailable).length : 0;
  const banners = /* @__PURE__ */ React.createElement(React.Fragment, null, error ? /* @__PURE__ */ React.createElement("div", { className: "panel mb-3" }, /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("span", { className: "text-accent" }, "Could not load the store catalog."), " ", /* @__PURE__ */ React.createElement("span", { className: "text-text-dim" }, error), /* @__PURE__ */ React.createElement("div", { className: "hint mt-1" }, "The Community Store requires the manage-extensions permission, the same permission used to install extensions manually."))) : null, catalog && (catalog.errors || []).length > 0 ? /* @__PURE__ */ React.createElement("div", { className: "panel mb-3" }, /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-dim mb-1" }, "Some sources failed to sync:"), catalog.errors.map((e, i) => /* @__PURE__ */ React.createElement("div", { key: i, className: "mono text-[12px]" }, e.source, ": ", e.message)))) : null);
  return /* @__PURE__ */ React.createElement("div", { className: "view flex flex-col flex-1 min-h-0" }, actions.overlay, selected ? /* @__PURE__ */ React.createElement("div", { className: "view-body" }, banners, /* @__PURE__ */ React.createElement(DetailView, { entry: selected, onBack: () => setSelected(null), actions })) : /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("div", { className: "tabs flex-none" }, /* @__PURE__ */ React.createElement("button", { className: `tab ${tab === "browse" ? "active" : ""}`, onClick: () => setTab("browse") }, "Browse"), /* @__PURE__ */ React.createElement("button", { className: `tab ${tab === "installed" ? "active" : ""}`, onClick: () => setTab("installed") }, "Installed", updates > 0 ? ` (${updates})` : ""), /* @__PURE__ */ React.createElement("button", { className: `tab ${tab === "settings" ? "active" : ""}`, onClick: () => setTab("settings") }, "Settings"), /* @__PURE__ */ React.createElement("div", { className: "ml-auto flex items-center gap-2 pr-2" }, catalog && catalog.engineVersion ? /* @__PURE__ */ React.createElement("span", { className: "text-text-dim text-[12px]" }, "Engine ", catalog.engineVersion) : null, /* @__PURE__ */ React.createElement("button", { className: "btn btn-sm", onClick: () => refresh(true), disabled: loading }, loading ? "Syncing\u2026" : "Sync now"))), /* @__PURE__ */ React.createElement("div", { className: "view-body" }, banners, tab === "browse" && catalog ? /* @__PURE__ */ React.createElement(BrowseView, { catalog, onSelect: setSelected }) : null, tab === "installed" && catalog ? /* @__PURE__ */ React.createElement(InstalledView, { catalog, onSelect: setSelected, actions }) : null, tab === "settings" ? /* @__PURE__ */ React.createElement(SettingsView, { catalog, onSaved: () => refresh(true) }) : null, loading && !catalog ? /* @__PURE__ */ React.createElement("div", { className: "text-text-dim" }, "Loading catalog\u2026") : null)));
}
function register() {
  platform.registerNavItem({
    id: "community-store",
    label: "Community Store",
    icon: "plug",
    path: "/community-store",
    section: "Engine",
    order: 80
  });
  platform.registerView("/community-store", platform.reactView(CommunityStoreView), { title: "Community Store" });
}
export {
  register
};
