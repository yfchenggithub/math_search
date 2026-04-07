type KatexOptions = {
  displayMode?: boolean;
  output?: "html" | "mathml" | "htmlAndMathml";
  strict?: "ignore";
  throwOnError?: boolean;
  trust?: boolean;
};

type KatexTreeNode = {
  classes?: string[];
  attributes?: Record<string, string>;
  style?: Record<string, string | number>;
  children?: KatexTreeNode[];
  text?: string;
  alternate?: string;
  pathName?: string;
};

type KatexRenderer = {
  renderToString: (source: string, options: KatexOptions) => string;
  __renderToHTMLTree: (source: string, options: KatexOptions) => KatexTreeNode;
};

type StyleMap = Record<string, string>;

type RenderMathAlign = "left" | "center";

type RenderMathOptions = {
  align?: RenderMathAlign;
};

type SerializeContext = {
  parentClasses: string[];
  grandParentClasses: string[];
  parentIsVlistChild: boolean;
  displayAlign: RenderMathAlign;
};

export interface RenderMathResult {
  html: string;
  rendered: boolean;
  source: string;
}

type MixedTextSegment = {
  kind: "text" | "math";
  content: string;
};

const katex = require("../vendor/katex.js") as KatexRenderer;

const CLASS_STYLE_MAP: Record<string, StyleMap> = {
  "katex-display": {
    display: "inline-block",
    "min-width": "100%",
  },
  katex: {
    "font-family": "KaTeX_Main, Times New Roman, serif",
    "font-size": "1.21em",
    "font-style": "normal",
    "font-weight": "400",
    "line-height": "1.2",
    position: "relative",
    "text-indent": "0",
    "white-space": "nowrap",
  },
  base: {
    position: "relative",
    display: "inline-block",
    "white-space": "nowrap",
  },
  strut: {
    display: "inline-block",
  },
  mathnormal: {
    "font-family": "KaTeX_Math, KaTeX_Main, Times New Roman, serif",
    "font-style": "italic",
  },
  mop: {
    "font-style": "normal",
  },
  amsrm: {
    "font-family": "KaTeX_AMS, KaTeX_Main, Times New Roman, serif",
  },
  "vlist-t": {
    display: "inline-table",
    "table-layout": "fixed",
    "border-collapse": "collapse",
  },
  "vlist-r": {
    display: "table-row",
  },
  vlist: {
    display: "table-cell",
    "vertical-align": "bottom",
    position: "relative",
  },
  "vlist-t2": {
    "margin-right": "-2px",
  },
  "vlist-s": {
    display: "table-cell",
    "vertical-align": "bottom",
    "font-size": "1px",
    width: "2px",
    "min-width": "2px",
  },
  msupsub: {
    "text-align": "left",
  },
  mfrac: {
    display: "inline-block",
    "text-align": "center",
  },
  "frac-line": {
    display: "inline-block",
    width: "100%",
    "border-bottom-style": "solid",
    "min-height": "1px",
  },
  mspace: {
    display: "inline-block",
  },
  nulldelimiter: {
    display: "inline-block",
    width: "0.12em",
  },
  delimcenter: {
    position: "relative",
  },
  "op-symbol": {
    position: "relative",
  },
  "large-op": {
    "font-family": "KaTeX_Size2, KaTeX_Main, Times New Roman, serif",
  },
  root: {
    "margin-left": "0.2777777778em",
    "margin-right": "-0.5555555556em",
  },
  "hide-tail": {
    overflow: "hidden",
    position: "relative",
    width: "100%",
  },
  "svg-align": {
    "text-align": "left",
  },
  newline: {
    display: "block",
  },
};

const DELIMITER_FONT_MAP: Record<string, string> = {
  size1: "KaTeX_Size1, KaTeX_Main, Times New Roman, serif",
  size2: "KaTeX_Size2, KaTeX_Main, Times New Roman, serif",
  size3: "KaTeX_Size3, KaTeX_Main, Times New Roman, serif",
  size4: "KaTeX_Size4, KaTeX_Main, Times New Roman, serif",
};

const SIZING_FONT_MAP: Record<string, Record<string, string>> = {
  "reset-size3": {
    size1: "0.7142857143em",
    size6: "1.4285714286em",
  },
  "reset-size6": {
    size1: "0.5em",
    size3: "0.7em",
  },
};

const EMPTY_CONTEXT: SerializeContext = {
  parentClasses: [],
  grandParentClasses: [],
  parentIsVlistChild: false,
  displayAlign: "center",
};

const PRIVATE_USE_GLYPH_MAP: Record<string, string> = {
  "\uE020": "\u2260",
};

export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function normalizeLegacyMath(input?: string): string {
  if (!input) {
    return "";
  }

  let normalized = stripMathDelimiters(input.trim());

  if (!normalized) {
    return "";
  }

  const explicitLatex = hasExplicitLatex(normalized);

  normalized = normalized
    .replace(/[\u3000]/g, " ")
    .replace(/\s+/g, " ")
    .replace(/\u2264/g, "\\leq ")
    .replace(/\u2265/g, "\\geq ")
    .replace(/\u2260/g, "\\neq ")
    .replace(/\u221e/g, "\\infty ")
    .replace(/>=/g, " \\geq ")
    .replace(/<=/g, " \\leq ")
    .replace(/!=/g, " \\neq ");

  if (!explicitLatex) {
    normalized = normalized
      .replace(/\|([^|]+)\|/g, "\\left|$1\\right|")
      .replace(/sqrt\(([^()]+)\)/g, "\\sqrt{$1}")
      .replace(/\(([^()]+)\)\s*\/\s*\(([^()]+)\)/g, "\\frac{$1}{$2}");
  }

  normalized = normalized
    .replace(/(^|[^\\])in R\^\+/g, "$1\\in \\mathbb{R}^{+}")
    .replace(/(^|[^\\])in R\b/g, "$1\\in \\mathbb{R}")
    .replace(/(^|[^\\])R\^\+/g, "$1\\mathbb{R}^{+}")
    .replace(/(^|[^\\])ln\b/g, "$1\\ln")
    .replace(/(^|[^\\])sin\b/g, "$1\\sin")
    .replace(/(^|[^\\])cos\b/g, "$1\\cos")
    .replace(/(^|[^\\])tan\b/g, "$1\\tan")
    .replace(/(^|[^\\])log\b/g, "$1\\log")
    .replace(/(^|[^\\])pi\b/g, "$1\\pi")
    .replace(/(^|[^\\])alpha\b/g, "$1\\alpha")
    .replace(/(^|[^\\])beta\b/g, "$1\\beta")
    .replace(/(^|[^\\])gamma\b/g, "$1\\gamma")
    .replace(/(^|[^\\])theta\b/g, "$1\\theta")
    .replace(/(^|[^\\])lambda\b/g, "$1\\lambda")
    .replace(/\s+/g, " ")
    .trim();

  return normalized;
}

function stripMathDelimiters(input: string): string {
  let normalized = input.trim();
  let changed = true;

  while (changed && normalized) {
    changed = false;

    const wrappedPairs: Array<[string, string]> = [
      ["$$", "$$"],
      ["\\[", "\\]"],
      ["$", "$"],
      ["\\(", "\\)"],
    ];

    for (let index = 0; index < wrappedPairs.length; index += 1) {
      const [open, close] = wrappedPairs[index];

      if (
        normalized.startsWith(open)
        && normalized.endsWith(close)
        && normalized.length > open.length + close.length
      ) {
        normalized = normalized.slice(open.length, normalized.length - close.length).trim();
        changed = true;
        break;
      }
    }
  }

  return normalized;
}

function hasExplicitLatex(input: string): boolean {
  return /\\[A-Za-z]+/.test(input) || /\\[,;!]/.test(input);
}

export function renderMath(
  source?: string,
  displayMode = false,
  options: RenderMathOptions = {},
): RenderMathResult {
  const normalizedSource = normalizeLegacyMath(source);
  const displayAlign = options.align || (displayMode ? "center" : "left");

  if (!normalizedSource) {
    return {
      html: "",
      rendered: false,
      source: "",
    };
  }

  try {
    katex.renderToString(normalizedSource, {
      displayMode,
      output: "html",
      strict: "ignore",
      throwOnError: true,
      trust: false,
    });

    const tree = katex.__renderToHTMLTree(normalizedSource, {
      displayMode,
      output: "html",
      strict: "ignore",
      throwOnError: true,
      trust: false,
    });

    return {
      html: serializeMathTree(tree, {
        ...EMPTY_CONTEXT,
        displayAlign,
      }),
      rendered: true,
      source: normalizedSource,
    };
  } catch (error) {
    console.warn("KaTeX render fallback", error);
    return createFallbackResult(normalizedSource, displayMode, displayAlign);
  }
}

export function renderMathHtml(
  source?: string,
  displayMode = false,
  options: RenderMathOptions = {},
): string {
  return renderMath(source, displayMode, options).html;
}

export function renderPlainTextHtml(source?: string, inline = false): string {
  const normalizedSource = source || "";

  if (!normalizedSource) {
    return "";
  }

  const tag = inline ? "span" : "div";
  const display = inline ? "inline" : "block";
  const escaped = escapeHtml(normalizedSource).replace(/\r?\n/g, "<br/>");

  return `<${tag} style="display:${display};white-space:pre-wrap;">${escaped}</${tag}>`;
}

export function renderMixedTextHtml(source?: string): string {
  const normalizedSource = source || "";

  if (!normalizedSource) {
    return "";
  }

  return normalizedSource
    .split(/\r?\n/)
    .map((line) => renderMixedLineHtml(line))
    .join("<br/>");
}

function createFallbackResult(
  source: string,
  displayMode: boolean,
  align: RenderMathAlign,
): RenderMathResult {
  const tag = displayMode ? "div" : "span";
  const display = displayMode ? "block" : "inline-block";
  const textAlign = displayMode ? align : "left";

  return {
    html: `<${tag} style="display:${display};white-space:nowrap;color:#475569;text-align:${textAlign};">${escapeHtml(source)}</${tag}>`,
    rendered: false,
    source,
  };
}

function renderMixedLineHtml(line: string): string {
  const segments = splitMixedTextSegments(line);

  return segments
    .map((segment) => {
      if (segment.kind === "text") {
        return escapeTextForHtml(segment.content);
      }

      const leadingDecoration = segment.content.match(/^[\s，。；：、！？（）【】《》“”‘’…,.!?;:]+/)?.[0] || "";
      const trailingDecoration = segment.content.match(/[\s，。；：、！？（）【】《》“”‘’…,.!?;:]+$/)?.[0] || "";
      const coreContent = segment.content
        .slice(leadingDecoration.length, segment.content.length - trailingDecoration.length)
        .trim();

      if (!coreContent) {
        return escapeTextForHtml(segment.content);
      }

      const mathHtml = renderMath(coreContent, false).html;

      if (!mathHtml) {
        return escapeTextForHtml(segment.content);
      }

      return `${escapeTextForHtml(leadingDecoration)}${mathHtml}${escapeTextForHtml(trailingDecoration)}`;
    })
    .join("");
}

function splitMixedTextSegments(line: string): MixedTextSegment[] {
  const rawSegments = line.match(/[\u4e00-\u9fa5]+|[^\u4e00-\u9fa5]+/g) || [line];
  const result: MixedTextSegment[] = [];

  rawSegments.forEach((segment) => {
    const kind: MixedTextSegment["kind"] = shouldRenderSegmentAsMath(segment) ? "math" : "text";
    const previous = result[result.length - 1];

    if (previous && previous.kind === kind) {
      previous.content += segment;
      return;
    }

    result.push({
      kind,
      content: segment,
    });
  });

  return result;
}

function shouldRenderSegmentAsMath(segment: string): boolean {
  const candidate = segment
    .trim()
    .replace(/^[，。；：、！？（）【】《》“”‘’…,.!?;:]+/, "")
    .replace(/[，。；：、！？（）【】《》“”‘’…,.!?;:]+$/, "");

  if (!candidate) {
    return false;
  }

  if (/^[，。；：、！？（）【】《》“”‘’…,.!?;:]+$/.test(candidate)) {
    return false;
  }

  if (/^(PDF|SVG|PNG|MP4|ID)$/i.test(candidate)) {
    return false;
  }

  if (/\\[A-Za-z]+/.test(candidate)) {
    return true;
  }

  if (/(sqrt|ln|log|sin|cos|tan|frac|sum|prod|int|lim)\s*(\(|\{)?/i.test(candidate)) {
    return true;
  }

  if (/[A-Za-z]/.test(candidate) && /[_^=<>+\-*/]/.test(candidate)) {
    return true;
  }

  if (/[A-Za-z]/.test(candidate) && /\d/.test(candidate)) {
    return true;
  }

  if (/^[A-Za-z]$/.test(candidate)) {
    return true;
  }

  if (/^[A-Za-z](?:\s*[<>]\s*[A-Za-z0-9_])+(?:\s*[<>]\s*[A-Za-z0-9_])+?$/.test(candidate)) {
    return true;
  }

  if (/^\([A-Za-z0-9_\\+\-*/=<>.,\s]+\)$/.test(candidate)) {
    return true;
  }

  return false;
}

function escapeTextForHtml(input: string): string {
  return escapeHtml(input).replace(/ /g, "&nbsp;");
}

function serializeMathTree(node: KatexTreeNode, context: SerializeContext): string {
  if (typeof node.text === "string") {
    return serializeTextNode(node, context);
  }

  if (isSvgNode(node)) {
    return serializeSvgNode(node);
  }

  const classes = getClassList(node);
  const compositeRelationHtml = serializeCompositeRelation(node, classes, context);

  if (compositeRelationHtml) {
    return compositeRelationHtml;
  }

  const styles = resolveNodeStyles(node, classes, context);
  const attributes = serializeAttributes(node.attributes, styles);
  const children = (node.children || [])
    .map((child) =>
      serializeMathTree(child, {
        parentClasses: classes,
        grandParentClasses: context.parentClasses,
        parentIsVlistChild: context.parentClasses.includes("vlist"),
        displayAlign: context.displayAlign,
      }),
    )
    .join("");

  return `<span${attributes}>${children}</span>`;
}

function serializeTextNode(node: KatexTreeNode, context: SerializeContext): string {
  const classes = getClassList(node);
  const styles = resolveNodeStyles(node, classes, context);
  const text = escapeHtml(normalizeMathGlyphs(node.text || ""));

  if (Object.keys(styles).length === 0) {
    return `<span>${text}</span>`;
  }

  return `<span style="${styleMapToString(styles)}">${text}</span>`;
}

function normalizeMathGlyphs(input: string): string {
  let normalized = "";

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    normalized += PRIVATE_USE_GLYPH_MAP[char] || char;
  }

  return normalized;
}

function serializeCompositeRelation(
  node: KatexTreeNode,
  classes: string[],
  context: SerializeContext,
): string | null {
  if (!classes.includes("mrel")) {
    return null;
  }

  const normalizedText = collectNormalizedText(node)
    .replace(/\s+/g, "")
    .replace(/\u200b/g, "");

  // KaTeX emits \neq as an overlaid slash glyph plus a visible "=" node.
  // WeChat rich-text does not reliably keep that overlay, so we collapse the
  // composite relation into a single not-equal glyph.
  if (!(normalizedText.includes("\u2260") && normalizedText.includes("="))) {
    return null;
  }

  const styles = resolveNodeStyles(node, classes, context);
  const attributes = serializeAttributes(node.attributes, styles);
  return `<span${attributes}>\u2260</span>`;
}

function collectNormalizedText(node: KatexTreeNode): string {
  if (typeof node.text === "string") {
    return normalizeMathGlyphs(node.text || "");
  }

  return (node.children || [])
    .map((child) => collectNormalizedText(child))
    .join("");
}

function serializeSvgNode(node: KatexTreeNode): string {
  if ((node.children || []).some((child) => child.pathName === "vert")) {
    return serializeVerticalDelimiterFallback(node);
  }

  if ((node.children || []).some((child) => /^sqrt/.test(child.pathName || ""))) {
    return serializeSqrtFallback(node);
  }

  const attributes: Record<string, string> = {};
  const sourceAttributes = node.attributes || {};

  Object.keys(sourceAttributes).forEach((key) => {
    attributes[key] = sourceAttributes[key];
  });

  attributes.style = styleMapToString({
    display: "block",
    overflow: "visible",
    fill: "currentColor",
    stroke: "currentColor",
    "fill-rule": "nonzero",
    "fill-opacity": "1",
  });

  const children = (node.children || [])
    .map((child) => {
      if (!child.alternate) {
        return "";
      }

      return `<path d="${escapeAttribute(child.alternate)}" style="stroke:none;"></path>`;
    })
    .join("");

  return `<svg${stringifyAttributes(attributes)}>${children}</svg>`;
}

function serializeVerticalDelimiterFallback(node: KatexTreeNode): string {
  const width = String(node.attributes?.width || "0.333em");
  const height = String(node.attributes?.height || "1em");
  const containerStyle = styleMapToString({
    display: "block",
    width,
    height,
    overflow: "visible",
  });
  const barStyle = styleMapToString({
    display: "block",
    width: "0",
    height: "100%",
    margin: "0 auto",
    "border-left": "1.3px solid currentColor",
    "box-sizing": "border-box",
  });

  return `<span style="${containerStyle}"><span style="${barStyle}"></span></span>`;
}

function serializeSqrtFallback(node: KatexTreeNode): string {
  const height = String(node.attributes?.height || "1em");
  const heightEm = parseEmSize(height, 1);
  const radicalFontSize = Math.max(1.08, heightEm * 0.96);
  const radicalTop = -Math.max(0.04, heightEm * 0.13);
  const overlineLeft = Math.max(0.42, radicalFontSize * 0.33);
  const overlineTop = Math.max(0.08, heightEm * 0.07);
  const overlineThickness = Math.max(1, Math.round(heightEm * 0.56)) / 2;

  const containerStyle = styleMapToString({
    display: "block",
    position: "relative",
    width: "100%",
    height,
    overflow: "visible",
  });
  const radicalStyle = styleMapToString({
    position: "absolute",
    left: "0",
    top: `${radicalTop}em`,
    "font-size": `${radicalFontSize}em`,
    "line-height": "1",
  });
  const overlineStyle = styleMapToString({
    position: "absolute",
    left: `${overlineLeft}em`,
    right: "0",
    top: `${overlineTop}em`,
    height: "0",
    "border-top": `${overlineThickness}px solid currentColor`,
  });

  return `<span style="${containerStyle}"><span style="${radicalStyle}">&#8730;</span><span style="${overlineStyle}"></span></span>`;
}

function parseEmSize(value: string, fallback: number): number {
  const match = String(value).match(/^([0-9.]+)em$/);

  if (!match) {
    return fallback;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function resolveNodeStyles(
  node: KatexTreeNode,
  classes: string[],
  context: SerializeContext,
): StyleMap {
  const styles: StyleMap = {};

  classes.forEach((className) => {
    mergeStyles(styles, CLASS_STYLE_MAP[className]);
  });

  const delimiterSize = classes.find((className) => /^size[1-4]$/.test(className));
  if (classes.includes("delimsizing") && delimiterSize) {
    mergeStyles(styles, {
      "font-family": DELIMITER_FONT_MAP[delimiterSize],
    });
  }

  if (classes.includes("sizing")) {
    const resetSize = classes.find((className) => /^reset-size\d+$/.test(className));
    const currentSize = classes.find((className) => /^size\d+$/.test(className));

    if (resetSize && currentSize) {
      const fontSize = SIZING_FONT_MAP[resetSize]?.[currentSize];
      if (fontSize) {
        mergeStyles(styles, {
          "font-size": fontSize,
        });
      }
    }
  }

  if (classes.includes("katex") && context.parentClasses.includes("katex-display")) {
    mergeStyles(styles, {
      display: "inline-block",
      "min-width": "100%",
      "text-align": context.displayAlign,
      "white-space": "nowrap",
    });
  }

  if (classes.includes("katex-display")) {
    mergeStyles(styles, {
      "text-align": context.displayAlign,
    });
  }

  if (classes.includes("katex-html") && context.parentClasses.includes("katex")) {
    const isDisplayMath = context.grandParentClasses.includes("katex-display");

    mergeStyles(styles, {
      display: isDisplayMath ? "block" : "inline-block",
      position: "relative",
      "white-space": "nowrap",
      "vertical-align": "baseline",
    });
  }

  if (context.parentClasses.includes("vlist")) {
    mergeStyles(styles, {
      display: "block",
      height: "0",
      position: "relative",
    });
  }

  if (context.parentIsVlistChild) {
    mergeStyles(styles, {
      display: "inline-block",
    });
  }

  if (
    context.parentClasses.includes("vlist-t") &&
    context.grandParentClasses.includes("mfrac")
  ) {
    mergeStyles(styles, {
      "text-align": "center",
    });
  }

  if (classes.includes("vlist-t") && context.parentClasses.includes("op-limits")) {
    mergeStyles(styles, {
      "text-align": "center",
    });
  }

  mergeStyles(styles, normalizeStyleObject(node.style));
  removeEmptyStyles(styles);
  return styles;
}

function normalizeStyleObject(input?: Record<string, string | number>): StyleMap {
  const result: StyleMap = {};

  if (!input) {
    return result;
  }

  Object.keys(input).forEach((key) => {
    const value = input[key];
    if (value === null || value === undefined || value === "") {
      return;
    }

    result[toKebabCase(key)] = String(value);
  });

  return result;
}

function serializeAttributes(
  input: Record<string, string> | undefined,
  styles: StyleMap,
): string {
  const attributes: Record<string, string> = {};
  const sourceAttributes = input || {};

  Object.keys(sourceAttributes).forEach((key) => {
    attributes[key] = sourceAttributes[key];
  });

  if (Object.keys(styles).length > 0) {
    attributes.style = styleMapToString(styles);
  }

  return stringifyAttributes(attributes);
}

function stringifyAttributes(attributes: Record<string, string>): string {
  const keys = Object.keys(attributes);

  if (keys.length === 0) {
    return "";
  }

  return keys
    .map((key) => ` ${key}="${escapeAttribute(attributes[key])}"`)
    .join("");
}

function styleMapToString(styles: StyleMap): string {
  return Object.keys(styles)
    .map((key) => `${key}:${styles[key]}`)
    .join(";");
}

function mergeStyles(target: StyleMap, source?: StyleMap) {
  if (!source) {
    return;
  }

  Object.keys(source).forEach((key) => {
    target[key] = source[key];
  });
}

function removeEmptyStyles(styles: StyleMap) {
  Object.keys(styles).forEach((key) => {
    if (!styles[key]) {
      delete styles[key];
    }
  });
}

function getClassList(node: KatexTreeNode): string[] {
  return (node.classes || []).filter(Boolean);
}

function isSvgNode(node: KatexTreeNode): boolean {
  return Boolean(node.attributes?.viewBox);
}

function toKebabCase(input: string): string {
  return input.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function escapeAttribute(input: string): string {
  return String(input)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}
