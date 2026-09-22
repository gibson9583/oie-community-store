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

// web/store-style.js
var STORE_CSS = `
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

// web/plugin.jsx
var canInstall = () => platform.checkTask("", "doInstallStoreItem");
var canRemove = () => platform.checkTask("", "doRemoveStoreContent");
var canEditSettings = () => platform.checkTask("", "doEditStoreSettings");
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
  let text = e && (e.message || e.statusText) ? e.message || e.statusText : String(e);
  const m = /<detailMessage>([\s\S]*?)<\/detailMessage>/.exec(text);
  if (m) {
    text = m[1].replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&amp;/g, "&").trim();
  }
  return text;
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
var showsInWebUi = (entry) => !(Array.isArray(entry.ui) && entry.ui.length && !entry.ui.includes("web"));
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
function ConfirmOverlay({ title, children, confirmLabel, onConfirm, secondaryLabel, onSecondary, onCancel, busy, loading, error, documentation = false, inactive = false, closeLabel = "Close documentation" }) {
  const dialog = React.useRef(null);
  const titleId = React.useId();
  React.useEffect(() => {
    const previous = document.activeElement;
    dialog.current?.focus();
    return () => {
      if (previous?.isConnected) previous.focus();
    };
  }, []);
  const onKeyDown = (event) => {
    if (event.key === "Escape" && !busy) {
      event.stopPropagation();
      onCancel();
    }
    if (event.key !== "Tab") return;
    const nodes = [...dialog.current.querySelectorAll("button:not(:disabled),input:not(:disabled),select:not(:disabled),a[href],summary")];
    const first = nodes[0], last = nodes[nodes.length - 1];
    if (!first) {
      event.preventDefault();
      return;
    }
    if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog.current)) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog.current)) {
      event.preventDefault();
      first.focus();
    }
  };
  return /* @__PURE__ */ React.createElement("div", { className: "cs-overlay", style: inactive ? { display: "none" } : void 0 }, /* @__PURE__ */ React.createElement("div", { className: `panel cs-dialog ${documentation ? "cs-documentation-dialog" : ""}`, role: "dialog", "aria-modal": "true", "aria-labelledby": titleId, ref: dialog, tabIndex: -1, onKeyDown }, /* @__PURE__ */ React.createElement("div", { className: "panel-header", id: titleId }, title, documentation ? /* @__PURE__ */ React.createElement("button", { className: "btn btn-sm", onClick: onCancel, "aria-label": closeLabel }, "Close") : null), /* @__PURE__ */ React.createElement("div", { className: "panel-body" }, children, loading ? /* @__PURE__ */ React.createElement("p", { role: "status" }, "Loading libraries\u2026") : null, error ? /* @__PURE__ */ React.createElement("p", { role: "alert", className: "cs-notice error" }, error) : null, !documentation ? /* @__PURE__ */ React.createElement("div", { className: "cs-dialog-actions" }, /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => onCancel(), disabled: busy }, "Cancel"), secondaryLabel ? /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger", onClick: () => onSecondary(), disabled: busy || loading }, secondaryLabel) : null, /* @__PURE__ */ React.createElement("button", { className: "btn btn-primary", onClick: () => onConfirm(), disabled: busy || loading }, busy ? "Working\u2026" : confirmLabel)) : null)));
}
function useStoreActions(refresh, onComplete) {
  const [confirm, setConfirm] = React.useState(null);
  const [busy, setBusy] = React.useState(false);
  const inFlight = React.useRef(false);
  const pickerRequest = React.useRef(0);
  const [loadingLibraries, setLoadingLibraries] = React.useState(false);
  const [actionError, setActionError] = React.useState(null);
  const choose = (value) => {
    pickerRequest.current++;
    setLoadingLibraries(false);
    setActionError(null);
    setConfirm(value);
  };
  const [libraries, setLibraries] = React.useState([]);
  const [libMode, setLibMode] = React.useState("new");
  const [newLib, setNewLib] = React.useState("");
  const [existingLib, setExistingLib] = React.useState("");
  const loadLibraryPicker = async (entry) => {
    const request = ++pickerRequest.current;
    setLoadingLibraries(true);
    setLibMode("new");
    setNewLib(entry.name || "Community Store");
    setExistingLib("");
    setLibraries([]);
    try {
      const result = normalizeLibraries(await apiGet("/codeTemplateLibraries"));
      if (request === pickerRequest.current) setLibraries(result);
    } catch (e) {
      if (request === pickerRequest.current) setActionError("Could not load existing libraries. You can create a new library, or cancel and retry. " + errText(e));
    } finally {
      if (request === pickerRequest.current) setLoadingLibraries(false);
    }
  };
  const requestInstall = async (entry) => {
    choose({ entry, mode: "install" });
    if (entry.type === "code-template" && !entry.installedVersion) await loadLibraryPicker(entry);
  };
  const requestCopy = async (entry) => {
    choose({ entry, mode: "copy" });
    if (entry.type === "code-template") await loadLibraryPicker(entry);
  };
  const requestUpdate = (entry) => {
    if (entry.type === "code-template" || entry.type === "code-template-library") {
      choose({ entry, mode: entry.modified ? "modified-choice" : "upgrade" });
    } else requestInstall(entry);
  };
  const requestRemove = (entry) => choose({ entry, mode: "remove" });
  const execute = async (modeOverride, overwrite = false) => {
    if (!confirm || inFlight.current || loadingLibraries) return;
    const entry = confirm.entry;
    const mode = typeof modeOverride === "string" ? modeOverride : confirm.mode;
    if (!["install", "upgrade", "copy", "remove"].includes(mode)) return;
    const content = isContentType(entry.type);
    inFlight.current = true;
    setActionError(null);
    setBusy(true);
    try {
      if (mode === "remove") {
        await apiPost(`${BASE}/_removeContent`, { id: entry.id });
        toast(`Removed ${entry.name} from this engine.`, "success");
        onComplete?.({ entry, mode, restartRequired: false });
        setConfirm(null);
        await refresh(false);
        return;
      }
      {
        const body = { id: entry.id, tag: entry.tag };
        if (mode === "upgrade" || mode === "copy") body.mode = mode;
        if (mode === "upgrade") {
          body.expectedContentHash = entry.expectedContentHash || "";
          body.overwrite = overwrite;
        }
        if (entry.type === "code-template" && (mode === "copy" || mode === "install" && !entry.installedVersion)) {
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
        const result = await apiPost(`${BASE}/_install`, body);
        onComplete?.({ entry, mode, restartRequired: !!result.restartRequired });
        toast(mode === "upgrade" ? entry.updateAvailable ? `Upgraded ${entry.name} to v${entry.version}.` : `Re-imported ${entry.name}.` : mode === "copy" ? `Imported ${entry.name} as a copy.` : content ? `Imported ${entry.name}. It's available now.` : `Installed ${entry.name} ${entry.version}. Restart the engine to activate it.`, "success");
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
      setActionError(errText(e));
      toast(errText(e), "error");
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  };
  let overlay = null;
  if (confirm && confirm.mode === "remove") {
    const entry = confirm.entry;
    overlay = /* @__PURE__ */ React.createElement(
      ConfirmOverlay,
      {
        title: `Remove ${entry.name}?`,
        confirmLabel: "Remove",
        busy,
        loading: loadingLibraries,
        error: actionError,
        onCancel: () => choose(null),
        onConfirm: () => execute("remove")
      },
      /* @__PURE__ */ React.createElement("div", null, entry.type === "code-template-library" ? /* @__PURE__ */ React.createElement("p", null, "Deletes the library ", /* @__PURE__ */ React.createElement("strong", null, entry.name), " and ", /* @__PURE__ */ React.createElement("strong", null, "all code templates it currently contains"), " \u2014 including any you added to it after installing.") : /* @__PURE__ */ React.createElement("p", null, "Deletes the code template ", /* @__PURE__ */ React.createElement("strong", null, entry.name), " from this engine, including its library membership. The library itself is kept", entry.revoked ? "." : ", and the package stays in Browse if you want to re-import it later."))
    );
  } else if (confirm && confirm.mode === "modified-choice") {
    const entry = confirm.entry;
    const noun = entry.type === "code-template-library" ? "library" : "template";
    const untracked = entry.driftTracked === false;
    overlay = /* @__PURE__ */ React.createElement(
      ConfirmOverlay,
      {
        title: `${entry.updateAvailable ? "Update" : "Re-import"} ${entry.name}?`,
        confirmLabel: "Install as new copy",
        secondaryLabel: "Overwrite",
        busy,
        loading: loadingLibraries,
        error: actionError,
        onCancel: () => choose(null),
        onSecondary: () => execute("upgrade", true),
        onConfirm: () => requestCopy(entry)
      },
      /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", null, untracked ? `This ${noun} was installed using an older change-tracking format \u2014 the store can't tell whether you've modified it.` : `You've modified this ${noun} since installing it.`), /* @__PURE__ */ React.createElement("p", null, /* @__PURE__ */ React.createElement("strong", null, "Overwrite"), " replaces ", untracked ? "whatever is there" : "your changes", " with version ", entry.version, ".", " ", /* @__PURE__ */ React.createElement("strong", null, "Install as new copy"), " keeps ", untracked ? "what's installed" : "yours", " and imports version ", entry.version, " as a separate ", noun, entry.type === "code-template" ? " (you'll choose a library for it)" : "", "."))
    );
  } else if (confirm && confirm.mode === "upgrade") {
    const entry = confirm.entry;
    const reimport = !entry.updateAvailable;
    overlay = /* @__PURE__ */ React.createElement(
      ConfirmOverlay,
      {
        title: reimport ? `Re-import ${entry.name}?` : `Update ${entry.name} to v${entry.version}?`,
        confirmLabel: reimport ? "Re-import" : `Update to v${entry.version}`,
        busy,
        loading: loadingLibraries,
        error: actionError,
        onCancel: () => choose(null),
        onConfirm: () => execute()
      },
      /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("p", null, "Replaces the installed ", TYPE_LABELS[entry.type] || entry.type, " ", /* @__PURE__ */ React.createElement("strong", null, entry.name), " in place with version ", entry.version, " from ", /* @__PURE__ */ React.createElement("span", { className: "mono" }, entry.repo), " (", entry.tag, ").", entry.type === "code-template" ? " Its library membership is kept, and it" : " It", " takes effect immediately \u2014 no engine restart."))
    );
  } else if (confirm) {
    const entry = confirm.entry;
    const copy = confirm.mode === "copy";
    const content = isContentType(entry.type);
    const wantsLibrary = entry.type === "code-template" && (copy || !entry.installedVersion);
    overlay = /* @__PURE__ */ React.createElement(
      ConfirmOverlay,
      {
        title: copy ? `Install ${entry.name} as a copy?` : `${content ? entry.updateAvailable ? "Update" : "Import" : "Install"} ${entry.name}?`,
        confirmLabel: copy ? "Install as copy" : content ? entry.updateAvailable ? `Update to ${entry.version}` : "Import" : `Install ${entry.version}`,
        busy,
        loading: loadingLibraries,
        error: actionError,
        onCancel: () => choose(null),
        onConfirm: () => execute()
      },
      /* @__PURE__ */ React.createElement("div", null, copy ? /* @__PURE__ */ React.createElement("p", null, "Imports the ", TYPE_LABELS[entry.type] || entry.type, " ", /* @__PURE__ */ React.createElement("strong", null, entry.name), " version ", entry.version, " from", " ", /* @__PURE__ */ React.createElement("span", { className: "mono" }, entry.repo), " (", entry.tag, ") as a new copy with a fresh id", entry.installedVersion ? " \u2014 what you have installed is left untouched" : "", ". The copy is yours: the store does not track or update it.") : content ? /* @__PURE__ */ React.createElement("p", null, "Imports the ", TYPE_LABELS[entry.type] || entry.type, " ", /* @__PURE__ */ React.createElement("strong", null, entry.name), " from", " ", /* @__PURE__ */ React.createElement("span", { className: "mono" }, entry.repo), " (", entry.tag, "). It takes effect immediately \u2014 no engine restart.") : /* @__PURE__ */ React.createElement("p", null, "This installs ", /* @__PURE__ */ React.createElement("span", { className: "mono" }, entry.repo), " release", " ", /* @__PURE__ */ React.createElement("span", { className: "mono" }, entry.tag), " into the engine's extensions directory after sha256 verification."), wantsLibrary ? /* @__PURE__ */ React.createElement("div", { className: "mt-3" }, /* @__PURE__ */ React.createElement("div", { className: "text-text-dim mb-1" }, "Add to library:"), /* @__PURE__ */ React.createElement("label", { className: "flex items-center gap-2 mb-1", style: { cursor: "pointer" } }, /* @__PURE__ */ React.createElement("input", { type: "radio", name: "cs-lib", checked: libMode === "new", onChange: () => setLibMode("new") }), "Create new library:", /* @__PURE__ */ React.createElement(
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
  return { requestInstall, requestUpdate, requestCopy, requestRemove, overlay, busy };
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
var TYPE_ICONS = {
  "connector": "M8 2v6M16 2v6M5 8h14v4a7 7 0 0 1-14 0V8zM12 19v3",
  "plugin": "M8 2v6M16 2v6M5 8h14v4a7 7 0 0 1-14 0V8zM12 19v3",
  "datatype": "M8 2v6M16 2v6M5 8h14v4a7 7 0 0 1-14 0V8zM12 19v3",
  "channel": "M2 12a3 3 0 1 0 6 0a3 3 0 1 0-6 0M16 5a3 3 0 1 0 6 0a3 3 0 1 0-6 0M16 19a3 3 0 1 0 6 0a3 3 0 1 0-6 0M7.7 10.7l8.6-4.4M7.7 13.3l8.6 4.4",
  "code-template": "M8 7l-5 5 5 5M16 7l5 5-5 5M13 4l-2 16",
  "code-template-library": "M8 7l-5 5 5 5M16 7l5 5-5 5M13 4l-2 16"
};
function PackageIcon({ type }) {
  return /* @__PURE__ */ React.createElement("span", { className: "cs-icon", "aria-hidden": "true" }, /* @__PURE__ */ React.createElement("svg", { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.7", strokeLinecap: "round", strokeLinejoin: "round" }, /* @__PURE__ */ React.createElement("path", { d: TYPE_ICONS[type] || TYPE_ICONS.plugin })));
}
function PackageStatus({ entry }) {
  if (entry.revoked) return /* @__PURE__ */ React.createElement("span", { className: "cs-pill error" }, entry.revokedReason === "blocked" ? "Blocked by source" : "Removed from source");
  if (entry.stagedVersion) return /* @__PURE__ */ React.createElement("span", { className: "cs-pill warn" }, "Restart pending");
  if (entry.modified) return /* @__PURE__ */ React.createElement("span", { className: "cs-pill warn" }, entry.driftTracked === false ? "Changes unknown" : "Locally modified");
  if (entry.updateAvailable) return /* @__PURE__ */ React.createElement("span", { className: "cs-pill update" }, "Update available");
  if (!entry.compatible) return /* @__PURE__ */ React.createElement("span", { className: "cs-pill warn" }, "Incompatible");
  if (entry.deprecated) return /* @__PURE__ */ React.createElement("span", { className: "cs-pill warn" }, "Deprecated");
  if (entry.installedVersion) return /* @__PURE__ */ React.createElement("span", { className: "cs-pill ok" }, "Installed");
  return /* @__PURE__ */ React.createElement("span", { className: "cs-pill" }, "Available to ", isContentType(entry.type) ? "import" : "install");
}
function safeExternalUrl(value) {
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function ExternalLink({ href, children }) {
  const safe = safeExternalUrl(href);
  return safe ? /* @__PURE__ */ React.createElement("a", { href: safe, target: "_blank", rel: "noopener noreferrer" }, children) : null;
}
var DOWNLOAD_NOTE = "Downloads of matching installer ZIPs across retained GitHub releases, including prereleases. Repeat and automated downloads count; this is not an installation or user count. Renamed asset families and deleted releases are excluded.";
var DOWNLOAD_ERRORS = {
  unsupported_asset: "Download statistics are not published for this installer URL or filename.",
  package_not_found: "This package is no longer in the catalog.",
  revoked: "This package has been removed from its source.",
  no_matching_assets: "No matching installer assets were found in GitHub releases.",
  rate_limit_or_access_denied: "GitHub rate limit reached or repository access denied. Check the GitHub token in Store Settings; the lookup retries after five minutes.",
  repository_not_found: "GitHub could not find or grant access to the repository.",
  lookup_limit: "The release history could not be completely counted within the lookup limits.",
  github_unreachable: "The engine could not reach GitHub. Check its network and TLS configuration.",
  invalid_response: "GitHub returned an unexpected statistics response.",
  interrupted: "The download lookup was interrupted."
};
function metricFreshness(stats) {
  return stats?.checkedAt ? `${stats.stale ? "Refresh failed; last successful count" : "Updated"}: ${new Date(stats.checkedAt).toLocaleString()}` : "Statistics have not been published by this catalog yet.";
}
function downloadError(entry) {
  return DOWNLOAD_ERRORS[entry.downloads?.reason] || "This catalog has no download count for this package.";
}
function DownloadCount({ entry }) {
  const stats = entry.downloads;
  return /* @__PURE__ */ React.createElement("span", { title: stats?.status === "available" ? `${DOWNLOAD_NOTE} ${metricFreshness(stats)}` : downloadError(entry) }, stats?.status === "available" && Number.isSafeInteger(stats.count) && stats.count >= 0 ? `${stats.count.toLocaleString()}${stats.stale ? " (stale)" : ""}` : "\u2014");
}
function StarCount({ entry }) {
  const stats = entry.stars;
  return /* @__PURE__ */ React.createElement("span", { title: `GitHub repository stars; packages sharing a repository share this count. ${metricFreshness(stats)}` }, stats?.status === "available" && Number.isSafeInteger(stats.count) && stats.count >= 0 ? `${stats.count.toLocaleString()}${stats.stale ? " (stale)" : ""}` : "\u2014");
}
function DetailView({ entry, actions }) {
  const [docsOpen, setDocsOpen] = React.useState(true);
  React.useEffect(() => setDocsOpen(true), [entry?.id]);
  if (!entry) return /* @__PURE__ */ React.createElement("aside", { className: "cs-detail" }, /* @__PURE__ */ React.createElement("h2", null, "Package details"), /* @__PURE__ */ React.createElement("p", { className: "cs-detail-description" }, "Select a package to review its compatibility, source, and installation options."));
  const content = isContentType(entry.type);
  const channelCopy = entry.type === "channel" && entry.installedVersion;
  const update = entry.updateAvailable || content && entry.installedVersion && !channelCopy;
  const actionable = canInstall() && entry.installable && entry.compatible && !entry.revoked && !entry.stagedVersion && (content || !entry.installedVersion || entry.updateAvailable);
  const label = channelCopy ? "Import as copy" : update ? entry.updateAvailable ? `Review update to ${entry.version}` : "Review re-import" : content ? "Review import" : "Review installation";
  return /* @__PURE__ */ React.createElement("aside", { className: "cs-detail", "aria-label": "Selected package" }, /* @__PURE__ */ React.createElement(PackageIcon, { type: entry.type }), /* @__PURE__ */ React.createElement("h2", null, entry.name), /* @__PURE__ */ React.createElement("div", { className: "cs-meta" }, TYPE_LABELS[entry.type] || entry.type, entry.authors?.length ? ` \xB7 by ${entry.authors.join(", ")}` : ""), /* @__PURE__ */ React.createElement("p", { className: "cs-detail-description" }, entry.description || "No description provided."), /* @__PURE__ */ React.createElement(PackageStatus, { entry }), /* @__PURE__ */ React.createElement("p", { className: "cs-footnote" }, DOWNLOAD_NOTE, " ", entry.downloads?.status !== "available" ? downloadError(entry) : ""), /* @__PURE__ */ React.createElement("dl", { className: "cs-facts" }, /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "Offered version"), /* @__PURE__ */ React.createElement("dd", null, entry.revoked ? "Unavailable" : entry.version)), /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "Installed version"), /* @__PURE__ */ React.createElement("dd", null, entry.installedVersion || "Not installed")), entry.stagedVersion ? /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "Staged version"), /* @__PURE__ */ React.createElement("dd", null, entry.stagedVersion)) : null, /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "Downloads \xB7 all versions"), /* @__PURE__ */ React.createElement("dd", null, /* @__PURE__ */ React.createElement(DownloadCount, { entry }), /* @__PURE__ */ React.createElement("div", { className: "cs-footnote" }, metricFreshness(entry.downloads)))), /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "GitHub stars"), /* @__PURE__ */ React.createElement("dd", null, /* @__PURE__ */ React.createElement(StarCount, { entry }), /* @__PURE__ */ React.createElement("div", { className: "cs-footnote" }, metricFreshness(entry.stars)))), /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "Engine compatibility"), /* @__PURE__ */ React.createElement("dd", null, entry.minEngineVersion || "Unspecified", entry.maxEngineVersion ? ` \u2013 ${entry.maxEngineVersion}` : entry.minEngineVersion ? "+" : ""))), entry.revoked ? /* @__PURE__ */ React.createElement("p", { className: "cs-notice error" }, "This package is no longer offered by its source. Review whether you still trust it.") : entry.stagedVersion ? /* @__PURE__ */ React.createElement("p", { className: "cs-notice warn" }, "Version ", entry.stagedVersion, " is staged. Restart the engine to activate it.") : !entry.compatible ? /* @__PURE__ */ React.createElement("p", { className: "cs-notice warn" }, "No compatible version is available for this engine.") : /* @__PURE__ */ React.createElement("p", { className: "cs-notice" }, content ? "Imported content is available immediately. No restart needed." : "Engine restart required after installation."), entry.modified ? /* @__PURE__ */ React.createElement("p", { className: "cs-notice warn" }, entry.driftTracked === false ? "Local changes are unknown with the previous tracking format." : "Local edits detected.", " Review before replacing this content. You can keep your changes by importing a copy.") : null, entry.deprecated ? /* @__PURE__ */ React.createElement("p", { className: "cs-notice warn" }, "Deprecated by the publisher", entry.deprecationMessage ? `: ${entry.deprecationMessage}` : ".") : null, entry.newerSnapshot ? /* @__PURE__ */ React.createElement("p", { className: "cs-notice" }, "Newer snapshot available: ", entry.newerSnapshot, ". Import as a copy to keep the installed channel.") : null, actionable ? /* @__PURE__ */ React.createElement(
    "button",
    {
      className: "btn btn-primary cs-primary-action",
      disabled: actions.busy,
      onClick: () => channelCopy ? actions.requestCopy(entry) : update ? actions.requestUpdate(entry) : actions.requestInstall(entry)
    },
    label
  ) : null, /* @__PURE__ */ React.createElement("p", { className: "cs-footnote" }, "Community published. A checksum verifies artifact integrity, not publisher identity."), /* @__PURE__ */ React.createElement("details", { className: "cs-package-info" }, /* @__PURE__ */ React.createElement("summary", null, "Package information"), /* @__PURE__ */ React.createElement("dl", { className: "cs-facts" }, /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "License"), /* @__PURE__ */ React.createElement("dd", null, entry.license || "Unspecified")), /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "Repository"), /* @__PURE__ */ React.createElement("dd", null, /* @__PURE__ */ React.createElement(ExternalLink, { href: entry.repoUrl || `https://github.com/${entry.repo}` }, entry.repo || "Repository"))), /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "Source"), /* @__PURE__ */ React.createElement("dd", null, entry.source)), /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "Artifact integrity"), /* @__PURE__ */ React.createElement("dd", null, entry.sha256 || entry.checksumUrl ? "SHA-256 on install" : "No published checksum")), entry.publishedAt ? /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "Published"), /* @__PURE__ */ React.createElement("dd", null, new Date(entry.publishedAt).toLocaleDateString())) : null, !entry.offeredIsLatest && entry.latestTag ? /* @__PURE__ */ React.createElement("div", { className: "cs-fact" }, /* @__PURE__ */ React.createElement("dt", null, "Latest release"), /* @__PURE__ */ React.createElement("dd", null, entry.latestTag, " (offering the compatible version)")) : null)), /* @__PURE__ */ React.createElement("div", { className: "cs-detail-links" }, /* @__PURE__ */ React.createElement(ExternalLink, { href: entry.documentation }, "Documentation \u2197"), /* @__PURE__ */ React.createElement(ExternalLink, { href: entry.releaseUrl }, "Release notes \u2197")), !entry.revoked ? /* @__PURE__ */ React.createElement(React.Fragment, null, /* @__PURE__ */ React.createElement("button", { className: "btn cs-docs-toggle", "aria-expanded": docsOpen, onClick: () => setDocsOpen(!docsOpen) }, docsOpen ? "Hide publisher documentation" : "Read publisher documentation"), docsOpen ? /* @__PURE__ */ React.createElement(DocsPanel, { entry }) : null) : null, entry.installedVersion ? /* @__PURE__ */ React.createElement("div", { className: "cs-facts" }, content && entry.type !== "channel" && canRemove() ? /* @__PURE__ */ React.createElement("button", { className: "btn btn-danger", disabled: actions.busy, onClick: () => actions.requestRemove(entry) }, "Remove from engine\u2026") : /* @__PURE__ */ React.createElement("p", { className: "cs-footnote" }, entry.type === "channel" ? "Manage or delete this channel in Channels." : "Manage or uninstall this package in Extensions.")) : null);
}
function statusGroup(e) {
  if (e.stagedVersion) return "Restart pending";
  if (e.revoked) return "Needs attention";
  if (e.updateAvailable) return "Updates available";
  return e.installedVersion ? "Installed" : "Available";
}
var STATUS_ORDER = ["Restart pending", "Needs attention", "Updates available", "Installed", "Available"];
var SORT_COLUMNS = [["name", "Package"], ["type", "Type"], ["installedVersion", "Installed"], ["version", "Available"], ["downloads", "Downloads"], ["stars", "Stars"], ["status", "Status"]];
function comparePackages(a, b, key, direction) {
  const value = (entry) => {
    if (key === "downloads" || key === "stars") {
      const metric = entry[key];
      return metric?.status === "available" && Number.isSafeInteger(metric.count) && metric.count >= 0 ? metric.count : null;
    }
    if (key === "type") return typeRank(entry.type);
    if (key === "status") return STATUS_ORDER.indexOf(statusGroup(entry));
    if (key === "version" && entry.revoked) return null;
    return entry[key] || null;
  };
  const x = value(a), y = value(b);
  if (x == null && y != null) return 1;
  if (y == null && x != null) return -1;
  const compared = x == null ? 0 : typeof x === "number" ? x - y : x.localeCompare(y, void 0, { numeric: true, sensitivity: "base" });
  return compared * (direction === "desc" ? -1 : 1) || a.name.localeCompare(b.name) || a.id.localeCompare(b.id);
}
function CatalogView({ catalog, tab, selectedId, onSelect, actions }) {
  const [search, setSearch] = React.useState("");
  const [typeFilter, setTypeFilter] = React.useState("");
  const [groupBy, setGroupBy] = React.useState(() => getPref("groupBy", "type"));
  const [sortBy, setSortBy] = React.useState(() => getPref("sortBy", "name"));
  const [sortDirection, setSortDirection] = React.useState(() => getPref("sortDirection", "asc"));
  const changeSort = (key, toggle = false) => {
    const direction = toggle && key === sortBy ? sortDirection === "asc" ? "desc" : "asc" : ["downloads", "stars", "installedVersion", "version"].includes(key) ? "desc" : "asc";
    setSortBy(key);
    setSortDirection(direction);
    setPref("sortBy", key);
    setPref("sortDirection", direction);
  };
  const [collapsed, setCollapsed] = React.useState({});
  const visible = (catalog.entries || []).filter((e) => e.installedVersion || e.stagedVersion || showsInWebUi(e));
  const entries = visible.filter((e) => (tab === "installed" ? e.installedVersion || e.stagedVersion : tab === "updates" ? e.updateAvailable && !e.stagedVersion && !e.revoked : !e.revoked) && (!typeFilter || e.type === typeFilter) && `${e.name} ${e.description} ${e.repo} ${(e.keywords || []).join(" ")}`.toLowerCase().includes(search.toLowerCase())).sort((a, b) => comparePackages(a, b, sortBy, sortDirection));
  const types = [...new Set(visible.map((e) => e.type))].sort((a, b) => typeRank(a) - typeRank(b));
  const groups = /* @__PURE__ */ new Map();
  for (const entry of entries) {
    const key = groupBy === "type" ? entry.type : groupBy === "status" ? statusGroup(entry) : "All packages";
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  const orderedGroups = [...groups].sort(([a], [b]) => groupBy === "type" ? typeRank(a) - typeRank(b) : groupBy === "status" ? STATUS_ORDER.indexOf(a) - STATUS_ORDER.indexOf(b) : 0);
  const selected = visible.find((e) => e.id === selectedId);
  return /* @__PURE__ */ React.createElement("div", { className: "cs-catalog" }, /* @__PURE__ */ React.createElement("div", { className: "cs-toolbar" }, /* @__PURE__ */ React.createElement("label", { className: "cs-search" }, /* @__PURE__ */ React.createElement("input", { className: "field", "aria-label": "Search packages", placeholder: "Search community packages\u2026", value: search, onChange: (e) => setSearch(e.target.value) })), /* @__PURE__ */ React.createElement("select", { className: "field", "aria-label": "Package type", value: typeFilter, onChange: (e) => setTypeFilter(e.target.value) }, /* @__PURE__ */ React.createElement("option", { value: "" }, "All package types"), types.map((type) => /* @__PURE__ */ React.createElement("option", { key: type, value: type }, TYPE_LABELS[type] || type))), /* @__PURE__ */ React.createElement("select", { className: "field", "aria-label": "Group packages", value: groupBy, onChange: (e) => {
    setGroupBy(e.target.value);
    setPref("groupBy", e.target.value);
  } }, /* @__PURE__ */ React.createElement("option", { value: "status" }, "Group by status"), /* @__PURE__ */ React.createElement("option", { value: "type" }, "Group by type"), /* @__PURE__ */ React.createElement("option", { value: "none" }, "No grouping")), /* @__PURE__ */ React.createElement("select", { className: "field", "aria-label": "Sort packages", value: sortBy, onChange: (e) => changeSort(e.target.value) }, SORT_COLUMNS.map(([key, label]) => /* @__PURE__ */ React.createElement("option", { key, value: key }, "Sort by ", label.toLowerCase()))), /* @__PURE__ */ React.createElement("button", { className: "btn btn-sm", "aria-label": "Reverse sort direction", onClick: () => changeSort(sortBy, true) }, sortDirection === "asc" ? "Ascending \u2191" : "Descending \u2193"), /* @__PURE__ */ React.createElement("span", { className: "cs-result-count", role: "status" }, entries.length, " package", entries.length === 1 ? "" : "s")), /* @__PURE__ */ React.createElement("div", { className: "cs-workspace", tabIndex: 0, "aria-label": "Package list" }, /* @__PURE__ */ React.createElement("table", { className: "cs-table" }, /* @__PURE__ */ React.createElement("thead", null, /* @__PURE__ */ React.createElement("tr", null, SORT_COLUMNS.map(([key, label]) => /* @__PURE__ */ React.createElement("th", { key, scope: "col", "aria-sort": sortBy === key ? sortDirection === "asc" ? "ascending" : "descending" : "none" }, /* @__PURE__ */ React.createElement("button", { className: "cs-sort-heading", onClick: () => changeSort(key, true), title: key === "downloads" ? DOWNLOAD_NOTE : `Sort by ${label.toLowerCase()}` }, label, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, sortBy === key ? sortDirection === "asc" ? " \u2191" : " \u2193" : " \u2195")))))), orderedGroups.map(([key, items]) => /* @__PURE__ */ React.createElement("tbody", { key }, groupBy !== "none" ? /* @__PURE__ */ React.createElement("tr", { className: "cs-group" }, /* @__PURE__ */ React.createElement("th", { colSpan: 7, scope: "rowgroup" }, /* @__PURE__ */ React.createElement("button", { "aria-expanded": !collapsed[groupBy + key], onClick: () => setCollapsed((old) => ({ ...old, [groupBy + key]: !old[groupBy + key] })) }, /* @__PURE__ */ React.createElement("span", { "aria-hidden": "true" }, collapsed[groupBy + key] ? "\u25B8" : "\u25BE"), " ", groupBy === "type" ? TYPE_LABELS[key] || key : key, " ", /* @__PURE__ */ React.createElement("span", { className: "cs-count" }, items.length)))) : null, (groupBy === "none" || !collapsed[groupBy + key]) && items.map((entry) => /* @__PURE__ */ React.createElement("tr", { key: entry.id, className: "cs-package-row", onClick: () => onSelect(entry.id) }, /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement("button", { className: "cs-package", "aria-haspopup": "dialog", onClick: (e) => {
    e.stopPropagation();
    onSelect(entry.id);
  } }, /* @__PURE__ */ React.createElement(PackageIcon, { type: entry.type }), /* @__PURE__ */ React.createElement("span", null, /* @__PURE__ */ React.createElement("span", { className: "cs-name" }, entry.name), /* @__PURE__ */ React.createElement("span", { className: "cs-description" }, entry.description)))), /* @__PURE__ */ React.createElement("td", null, TYPE_LABELS[entry.type] || entry.type), /* @__PURE__ */ React.createElement("td", null, entry.installedVersion || "\u2014"), /* @__PURE__ */ React.createElement("td", null, entry.revoked ? "\u2014" : entry.version), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(DownloadCount, { entry })), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(StarCount, { entry })), /* @__PURE__ */ React.createElement("td", null, /* @__PURE__ */ React.createElement(PackageStatus, { entry }))))))), !entries.length ? /* @__PURE__ */ React.createElement("div", { className: "cs-empty" }, search || typeFilter ? "No matches. Try another search or package type." : tab === "updates" ? "No updates available in the current catalog." : tab === "installed" ? "No store packages are installed on this engine." : "No packages available. Check your sources and sync status in Settings.") : null), selected ? /* @__PURE__ */ React.createElement(ConfirmOverlay, { documentation: true, closeLabel: "Close package details", inactive: !!actions.overlay, title: selected.name, onCancel: () => onSelect(null) }, /* @__PURE__ */ React.createElement(DetailView, { key: selected.id, entry: selected, actions })) : null);
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
  const [selectedId, setSelectedId] = React.useState(null);
  const [completion, setCompletion] = React.useState(null);
  const [staged, setStaged] = React.useState({});
  const request = React.useRef(0);
  const refresh = async (force) => {
    const current = ++request.current;
    setLoading(true);
    setError(null);
    try {
      const data2 = await apiGet(`${BASE}/catalog?refresh=${force ? "true" : "false"}`);
      if (request.current !== current) return;
      setCatalog(data2);
      setStaged((previous) => Object.fromEntries(Object.entries(previous).filter(([id, version]) => !(data2.entries || []).some((e) => e.id === id && e.installedVersion === version))));
    } catch (e) {
      if (request.current === current) setError(errText(e));
    } finally {
      if (request.current === current) setLoading(false);
    }
  };
  React.useEffect(() => {
    refresh(false);
    return () => {
      request.current++;
    };
  }, []);
  const actions = useStoreActions(refresh, (result) => {
    setCompletion(result);
    if (result.restartRequired) setStaged((previous) => ({ ...previous, [result.entry.id]: result.entry.version }));
  });
  const data = catalog ? { ...catalog, entries: (catalog.entries || []).map((entry) => ({ ...entry, stagedVersion: staged[entry.id], downloads: entry.statistics?.downloads, stars: entry.statistics?.stars })) } : null;
  const visible = (data?.entries || []).filter((e) => e.installedVersion || e.stagedVersion || showsInWebUi(e));
  const counts = {
    browse: visible.filter((e) => !e.revoked).length,
    installed: visible.filter((e) => e.installedVersion || e.stagedVersion).length,
    updates: visible.filter((e) => e.updateAvailable && !e.stagedVersion && !e.revoked).length
  };
  return /* @__PURE__ */ React.createElement("div", { className: "view cs-store flex flex-col flex-1 min-h-0" }, /* @__PURE__ */ React.createElement("style", null, STORE_CSS), actions.overlay, /* @__PURE__ */ React.createElement("div", { className: "cs-header" }, /* @__PURE__ */ React.createElement("header", { className: "cs-heading" }, /* @__PURE__ */ React.createElement("div", null, /* @__PURE__ */ React.createElement("h1", null, "Community Store"), /* @__PURE__ */ React.createElement("p", null, "Extend your engine. Make it your own.")), /* @__PURE__ */ React.createElement("div", { className: "cs-sync" }, /* @__PURE__ */ React.createElement("button", { className: "btn", onClick: () => refresh(true), disabled: loading || actions.busy }, loading ? "Syncing\u2026" : "\u21BB Sync sources"), /* @__PURE__ */ React.createElement("div", null, catalog ? `Engine ${catalog.engineVersion} \xB7 Synced ${new Date(catalog.generatedAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}` : "Connecting to engine"))), /* @__PURE__ */ React.createElement("nav", { className: "cs-tabs", "aria-label": "Community Store views" }, [["browse", "Discover"], ["installed", "Installed"], ["updates", "Updates"], ...canEditSettings() ? [["settings", "Settings"]] : []].map(([id, label]) => /* @__PURE__ */ React.createElement("button", { key: id, className: `cs-tab ${tab === id ? "active" : ""}`, "aria-current": tab === id ? "page" : void 0, onClick: () => setTab(id) }, label, id !== "settings" && data ? /* @__PURE__ */ React.createElement("span", { className: "cs-count" }, counts[id]) : null)))), /* @__PURE__ */ React.createElement("div", { className: "view-body cs-body" }, error ? /* @__PURE__ */ React.createElement("div", { className: "cs-notice error", role: "alert" }, "Could not load the catalog: ", error, " ", /* @__PURE__ */ React.createElement("button", { className: "btn btn-sm", onClick: () => refresh(true), disabled: loading }, "Retry")) : null, data?.errors?.length ? /* @__PURE__ */ React.createElement("div", { className: "cs-notice warn", role: "status" }, /* @__PURE__ */ React.createElement("strong", null, "Some sources could not sync."), " Results may be incomplete.", data.errors.map((e, i) => /* @__PURE__ */ React.createElement("div", { key: i }, e.source, ": ", e.message))) : null, completion ? /* @__PURE__ */ React.createElement("div", { className: "cs-notice", role: "status" }, completion.restartRequired ? `${completion.entry.name} ${completion.entry.version} is staged. Restart the engine to activate it.` : completion.mode === "remove" ? `${completion.entry.name} was removed.` : `${completion.entry.name} was imported${completion.mode === "copy" ? " as a copy" : ""}. It is available now.`, " ", /* @__PURE__ */ React.createElement("button", { className: "btn btn-sm", onClick: () => setCompletion(null), "aria-label": "Dismiss result" }, "Dismiss")) : null, tab === "settings" && canEditSettings() ? /* @__PURE__ */ React.createElement("div", { className: "cs-settings-scroll" }, /* @__PURE__ */ React.createElement(SettingsView, { catalog, onSaved: () => refresh(true) })) : data ? /* @__PURE__ */ React.createElement(CatalogView, { catalog: data, tab, selectedId, onSelect: setSelectedId, actions }) : loading ? /* @__PURE__ */ React.createElement("div", { className: "cs-empty", role: "status" }, "Loading community packages\u2026") : null));
}
function register() {
  platform.registerNavItem({
    id: "community-store",
    label: "Community Store",
    icon: "store",
    path: "/community-store",
    section: "Engine",
    order: 80,
    // The store's own task, declared in CommunityStoreServicePlugin's
    // ExtensionPermissions → "View Community Store". RBAC merges it via
    // /task-permissions; without RBAC the nav is always visible.
    task: "doShowCommunityStore"
  });
  platform.registerView("/community-store", platform.reactView(CommunityStoreView), { title: "Community Store" });
}
export {
  register
};
