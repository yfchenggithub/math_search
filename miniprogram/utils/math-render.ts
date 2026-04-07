/**
 * 小程序数学渲染工具层。
 *
 * 这个文件的目标不是“完整实现一个数学排版引擎”，而是把 KaTeX 的渲染结果
 * 尽可能稳定地翻译成微信小程序 `rich-text` 能接受的 HTML 片段。
 *
 * 为什么这个文件会比较复杂：
 * 1. 小程序 `rich-text` 对浏览器里常见的 CSS / SVG / overlay 行为支持不完整。
 * 2. KaTeX 生成的结构很细，根号、绝对值、叠加关系符、分式、上下标往往依赖复杂 DOM。
 * 3. 详情页和搜索页同时存在 block math、inline math、纯文本、中文混排等多种场景。
 *
 * 因此这里分成了几层：
 * - 归一化层：把 legacy/plain 输入尽量整理成更稳定的 latex。
 * - 渲染入口层：决定是 block 还是 inline，以及渲染失败时如何兜底。
 * - 序列化层：把 KaTeX tree 转成小程序可接受的 HTML。
 * - 兼容修补层：专门修复微信环境下不稳定的根号、竖线、`\\neq` 等结构。
 *
 * 推荐阅读顺序：
 * 1. `normalizeLegacyMath`
 * 2. `renderMath`
 * 3. `renderMixedTextHtml`
 * 4. `serializeMathTree`
 * 5. `serializeSvgNode` 及几个 fallback
 */
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

/**
 * KaTeX class 到小程序可执行样式的映射表。
 *
 * 核心思路：
 * - 尽量保留 KaTeX 的排版语义；
 * - 但要把浏览器里依赖复杂布局的表现，转换成小程序更稳定的 display / position / white-space。
 */
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

/**
 * 纯文本 HTML 转义。
 * 既服务普通文本，也服务数学渲染失败时的兜底输出。
 */
export function escapeHtml(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * 归一化 legacy 数学文本。
 *
 * 解决的问题：
 * - 老数据里可能混用 `!=`、`sqrt(...)`、`ln x`、普通括号分式等不够标准的写法。
 * - structured v2 数据虽然更规范，但页面其它位置仍可能传入半结构化公式文本。
 *
 * 输入：
 * - 原始字符串，可能是 plain text，也可能已经是部分 latex。
 *
 * 输出：
 * - 更接近 KaTeX 可稳定处理的 latex 字符串。
 */
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

/**
 * 去掉公式外层可能包裹的数学定界符，如 `$...$`、`\\(...\\)`、`$$...$$`。
 */
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

/**
 * 判断输入是否已经显式包含 latex 命令。
 * 这样后续归一化时可以更保守，避免把本来就正确的 latex 再次误改写。
 */
function hasExplicitLatex(input: string): boolean {
  return /\\[A-Za-z]+/.test(input) || /\\[,;!]/.test(input);
}

/**
 * 数学渲染总入口。
 *
 * 输入：
 * - `source`：原始公式字符串。
 * - `displayMode`：
 *   - `true`：独立公式块（block math）。
 *   - `false`：行内公式（inline math）。
 * - `options.align`：仅对 display math 有意义，用于控制左对齐或居中。
 *
 * 输出：
 * - `RenderMathResult`
 *   - `html`：小程序可用的 HTML。
 *   - `rendered`：是否成功走了 KaTeX 渲染链。
 *   - `source`：归一化后的公式源码。
 *
 * 处理流程：
 * 1. 先做 legacy 归一化。
 * 2. 调用 KaTeX 生成 HTML tree。
 * 3. 把 tree 序列化成 rich-text 可接受的结构。
 * 4. 如失败则回退到纯文本形式，保证页面不崩。
 */
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

/**
 * `renderMath` 的便捷包装，只取 html。
 */
export function renderMathHtml(
  source?: string,
  displayMode = false,
  options: RenderMathOptions = {},
): string {
  return renderMath(source, displayMode, options).html;
}

/**
 * 纯文本渲染为 HTML。
 *
 * 使用场景：
 * - structured 中的纯 text item
 * - theorem 的 title / desc
 * - 需要明确保持原始换行和空格的普通说明文本
 */
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

/**
 * “中文说明 + 简单数学内容”混排渲染。
 *
 * 这个函数主要服务 legacy 文本：
 * - 它会先按每一行拆开；
 * - 再在一行内部做启发式 text / math 分段；
 * - 数学片段走 inline math，其余片段保留普通文本。
 *
 * 注意：structured v2 的 `segments` 不依赖这里做主分段，
 * 因为 structured 数据已经明确给出了 text 与 math 的边界。
 */
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

/**
 * KaTeX 渲染失败时的最后兜底。
 * 它宁可展示一段未排版的文本，也不让页面直接空白或报错。
 */
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

/**
 * 渲染 legacy 文本中的单行 mixed 内容。
 * 这里会保留中英文标点，并只把真正可识别为公式的核心片段送去数学渲染。
 */
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

/**
 * 把一行 legacy 文本粗分成 text / math 片段。
 * 这一步是启发式规则，不追求严格数学解析，重点是提升常见教学文本的可读性。
 */
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

/**
 * 判断某个片段是否更像数学内容。
 * 规则会优先识别 latex 命令、函数名、变量下标、比较符和简单坐标/表达式形式。
 */
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

/**
 * 纯文本转 HTML，同时保留空格。
 * 主要用于 mixed-text 渲染时不丢失句内 spacing。
 */
function escapeTextForHtml(input: string): string {
  return escapeHtml(input).replace(/ /g, "&nbsp;");
}

/**
 * KaTeX tree -> 小程序 HTML 的核心序列化入口。
 *
 * 这是整条数学渲染链里最关键的函数之一：
 * - 普通文本节点走 `serializeTextNode`
 * - SVG 节点走 `serializeSvgNode`
 * - 其余 span 类节点递归处理 children 并拼装 style / attributes
 */
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

/**
 * 文本节点序列化。
 * 这里除了普通转义，还会先做 glyph 归一化，修复私有字形在小程序中的显示问题。
 */
function serializeTextNode(node: KatexTreeNode, context: SerializeContext): string {
  const classes = getClassList(node);
  const styles = resolveNodeStyles(node, classes, context);
  const text = escapeHtml(normalizeMathGlyphs(node.text || ""));

  if (Object.keys(styles).length === 0) {
    return `<span>${text}</span>`;
  }

  return `<span style="${styleMapToString(styles)}">${text}</span>`;
}

/**
 * 将 KaTeX 中某些私有字形映射为标准 Unicode。
 * 这样即使小程序环境无法正确识别 KaTeX 私有字体，也能尽量显示成可读字符。
 */
function normalizeMathGlyphs(input: string): string {
  let normalized = "";

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    normalized += PRIVATE_USE_GLYPH_MAP[char] || char;
  }

  return normalized;
}

/**
 * 处理像 `\\neq` 这类依赖“叠加”实现的关系符。
 *
 * 微信上的 rich-text 对 overlay 结构支持不稳定，
 * 所以这里在识别出典型复合关系符后，直接收口成一个稳定字符。
 */
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

/**
 * 收集一个节点子树里的归一化文本，用于辅助判断复合关系符等特殊场景。
 */
function collectNormalizedText(node: KatexTreeNode): string {
  if (typeof node.text === "string") {
    return normalizeMathGlyphs(node.text || "");
  }

  return (node.children || [])
    .map((child) => collectNormalizedText(child))
    .join("");
}

/**
 * SVG 节点序列化。
 *
 * 大多数 KaTeX SVG 可以直接转 `<svg><path/></svg>`，
 * 但某些结构在微信里不稳定，比如：
 * - 绝对值的竖线 delimiter
 * - 根号路径
 *
 * 这些特殊情况会先走专用 fallback。
 */
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

/**
 * 竖线 delimiter 的稳定 fallback。
 * 主要服务绝对值、范数、大括号旁的竖线等结构。
 */
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

/**
 * 根号的稳定 fallback。
 *
 * 原因：
 * - 某些 KaTeX 根号 SVG 在微信 rich-text 中会消失、错位或比例异常。
 *
 * 处理方式：
 * - 用一个可控的根号字形 + 一条手工 overline 组合出更稳定的显示结果。
 * - 高度、字号和横线位置都参考原始 SVG 尺寸做估算。
 */
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

/**
 * 解析形如 `1.2em` 的尺寸值，失败时返回 fallback。
 */
function parseEmSize(value: string, fallback: number): number {
  const match = String(value).match(/^([0-9.]+)em$/);

  if (!match) {
    return fallback;
  }

  const parsed = Number(match[1]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/**
 * 根据 KaTeX class 和当前上下文，推导节点应该带上的内联样式。
 *
 * 这里是把浏览器 DOM 语义压缩到小程序 rich-text 能承受的关键一步：
 * - 既要尽量还原 KaTeX 排版结构；
 * - 又要避免微信环境里不稳定的默认布局行为。
 */
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

/**
 * 以下是一组“样式与属性拼装工具函数”。
 * 它们没有业务含义，主要负责把 style/object 安全地转成 HTML 属性字符串。
 */
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
