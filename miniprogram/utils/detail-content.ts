/**
 * 详情数据适配层。
 *
 * 这个文件的核心任务是把 `data/content/*.js` 中的原始条目数据，
 * 转换成详情页可以直接渲染的统一 view model。
 *
 * 为什么需要这一层：
 * 1. 详情页不应该直接理解多种数据 schema，否则页面文件会充满分支判断。
 * 2. 当前仓库既要兼容旧的 legacy 字段，也要优先支持 `display_version = 2 + sections`
 *    的 structured 数据。
 * 3. 数学公式、混排段落、theorem 列表、变量列表等展示形态，都需要在这里提前整理好。
 *
 * 上游输入：
 * - `data/content/*.js` 中的原始 record。
 *
 * 下游输出：
 * - `DetailDocumentView`
 * - `DetailSectionView`
 * - `DetailBlockView`
 *
 * 推荐阅读顺序：
 * 1. `getDetailDocument`
 * 2. `buildDetailViewModel`
 * 3. `buildSections`
 * 4. `buildStructuredSections`
 * 5. `parseStatementContent`（legacy 兜底）
 */
import {
  renderMath,
  renderMixedTextHtml,
  renderPlainTextHtml,
} from "./math-render";
import { DETAIL_API_CONFIG } from "../config/api";
import type {
  CanonicalConclusionDetail,
  CanonicalDetailBlock,
  CanonicalDetailPlain,
  CanonicalDetailSection,
  CanonicalDetailToken,
  CanonicalTheoremItem,
} from "../types/detail";
import { fetchConclusionDetail } from "./detail-api";

/**
 * 以下 Raw* 类型描述的是“构建脚本输出的数据形态”。
 * 这些类型并不直接用于页面渲染，而是作为适配层的输入。
 */
type RawStructuredSegment = {
  type?: "text" | "math";
  text?: string;
  latex?: string;
};

type RawStructuredItem = {
  title?: string;
  desc?: string;
  text?: string;
  latex?: string;
  segments?: RawStructuredSegment[];
};

type RawStructuredSection = {
  key?: string;
  title?: string;
  layout?: "text" | "list" | "theorem-list";
  text?: string;
  items?: Array<string | RawStructuredItem>;
};

type RawDetailVariable =
  | string
  | {
      latex?: string;
      name?: string;
      description?: string;
      segments?: RawStructuredSegment[];
    };

type RawUsage = {
  scenarios?: string[];
  problem_types?: string[];
  exam_frequency?: number;
  exam_score?: number;
};

type RawAssets = {
  svg?: string;
  png?: string;
  mp4?: string;
  pdf?: string;
  geogebra?: string;
  [key: string]: string | undefined;
};

type RawRelations = {
  prerequisites?: string[];
  related_ids?: string[];
  similar?: string;
};

type RawDetailEntry = {
  id?: string;
  title?: string;
  display_version?: number;
  module?: string;
  alias?: string[];
  difficulty?: number;
  category?: string;
  tags?: string[];
  core_summary?: string;
  core_formula?: string;
  related_formulas?: string[];
  variables?: RawDetailVariable[];
  conditions?: string | string[];
  conclusions?: string | string[];
  usage?: RawUsage;
  interactive?: Record<string, unknown>;
  assets?: RawAssets;
  shareConfig?: Record<string, unknown>;
  relations?: RawRelations;
  isPro?: number;
  remarks?: string;
  knowledgeNode?: string;
  altNodes?: string[] | string;
  statement?: string;
  explanation?: string;
  proof?: string;
  examples?: string;
  traps?: string;
  summary?: string;
  coreSummary?: string;
  coreFormula?: string;
  pdfUrl?: string;
  pdfPath?: string;
  statementLatex?: string;
  statement_latex?: string;
  sections?: RawStructuredSection[];
};

type RawDetailMap = Record<string, RawDetailEntry>;

/**
 * 以下 Detail*View 类型是“页面渲染层的统一输出结构”。
 * 页面和组件只需要理解这些结构，不需要再关心原始 record 的字段差异。
 */
export interface DetailInlineSegmentView {
  id: string;
  kind: "text" | "math";
  html: string;
}

export interface DetailBlockView {
  id: string;
  kind: "text" | "bullet" | "formula" | "theorem" | "mixed";
  formulaAlign?: "center" | "left";
  title?: string;
  titleHtml?: string;
  desc?: string;
  descHtml?: string;
  text?: string;
  html?: string;
  segments?: DetailInlineSegmentView[];
  formulaText?: string;
  formulaHtml?: string;
}

export interface DetailSectionView {
  key: string;
  title: string;
  layout: "text" | "list" | "theorem-list" | "legacy";
  blocks: DetailBlockView[];
}

export interface DetailLegacyPlainView {
  statement: string;
  explanation: string;
  proof: string;
  examples: string;
  traps: string;
  summary: string;
}

export interface DetailDocumentView {
  id: string;
  title: string;
  category: string;
  summary: string;
  summaryHtml: string;
  coreFormula: string;
  coreFormulaHtml: string;
  pdfUrl: string;
  hasPdf: boolean;
  sections: DetailSectionView[];
  sourceType: "structured" | "legacy" | "meta" | "api";
  legacyPlain?: DetailLegacyPlainView;
}

let detailContentCache: RawDetailMap | null = null;

/**
 * 详情页对外的统一入口。
 *
 * 输入：
 * - `id`：详情页路由参数里的条目 id。
 *
 * 输出：
 * - 一个可直接供详情页页面层消费的 `DetailDocumentView`。
 *
 * 主要职责：
 * 1. 从缓存中找到原始 record。
 * 2. 将 record 适配为统一 view model。
 * 3. 推导标题、摘要、核心公式、PDF 地址和来源类型。
 */
export function getDetailDocument(id: string): DetailDocumentView | null {
  if (!id) {
    return null;
  }

  const rawEntry = getRawDetailEntry(id);
  if (!rawEntry) {
    return null;
  }

  const viewModel = buildDetailViewModel(rawEntry, id);
  const coreFormula = getPreferredFormula(rawEntry, viewModel.sections);
  const coreFormulaHtml = coreFormula ? renderMath(coreFormula, true).html : "";

  return {
    id: viewModel.id,
    title: getPreferredTitle(rawEntry, id),
    category: getPreferredCategory(rawEntry),
    summary: viewModel.summary,
    summaryHtml: viewModel.summaryHtml,
    coreFormula,
    coreFormulaHtml,
    pdfUrl: viewModel.pdfUrl,
    hasPdf: viewModel.pdfUrl.length > 0,
    sections: viewModel.sections,
    sourceType: viewModel.sourceType,
  };
}

/**
 * 详情统一入口（双模式）：
 * 1. 远程模式：优先请求 canonical v2；
 * 2. 本地模式：直接走历史 detail bundle；
 * 3. 远程失败：按配置回退本地，保障线上可用性。
 */
export async function getDetailDocumentById(id: string): Promise<DetailDocumentView | null> {
  const normalizedId = normalizeText(id);

  if (!normalizedId) {
    return null;
  }

  if (!DETAIL_API_CONFIG.USE_REMOTE_API) {
    return getDetailDocument(normalizedId);
  }

  try {
    const remoteDetail = await fetchConclusionDetail(normalizedId);
    return buildCanonicalDetailDocument(remoteDetail, normalizedId);
  } catch (error) {
    if (!DETAIL_API_CONFIG.ENABLE_LOCAL_FALLBACK) {
      throw error;
    }

    const localDetail = getDetailDocument(normalizedId);
    if (localDetail) {
      return localDetail;
    }

    throw error;
  }
}

/**
 * 将 canonical v2 详情适配为当前 detail 页面可直接消费的统一模型。
 * 重点是桥接 sections，尽量复用现有渲染与手势能力，不改页面协议。
 */
function buildCanonicalDetailDocument(
  detail: CanonicalConclusionDetail,
  fallbackId: string,
): DetailDocumentView {
  const resolvedId = normalizeText(detail.id) || fallbackId;
  const sections = buildCanonicalSections(detail);
  const summary = getCanonicalSummary(detail, sections);
  const coreFormula =
    normalizeText(detail.content?.primary_formula)
    || getFirstFormulaFromSections(sections);
  const coreFormulaHtml = coreFormula ? renderMath(coreFormula, true).html : "";
  const pdfUrl = normalizeCanonicalPdfUrl(detail);

  return {
    id: resolvedId,
    title: normalizeText(detail.meta?.title) || resolvedId,
    category:
      normalizeText(detail.meta?.category)
      || getModuleLabel(detail.identity?.module),
    summary,
    summaryHtml: renderMixedTextHtml(summary),
    coreFormula,
    coreFormulaHtml,
    pdfUrl,
    hasPdf: pdfUrl.length > 0,
    sections,
    sourceType: "api",
    legacyPlain: normalizeCanonicalPlainFields(detail.content?.plain, sections, summary),
  };
}

function buildCanonicalSections(detail: CanonicalConclusionDetail): DetailSectionView[] {
  const rawSections = normalizeCanonicalSections(detail.content?.sections);
  const mappedSections: DetailSectionView[] = [];

  for (let index = 0; index < rawSections.length; index += 1) {
    const section = buildCanonicalSection(rawSections[index], index);
    if (section) {
      mappedSections.push(section);
    }
  }

  if (mappedSections.length > 0) {
    return mappedSections;
  }

  return buildCanonicalFallbackSections(detail);
}

function buildCanonicalSection(
  section: CanonicalDetailSection,
  sectionIndex: number,
): DetailSectionView | null {
  const key = normalizeText(section.key) || `section-${sectionIndex + 1}`;
  const blocks = buildCanonicalSectionBlocks(key, normalizeCanonicalBlocks(section.blocks));

  if (blocks.length === 0) {
    return null;
  }

  return {
    key,
    title: resolveCanonicalSectionTitle(section, sectionIndex),
    layout: resolveCanonicalSectionLayout(section, key, blocks),
    blocks,
  };
}

function buildCanonicalSectionBlocks(
  sectionKey: string,
  blocks: CanonicalDetailBlock[],
): DetailBlockView[] {
  const result: DetailBlockView[] = [];

  for (let index = 0; index < blocks.length; index += 1) {
    const block = buildCanonicalBlock(sectionKey, blocks[index], index);
    if (!block) {
      continue;
    }

    if (Array.isArray(block)) {
      result.push(...block);
      continue;
    }

    result.push(block);
  }

  return result;
}

function buildCanonicalBlock(
  sectionKey: string,
  block: CanonicalDetailBlock,
  blockIndex: number,
): DetailBlockView | DetailBlockView[] | null {
  const blockType = normalizeUnknownText((block as { type?: unknown }).type);

  if (blockType === "paragraph") {
    return buildCanonicalParagraphBlock(
      sectionKey,
      block as CanonicalDetailBlock & { tokens?: CanonicalDetailToken[]; text?: string },
      blockIndex,
    );
  }

  if (blockType === "math_block") {
    return buildCanonicalMathBlock(
      sectionKey,
      block as CanonicalDetailBlock & { latex?: string; align?: string },
      blockIndex,
    );
  }

  if (blockType === "theorem_group") {
    return buildCanonicalTheoremBlocks(
      sectionKey,
      block as CanonicalDetailBlock & { items?: CanonicalTheoremItem[] },
      blockIndex,
    );
  }

  const fallbackTokens = normalizeCanonicalTokens(
    (block as { tokens?: unknown }).tokens,
  );
  if (fallbackTokens.length > 0) {
    return buildCanonicalParagraphBlock(
      sectionKey,
      {
        ...block,
        tokens: fallbackTokens,
      },
      blockIndex,
    );
  }

  const fallbackLatex = normalizeUnknownText((block as { latex?: unknown }).latex);
  if (fallbackLatex) {
    return buildCanonicalMathBlock(
      sectionKey,
      {
        ...block,
        latex: fallbackLatex,
      },
      blockIndex,
    );
  }

  const fallbackText =
    normalizeUnknownText((block as { text?: unknown }).text)
    || normalizeUnknownText((block as { title?: unknown }).title);
  if (!fallbackText) {
    return null;
  }

  return createCanonicalTextBlock(
    sectionKey,
    resolveCanonicalBlockId(sectionKey, block, blockIndex, "text"),
    fallbackText,
  );
}

function buildCanonicalParagraphBlock(
  sectionKey: string,
  block: CanonicalDetailBlock & { tokens?: CanonicalDetailToken[]; text?: string },
  blockIndex: number,
): DetailBlockView | null {
  const blockId = resolveCanonicalBlockId(sectionKey, block, blockIndex, "paragraph");
  const tokens = normalizeCanonicalTokens(block.tokens);

  if (tokens.length === 0) {
    const fallbackText = normalizeUnknownText(block.text);
    if (!fallbackText) {
      return null;
    }

    return createCanonicalTextBlock(sectionKey, blockId, fallbackText);
  }

  if (tokens.length === 1 && tokens[0].type === "math_inline" && !isCanonicalBulletSection(sectionKey)) {
    return createStructuredFormulaBlock(blockId, normalizeUnknownText(tokens[0].latex));
  }

  const segments = buildCanonicalInlineSegments(tokens, blockId);
  if (segments.length === 0) {
    const fallbackText = composeCanonicalTokenPlainText(tokens);
    return fallbackText ? createCanonicalTextBlock(sectionKey, blockId, fallbackText) : null;
  }

  const allPlainText = segments.every((segment) => segment.kind === "text");
  if (allPlainText) {
    const text = composeCanonicalTokenPlainText(tokens);
    if (text) {
      return createCanonicalTextBlock(sectionKey, blockId, text);
    }
  }

  const html = composeInlineSegmentHtml(segments);

  if (isCanonicalBulletSection(sectionKey)) {
    return {
      id: blockId,
      kind: "bullet",
      html,
      segments,
    };
  }

  return {
    id: blockId,
    kind: "mixed",
    html,
    segments,
  };
}

function buildCanonicalMathBlock(
  sectionKey: string,
  block: CanonicalDetailBlock & { latex?: string; align?: string },
  blockIndex: number,
): DetailBlockView | null {
  const latex = normalizeUnknownText(block.latex);
  if (!latex) {
    return null;
  }

  const blockId = resolveCanonicalBlockId(sectionKey, block, blockIndex, "math");

  if (isCanonicalBulletSection(sectionKey)) {
    const inlineHtml = renderMath(latex, false).html;
    return {
      id: blockId,
      kind: "bullet",
      html: inlineHtml,
      segments: [
        {
          id: `${blockId}-math`,
          kind: "math",
          html: inlineHtml,
        },
      ],
    };
  }

  const formulaAlign = block.align === "left" ? "left" : "center";
  const mathResult = renderMath(latex, true, { align: formulaAlign });

  return {
    id: blockId,
    kind: "formula",
    formulaAlign,
    formulaText: mathResult.source,
    formulaHtml: mathResult.html,
  };
}

function buildCanonicalTheoremBlocks(
  sectionKey: string,
  block: CanonicalDetailBlock & { items?: CanonicalTheoremItem[] },
  blockIndex: number,
): DetailBlockView[] {
  const items = normalizeCanonicalTheoremItems(block.items);
  const baseId = resolveCanonicalBlockId(sectionKey, block, blockIndex, "theorem");
  const result: DetailBlockView[] = [];

  for (let index = 0; index < items.length; index += 1) {
    const theoremBlock = buildCanonicalTheoremBlock(items[index], `${baseId}-${index + 1}`);
    if (theoremBlock) {
      result.push(theoremBlock);
    }
  }

  return result;
}

function buildCanonicalTheoremBlock(
  item: CanonicalTheoremItem,
  blockId: string,
): DetailBlockView | null {
  const title = normalizeUnknownText(item.title);
  const descTokens = normalizeCanonicalTokens(item.desc_tokens);
  const descText = descTokens.length > 0
    ? composeCanonicalTokenPlainText(descTokens)
    : normalizeUnknownText(item.desc);
  const descSegments = descTokens.length > 0
    ? buildCanonicalInlineSegments(descTokens, `${blockId}-desc`)
    : [];
  const descHtml = descSegments.length > 0
    ? composeInlineSegmentHtml(descSegments)
    : renderMixedTextHtml(descText);
  const latex =
    normalizeUnknownText(item.formula_latex)
    || normalizeUnknownText(item.latex);
  const mathResult = latex ? renderMath(latex, true) : null;

  if (!title && !descText && !mathResult) {
    return null;
  }

  return {
    id: blockId,
    kind: "theorem",
    title,
    titleHtml: title ? renderPlainTextHtml(title) : "",
    desc: descText,
    descHtml,
    formulaText: mathResult?.source || "",
    formulaHtml: mathResult?.html || "",
  };
}

function buildCanonicalInlineSegments(
  tokens: CanonicalDetailToken[],
  blockId: string,
): DetailInlineSegmentView[] {
  const rawSegments: RawStructuredSegment[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (token.type === "math_inline") {
      const latex = normalizeUnknownText(token.latex);
      if (!latex) {
        continue;
      }

      rawSegments.push({
        type: "math",
        latex,
      });
      continue;
    }

    const text = normalizeUnknownText(token.text);
    if (text) {
      rawSegments.push({
        type: "text",
        text,
      });
      continue;
    }

    const fallbackLatex = normalizeUnknownText(token.latex);
    if (fallbackLatex) {
      rawSegments.push({
        type: "math",
        latex: fallbackLatex,
      });
    }
  }

  return buildStructuredSegments(rawSegments, blockId);
}

function createCanonicalTextBlock(
  sectionKey: string,
  blockId: string,
  text: string,
): DetailBlockView {
  if (isCanonicalBulletSection(sectionKey)) {
    return {
      id: blockId,
      kind: "bullet",
      text,
      html: renderMixedTextHtml(text),
    };
  }

  return {
    id: blockId,
    kind: "text",
    text,
    html: renderMixedTextHtml(text),
  };
}

function buildCanonicalFallbackSections(detail: CanonicalConclusionDetail): DetailSectionView[] {
  const plain = detail.content?.plain;
  const conditions = buildCanonicalConditionList(detail.content?.conditions);
  const conclusions = buildCanonicalConditionList(detail.content?.conclusions);
  const relatedFormulas = Array.isArray(detail.ext?.extra?.related_formulas)
    ? detail.ext?.extra?.related_formulas
    : [];
  const usage = detail.ext?.extra?.usage as RawUsage | undefined;
  const relations = detail.ext?.relations as RawRelations | undefined;

  const sections: DetailSectionView[] = [];
  pushSection(
    sections,
    buildVariableSection(detail.content?.variables as RawDetailVariable[] | undefined),
  );
  pushSection(sections, createLooseSection("conditions", "适用条件", conditions));
  pushSection(sections, createLooseSection("conclusions", "核心结论", conclusions));
  pushSection(sections, buildRelatedFormulaSection(relatedFormulas));
  pushSection(
    sections,
    createLooseSection("statement", "命题表述", normalizeUnknownText(plain?.statement)),
  );
  pushSection(
    sections,
    createLooseSection("explanation", "讲解", normalizeUnknownText(plain?.explanation)),
  );
  pushSection(
    sections,
    createLooseSection("proof", "证明", normalizeUnknownText(plain?.proof)),
  );
  pushSection(
    sections,
    createLooseSection("examples", "例题", normalizeUnknownText(plain?.examples)),
  );
  pushSection(
    sections,
    createLooseSection("traps", "易错点", normalizeUnknownText(plain?.traps)),
  );
  pushSection(
    sections,
    createLooseSection("summary", "总结", normalizeUnknownText(plain?.summary)),
  );
  pushSection(sections, buildUsageSection(usage));
  pushSection(sections, buildRelationsSection(relations));

  return decorateLegacySections(sections);
}

function buildCanonicalConditionList(rawItems: unknown): string[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  const result: string[] = [];

  for (let index = 0; index < rawItems.length; index += 1) {
    const item = rawItems[index] as {
      title?: unknown;
      content?: unknown;
    };
    const title = normalizeUnknownText(item.title);
    const contentText = composeCanonicalTokenPlainText(
      normalizeCanonicalTokens(item.content),
    );
    const line = title && contentText ? `${title}：${contentText}` : (title || contentText);

    if (line) {
      result.push(line);
    }
  }

  return result;
}

function normalizeCanonicalPlainFields(
  plain: CanonicalDetailPlain | undefined,
  sections: DetailSectionView[],
  summary: string,
): DetailLegacyPlainView {
  const normalized: DetailLegacyPlainView = {
    statement: normalizeUnknownText(plain?.statement),
    explanation: normalizeUnknownText(plain?.explanation),
    proof: normalizeUnknownText(plain?.proof),
    examples: normalizeUnknownText(plain?.examples),
    traps: normalizeUnknownText(plain?.traps),
    summary: normalizeUnknownText(plain?.summary),
  };

  const derived = deriveLegacyPlainFromSections(sections);
  if (!normalized.statement) {
    normalized.statement = derived.statement;
  }
  if (!normalized.explanation) {
    normalized.explanation = derived.explanation;
  }
  if (!normalized.proof) {
    normalized.proof = derived.proof;
  }
  if (!normalized.examples) {
    normalized.examples = derived.examples;
  }
  if (!normalized.traps) {
    normalized.traps = derived.traps;
  }
  if (!normalized.summary) {
    normalized.summary = derived.summary || summary;
  }

  return normalized;
}

function deriveLegacyPlainFromSections(sections: DetailSectionView[]): DetailLegacyPlainView {
  return {
    statement: getSectionPlainTextByKey(sections, "statement"),
    explanation: getSectionPlainTextByKey(sections, "explanation"),
    proof: getSectionPlainTextByKey(sections, "proof"),
    examples: getSectionPlainTextByKey(sections, "examples"),
    traps: getSectionPlainTextByKey(sections, "traps"),
    summary: getSectionPlainTextByKey(sections, "summary"),
  };
}

function getSectionPlainTextByKey(
  sections: DetailSectionView[],
  key: string,
): string {
  for (let index = 0; index < sections.length; index += 1) {
    if (sections[index].key !== key) {
      continue;
    }

    return extractSectionPlainText(sections[index]);
  }

  return "";
}

function extractSectionPlainText(section: DetailSectionView): string {
  return section.blocks
    .map((block) => extractBlockPlainText(block))
    .filter((text) => text.length > 0)
    .join("\n");
}

function extractBlockPlainText(block: DetailBlockView): string {
  if (block.kind === "text" || block.kind === "bullet") {
    return normalizeText(block.text) || stripHtmlTags(block.html);
  }

  if (block.kind === "mixed") {
    if (Array.isArray(block.segments) && block.segments.length > 0) {
      return block.segments
        .map((segment) => stripHtmlTags(segment.html))
        .filter((text) => text.length > 0)
        .join("");
    }

    return stripHtmlTags(block.html);
  }

  if (block.kind === "formula") {
    return normalizeText(block.formulaText) || stripHtmlTags(block.formulaHtml);
  }

  if (block.kind === "theorem") {
    const parts = [
      normalizeText(block.title),
      normalizeText(block.desc),
      normalizeText(block.formulaText),
    ].filter((part) => part.length > 0);

    return parts.join("\n");
  }

  return "";
}

function stripHtmlTags(html?: string): string {
  if (!html) {
    return "";
  }

  return html
    .replace(/<[^>]*>/g, " ")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"")
    .replace(/\s+/g, " ")
    .trim();
}

function getCanonicalSummary(
  detail: CanonicalConclusionDetail,
  sections: DetailSectionView[],
): string {
  return (
    normalizeText(detail.meta?.summary)
    || normalizeUnknownText(detail.content?.plain?.summary)
    || getSectionPlainTextByKey(sections, "summary")
  );
}

function normalizeCanonicalPdfUrl(detail: CanonicalConclusionDetail): string {
  return (
    normalizeUnknownText(detail.pdf_url)
    || normalizeUnknownText(detail.assets?.pdf)
  );
}

function resolveCanonicalSectionTitle(
  section: CanonicalDetailSection,
  sectionIndex: number,
): string {
  const title = normalizeText(section.title);
  if (title) {
    return title;
  }

  const key = normalizeText(section.key);
  if (key) {
    return key;
  }

  return `正文 ${sectionIndex + 1}`;
}

function resolveCanonicalSectionLayout(
  section: CanonicalDetailSection,
  sectionKey: string,
  blocks: DetailBlockView[],
): DetailSectionView["layout"] {
  const blockType = normalizeText(section.block_type);

  if (blockType === "theorem_group" || blocks.some((block) => block.kind === "theorem")) {
    return "theorem-list";
  }

  if (isCanonicalBulletSection(sectionKey)) {
    return "list";
  }

  return "text";
}

function isCanonicalBulletSection(sectionKey: string): boolean {
  return (
    sectionKey === "variables"
    || sectionKey === "conditions"
    || sectionKey === "conclusions"
  );
}

function composeCanonicalTokenPlainText(tokens: CanonicalDetailToken[]): string {
  return tokens
    .map((token) => {
      if (token.type === "math_inline") {
        return normalizeUnknownText(token.latex);
      }

      return (
        normalizeUnknownText(token.text)
        || normalizeUnknownText(token.latex)
      );
    })
    .filter((value) => value.length > 0)
    .join("")
    .trim();
}

function normalizeCanonicalSections(rawSections: unknown): CanonicalDetailSection[] {
  if (!Array.isArray(rawSections)) {
    return [];
  }

  return rawSections
    .filter(
      (item): item is CanonicalDetailSection =>
        !!item
        && typeof item === "object"
        && !Array.isArray(item),
    );
}

function normalizeCanonicalBlocks(rawBlocks: unknown): CanonicalDetailBlock[] {
  if (!Array.isArray(rawBlocks)) {
    return [];
  }

  return rawBlocks
    .filter(
      (item): item is CanonicalDetailBlock =>
        !!item
        && typeof item === "object"
        && !Array.isArray(item),
    );
}

function normalizeCanonicalTokens(rawTokens: unknown): CanonicalDetailToken[] {
  if (!Array.isArray(rawTokens)) {
    return [];
  }

  const result: CanonicalDetailToken[] = [];

  for (let index = 0; index < rawTokens.length; index += 1) {
    const token = rawTokens[index];

    if (typeof token === "string") {
      result.push({
        type: "text",
        text: token,
      });
      continue;
    }

    if (token && typeof token === "object" && !Array.isArray(token)) {
      result.push(token as CanonicalDetailToken);
    }
  }

  return result;
}

function normalizeCanonicalTheoremItems(rawItems: unknown): CanonicalTheoremItem[] {
  if (!Array.isArray(rawItems)) {
    return [];
  }

  return rawItems
    .filter(
      (item): item is CanonicalTheoremItem =>
        !!item
        && typeof item === "object"
        && !Array.isArray(item),
    );
}

function resolveCanonicalBlockId(
  sectionKey: string,
  block: CanonicalDetailBlock,
  blockIndex: number,
  suffix: string,
): string {
  const rawBlockId = normalizeUnknownText((block as { id?: unknown }).id);

  if (rawBlockId) {
    return rawBlockId;
  }

  return `${sectionKey}-${suffix}-${blockIndex + 1}`;
}

function normalizeUnknownText(value: unknown): string {
  return typeof value === "string" ? normalizeText(value) : "";
}

/**
 * 按 id 读取原始详情条目，并在首次访问时建立缓存。
 *
 * 这样做的原因是详情数据是本地静态模块，适合在运行时只加载一次，
 * 避免每次进入详情页都重复扫描整个内容文件。
 */
function getRawDetailEntry(id: string): RawDetailEntry | null {
  if (!detailContentCache) {
    try {
      detailContentCache = buildDetailContentCache();
    } catch (error) {
      console.error("Load detail content failed", error);
      detailContentCache = {};
    }
  }

  return detailContentCache[id] || null;
}

/**
 * 将单条原始 record 转为页面层需要的核心视图模型。
 *
 * 这里是页面层与数据层之间最重要的一道边界：
 * - 页面只关心“摘要是什么、sections 长什么样、PDF 在哪、来源类型是什么”；
 * - 至于这些值来自 structured 字段、legacy 字段还是兜底推导，都由这里处理。
 */
function buildDetailViewModel(rawEntry: RawDetailEntry, id: string) {
  const summary = getPreferredSummary(rawEntry);
  const sections = buildSections(rawEntry, summary);
  const pdfUrl = getPreferredPdfUrl(id, rawEntry);

  return {
    id: normalizeText(rawEntry.id) || id,
    summary,
    summaryHtml: renderMixedTextHtml(summary),
    pdfUrl,
    sections,
    sourceType: detectSourceType(rawEntry),
  };
}

/**
 * 扫描详情数据模块并建立 `id -> record` 缓存。
 *
 * 这是一个“运行时轻量索引”，目的是让详情页可以通过 id O(1) 命中条目。
 */
function buildDetailContentCache(): RawDetailMap {
  const cache: RawDetailMap = {};
  const modules = loadDetailContentModules();

  modules.forEach((moduleData) => {
    if (!moduleData || typeof moduleData !== "object" || Array.isArray(moduleData)) {
      return;
    }

    Object.entries(moduleData).forEach(([recordId, candidate]) => {
      if (!looksLikeDetailEntry(candidate)) {
        return;
      }

      const entry = candidate as RawDetailEntry;
      const resolvedId = normalizeText(entry.id) || recordId;

      if (!resolvedId || cache[resolvedId]) {
        return;
      }

      cache[resolvedId] = entry;
    });
  });

  return cache;
}

/**
 * 加载当前详情页真正依赖的数据模块。
 *
 * 这里刻意不走共享 registry：
 * - registry 中可能还会顺带引入搜索索引模块；
 * - 详情页运行时只需要详情内容 bundle，不需要搜索侧的附加依赖。
 */
function loadDetailContentModules(): Array<Record<string, unknown>> {
  // The detail page should only hydrate from detail-content bundles.
  // Pulling in the shared registry also loads search indexes, which can
  // reference files that do not exist in the detail-page runtime bundle.
  return [
    require("../data/content/inequality.js") as Record<string, unknown>,
  ];
}

/**
 * 判断一个候选对象是否像“详情 record”。
 * 这是建立缓存时的第一道筛选，避免把无关对象误当成条目数据。
 */
function looksLikeDetailEntry(candidate: unknown): candidate is RawDetailEntry {
  if (!candidate || typeof candidate !== "object" || Array.isArray(candidate)) {
    return false;
  }

  const entry = candidate as RawDetailEntry;

  return Boolean(
    entry.display_version === 2
      || entry.sections
      || entry.statement
      || entry.explanation
      || entry.proof
      || entry.examples
      || entry.traps
      || entry.summary
      || entry.core_formula
      || entry.core_summary,
  );
}

/**
 * 判断当前条目是否拥有 structured v2 sections。
 *
 * 一旦满足这个条件，structured 数据就是详情页的权威渲染来源，
 * 不再退回到 legacy 字段做主渲染。
 */
function hasStructuredSections(
  rawEntry: RawDetailEntry | null | undefined,
): rawEntry is RawDetailEntry & { display_version: 2; sections: RawStructuredSection[] } {
  return Boolean(
    rawEntry?.display_version === 2
      && Array.isArray(rawEntry.sections)
      && rawEntry.sections.length > 0,
  );
}

/**
 * 选择详情 section 的构建路径。
 *
 * 优先级：
 * 1. structured sections（display_version = 2）
 * 2. rich legacy 字段（explanation / proof / examples ...）
 * 3. statement 字段解析
 * 4. 最后才退回到只显示摘要
 *
 * 这样可以最大程度保证：
 * - 新数据走新 renderer；
 * - 老数据不至于丢失；
 * - 页面层始终只消费统一的 `DetailSectionView[]`。
 */
function buildSections(rawEntry: RawDetailEntry, headerSummary: string): DetailSectionView[] {
  // Structured sections are the authoritative render source for display_version=2.
  if (hasStructuredSections(rawEntry)) {
    return buildStructuredSections(rawEntry.sections || []);
  }

  // Older records still fall back to legacy plain-text fields so the page keeps working.
  const richSections = decorateLegacySections(buildRichSections(rawEntry, headerSummary));
  if (richSections.length > 0) {
    return richSections;
  }

  const statementSource = getStatementSource(rawEntry);
  if (statementSource) {
    return decorateLegacySections(parseStatementContent(statementSource));
  }

  if (!headerSummary) {
    return [];
  }

  return [
    {
      key: "overview",
      title: "概览",
      layout: "legacy",
      blocks: [
        {
          id: "overview-text",
          kind: "text",
          text: headerSummary,
        },
      ],
    },
  ];
}

/**
 * legacy 详情字段的主构建链。
 *
 * 这条链主要服务旧格式数据，把多个松散字段拼成一组 section。
 * 与 structured 路径相比，这里更偏“字段拼装 + 后续再装饰”。
 */
function buildRichSections(rawEntry: RawDetailEntry, headerSummary: string): DetailSectionView[] {
  const sections: DetailSectionView[] = [];

  pushSection(sections, buildVariableSection(rawEntry.variables));
  pushSection(sections, createLooseSection("conditions", "适用条件", rawEntry.conditions));
  pushSection(sections, createLooseSection("conclusions", "核心结论", rawEntry.conclusions));
  pushSection(sections, buildRelatedFormulaSection(rawEntry.related_formulas));
  pushSection(sections, createLooseSection("statement", "命题表述", getStatementSource(rawEntry)));
  pushSection(sections, createLooseSection("explanation", "讲解", rawEntry.explanation));
  pushSection(sections, createLooseSection("proof", "证明", rawEntry.proof));
  pushSection(sections, createLooseSection("examples", "例题", rawEntry.examples));
  pushSection(sections, buildUsageSection(rawEntry.usage));
  pushSection(sections, createLooseSection("traps", "易错点", rawEntry.traps));
  pushSection(sections, buildRelationsSection(rawEntry.relations));

  const finalSummary = normalizeText(rawEntry.summary);
  if (finalSummary && finalSummary !== headerSummary) {
    pushSection(sections, createLooseSection("summary", "总结", finalSummary));
  }

  return sections;
}

/**
 * 变量说明 section。
 * 旧数据中的变量通常还是普通文本，因此这里先做文本整理，后续由 legacy 装饰层统一渲染。
 */
function buildVariableSection(variables?: RawDetailVariable[]): DetailSectionView | null {
  if (!Array.isArray(variables) || variables.length === 0) {
    return null;
  }

  const blocks: DetailBlockView[] = [];

  for (let index = 0; index < variables.length; index += 1) {
    const text = formatVariableText(variables[index]);
    if (!text) {
      continue;
    }

    blocks.push({
      id: `variable-${index + 1}`,
      kind: "bullet",
      text,
    });
  }

  if (blocks.length === 0) {
    return null;
  }

  return {
    key: "variables",
    title: "变量说明",
    layout: "legacy",
    blocks,
  };
}

/**
 * 相关公式 section。
 * 这里的每一项都直接作为独立 display formula 渲染。
 */
function buildRelatedFormulaSection(relatedFormulas?: string[]): DetailSectionView | null {
  if (!Array.isArray(relatedFormulas) || relatedFormulas.length === 0) {
    return null;
  }

  const blocks: DetailBlockView[] = [];

  for (let index = 0; index < relatedFormulas.length; index += 1) {
    const formula = normalizeText(relatedFormulas[index]);
    if (!formula) {
      continue;
    }

    const mathResult = renderMath(formula, true);
    blocks.push({
      id: `related-formula-${index + 1}`,
      kind: "formula",
      formulaText: mathResult.source,
      formulaHtml: mathResult.html,
    });
  }

  if (blocks.length === 0) {
    return null;
  }

  return {
    key: "related-formulas",
    title: "相关公式",
    layout: "legacy",
    blocks,
  };
}

/**
 * 使用场景 section。
 * 主要把 usage 里的场景、题型、频率和分值拆成页面可消费的 block 列表。
 */
function buildUsageSection(usage?: RawUsage): DetailSectionView | null {
  if (!usage) {
    return null;
  }

  const blocks: DetailBlockView[] = [];
  const scenarios = toNormalizedList(usage.scenarios);
  const problemTypes = toNormalizedList(usage.problem_types);

  if (scenarios.length > 0) {
    blocks.push({
      id: "usage-scenarios-head",
      kind: "text",
      text: "适用场景",
    });

    scenarios.forEach((item, index) => {
      blocks.push({
        id: `usage-scenario-${index + 1}`,
        kind: "bullet",
        text: item,
      });
    });
  }

  if (problemTypes.length > 0) {
    blocks.push({
      id: "usage-problem-types-head",
      kind: "text",
      text: "常见题型",
    });

    problemTypes.forEach((item, index) => {
      blocks.push({
        id: `usage-problem-type-${index + 1}`,
        kind: "bullet",
        text: item,
      });
    });
  }

  if (typeof usage.exam_frequency === "number") {
    blocks.push({
      id: "usage-exam-frequency",
      kind: "bullet",
      text: `考查频率：${Math.round(usage.exam_frequency * 100)}%`,
    });
  }

  if (typeof usage.exam_score === "number") {
    blocks.push({
      id: "usage-exam-score",
      kind: "bullet",
      text: `常见分值：${Math.round(usage.exam_score)} 分`,
    });
  }

  if (blocks.length === 0) {
    return null;
  }

  return {
    key: "usage",
    title: "使用场景",
    layout: "legacy",
    blocks,
  };
}

/**
 * 关联知识 section。
 * 用于承接 prerequisites / related_ids / similar 这类附加说明。
 */
function buildRelationsSection(relations?: RawRelations): DetailSectionView | null {
  if (!relations) {
    return null;
  }

  const blocks: DetailBlockView[] = [];
  const prerequisites = toNormalizedList(relations.prerequisites);
  const relatedIds = toNormalizedList(relations.related_ids);
  const similar = normalizeText(relations.similar);

  if (prerequisites.length > 0) {
    blocks.push({
      id: "relations-prerequisites-head",
      kind: "text",
      text: "前置知识",
    });

    prerequisites.forEach((item, index) => {
      blocks.push({
        id: `relations-prerequisite-${index + 1}`,
        kind: "bullet",
        text: item,
      });
    });
  }

  if (relatedIds.length > 0) {
    blocks.push({
      id: "relations-ids",
      kind: "bullet",
      text: `相关条目：${relatedIds.join(" / ")}`,
    });
  }

  if (similar) {
    blocks.push({
      id: "relations-similar-head",
      kind: "text",
      text: "延伸关联",
    });
    blocks.push({
      id: "relations-similar",
      kind: "text",
      text: similar,
    });
  }

  if (blocks.length === 0) {
    return null;
  }

  return {
    key: "relations",
    title: "关联知识",
    layout: "legacy",
    blocks,
  };
}

/**
 * 由一个松散文本字段创建 legacy section。
 *
 * 输入可以是单个字符串，也可以是字符串数组；
 * 最终都会先归一化成一段文本，再拆成 text / bullet / formula blocks。
 */
function createLooseSection(
  key: string,
  title: string,
  value?: string | string[],
): DetailSectionView | null {
  const normalizedText = normalizeRichText(value);
  if (!normalizedText) {
    return null;
  }

  const blocks = parseLooseContentBlocks(normalizedText, key);
  if (blocks.length === 0) {
    return null;
  }

  return {
    key,
    title,
    layout: "legacy",
    blocks,
  };
}

/**
 * 解析 legacy 文本块。
 *
 * 处理策略：
 * - 以行为单位扫描；
 * - 识别 bullet；
 * - 识别整行公式；
 * - 其余内容按段落累计。
 *
 * 这条链本质上是在“旧数据只能给一大段文本”的前提下，
 * 尽量推断出详情页还能接受的结构。
 */
function parseLooseContentBlocks(text: string, key: string): DetailBlockView[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
  const blocks: DetailBlockView[] = [];
  const paragraphBuffer: string[] = [];

  const flushParagraph = () => {
    if (paragraphBuffer.length === 0) {
      return;
    }

    blocks.push({
      id: `${key}-text-${blocks.length + 1}`,
      kind: "text",
      text: paragraphBuffer.join("\n"),
    });
    paragraphBuffer.length = 0;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];

    if (/^[-•]/.test(line)) {
      flushParagraph();
      blocks.push({
        id: `${key}-bullet-${blocks.length + 1}`,
        kind: "bullet",
        text: line.replace(/^[-•]\s*/, "").trim(),
      });
      continue;
    }

    if (looksLikeFormula(line)) {
      flushParagraph();
      const mathResult = renderMath(line, true);
      blocks.push({
        id: `${key}-formula-${blocks.length + 1}`,
        kind: "formula",
        formulaText: mathResult.source,
        formulaHtml: mathResult.html,
      });
      continue;
    }

    paragraphBuffer.push(line);
  }

  flushParagraph();
  return blocks;
}

/**
 * structured v2 sections 的主构建链。
 *
 * 这是当前详情页最推荐的数据路径：
 * - section 的层级由数据显式给出；
 * - item 的类型由数据显式给出；
 * - 适配层只需要把这些结构稳定映射为 view blocks。
 */
function buildStructuredSections(sections: RawStructuredSection[]): DetailSectionView[] {
  const result: DetailSectionView[] = [];

  for (let index = 0; index < sections.length; index += 1) {
    const section = sections[index];
    const title = normalizeText(section.title);
    if (!title) {
      continue;
    }

    const viewSection: DetailSectionView = {
      key: normalizeText(section.key) || `section-${index + 1}`,
      title,
      layout: section.layout || "text",
      blocks: [],
    };

    const normalizedText = normalizeText(section.text);
    if (normalizedText) {
      viewSection.blocks.push({
        id: `${viewSection.key}-text`,
        kind: "text",
        text: normalizedText,
        html: renderPlainTextHtml(normalizedText),
      });
    }

    const items = section.items || [];

    for (let itemIndex = 0; itemIndex < items.length; itemIndex += 1) {
      const rawItem = items[itemIndex];
      const blocks = buildStructuredBlocks(viewSection, rawItem, itemIndex);

      if (!blocks) {
        continue;
      }

      if (Array.isArray(blocks)) {
        viewSection.blocks.push(...blocks);
        continue;
      }

      viewSection.blocks.push(blocks);
    }

    if (viewSection.blocks.length > 0) {
      result.push(viewSection);
    }
  }

  return result;
}

/**
 * 将单个 structured item 转成一个或多个 block。
 *
 * 一个 item 之所以可能对应多个 block，
 * 是因为 `segments` 里可能混有需要被提升成独立 display formula 的数学段。
 */
function buildStructuredBlocks(
  section: DetailSectionView,
  rawItem: string | RawStructuredItem,
  itemIndex: number,
): DetailBlockView | DetailBlockView[] | null {
  const blockId = `${section.key}-${itemIndex + 1}`;

  if (typeof rawItem === "string") {
    const normalizedItem = normalizeText(rawItem);

    if (!normalizedItem) {
      return null;
    }

    return createStructuredTextBlock(section, blockId, normalizedItem);
  }

  if (section.layout === "theorem-list" || rawItem.title || rawItem.desc) {
    return createStructuredTheoremBlock(section, blockId, rawItem);
  }

  if (Array.isArray(rawItem.segments) && rawItem.segments.length > 0) {
    return createStructuredSegmentBlocks(section, blockId, rawItem.segments);
  }

  if (normalizeText(rawItem.latex)) {
    return createStructuredLatexBlock(section, blockId, normalizeText(rawItem.latex));
  }

  if (normalizeText(rawItem.text)) {
    return createStructuredTextBlock(section, blockId, normalizeText(rawItem.text));
  }

  return null;
}

/**
 * structured 普通文本 block。
 * list / variables 场景会转成 bullet，其余场景保留为普通正文段。
 */
function createStructuredTextBlock(
  section: DetailSectionView,
  blockId: string,
  text: string,
): DetailBlockView {
  if (section.layout === "list" || section.key === "variables") {
    return {
      id: blockId,
      kind: "bullet",
      text,
      html: renderPlainTextHtml(text),
    };
  }

  return {
    id: blockId,
    kind: "text",
    text,
    html: renderPlainTextHtml(text),
  };
}

/**
 * structured 中的纯 latex item。
 *
 * 规则：
 * - 在 variables / list 这类列表场景下，按行内数学 bullet 处理。
 * - 在普通正文场景下，按独立公式块处理。
 */
function createStructuredLatexBlock(
  section: DetailSectionView,
  blockId: string,
  latex: string,
): DetailBlockView {
  const inlineHtml = renderMath(latex, false).html;

  if (section.key === "variables" || section.layout === "list") {
    return {
      id: blockId,
      kind: "bullet",
      html: inlineHtml,
      segments: [
        {
          id: `${blockId}-math`,
          kind: "math",
          html: inlineHtml,
        },
      ],
    };
  }

  const mathResult = renderMath(latex, true);

  return {
    id: blockId,
    kind: "formula",
    formulaText: mathResult.source,
    formulaHtml: mathResult.html,
  };
}

/**
 * structured mixed segments 的主适配入口。
 *
 * 为什么这里要特别小心：
 * - v2 数据已经明确区分了 text 与 math，适配层不能再把它们拼回纯文本去猜公式；
 * - 同时，对于明显属于 display math 的长公式，还需要从段落里提升成独立公式卡片。
 */
function createStructuredSegmentBlocks(
  section: DetailSectionView,
  blockId: string,
  segments: RawStructuredSegment[],
): DetailBlockView | DetailBlockView[] | null {
  // The builder has already separated plain text and math spans for v2 data.
  // Keeping that boundary here avoids regressing back to legacy formula guessing.
  const normalizedSource = normalizeInlineSegments(segments);

  if (normalizedSource.length === 0) {
    return null;
  }

  if (!normalizedSource.some((segment) => isStructuredDisplayMathSegment(segment))) {
    return createStructuredInlineSegmentBlock(section, blockId, normalizedSource);
  }

  const result: DetailBlockView[] = [];
  let inlineBuffer: RawStructuredSegment[] = [];
  let fragmentIndex = 0;

  const flushInlineBuffer = () => {
    if (inlineBuffer.length === 0) {
      return;
    }

    fragmentIndex += 1;
    const block = createStructuredInlineSegmentBlock(
      section,
      `${blockId}-inline-${fragmentIndex}`,
      inlineBuffer,
    );

    inlineBuffer = [];

    if (block) {
      result.push(block);
    }
  };

  for (let index = 0; index < normalizedSource.length; index += 1) {
    const segment = normalizedSource[index];

    if (isStructuredDisplayMathSegment(segment)) {
      flushInlineBuffer();
      fragmentIndex += 1;
      result.push(
        createStructuredFormulaBlock(
          `${blockId}-formula-${fragmentIndex}`,
          segment.latex || "",
        ),
      );
      continue;
    }

    inlineBuffer.push(segment);
  }

  flushInlineBuffer();

  if (result.length === 0) {
    return null;
  }

  return result;
}

/**
 * 将一个“仍应保持句内混排”的 structured segments item 转成单个 block。
 *
 * 输出：
 * - list / variables 场景：bullet
 * - 其它正文场景：mixed
 */
function createStructuredInlineSegmentBlock(
  section: DetailSectionView,
  blockId: string,
  sourceSegments: RawStructuredSegment[],
): DetailBlockView | null {
  const normalizedSegments = buildStructuredSegments(sourceSegments, blockId);
  const inlineHtml = composeInlineSegmentHtml(normalizedSegments);

  if (normalizedSegments.length === 0) {
    return null;
  }

  if (section.layout === "list" || section.key === "variables") {
    return {
      id: blockId,
      kind: "bullet",
      html: inlineHtml,
      segments: normalizedSegments,
    };
  }

  return {
    id: blockId,
    kind: "mixed",
    html: inlineHtml,
    segments: normalizedSegments,
  };
}

/**
 * 创建左对齐 display formula block。
 *
 * 这类 block 多用于从正文里提升出来的推导型长公式，
 * 比起完全居中，左对齐通常更符合阅读推导过程的习惯。
 */
function createStructuredFormulaBlock(blockId: string, latex: string): DetailBlockView {
  const mathResult = renderMath(latex, true, { align: "left" });

  return {
    id: blockId,
    kind: "formula",
    formulaAlign: "left",
    formulaText: mathResult.source,
    formulaHtml: mathResult.html,
  };
}

/**
 * theorem-list item 的适配逻辑。
 *
 * 这类 block 同时可能包含：
 * - 标题
 * - 描述
 * - 公式
 *
 * 适合表达“结论一 / 结论二”这种教学卡片结构。
 */
function createStructuredTheoremBlock(
  _section: DetailSectionView,
  blockId: string,
  rawItem: RawStructuredItem,
): DetailBlockView | null {
  const title = normalizeText(rawItem.title);
  const desc = normalizeText(rawItem.desc || rawItem.text);
  const latex = normalizeText(rawItem.latex);
  const mathResult = latex ? renderMath(latex, true) : null;

  if (!title && !desc && !latex) {
    return null;
  }

  return {
    id: blockId,
    kind: "theorem",
    title,
    titleHtml: renderPlainTextHtml(title),
    desc,
    descHtml: renderPlainTextHtml(desc),
    formulaText: mathResult?.source || "",
    formulaHtml: mathResult?.html || "",
  };
}

/**
 * 将 structured `segments` 转为页面层真正的 inline segments。
 *
 * 这一步非常关键：
 * - text 片段保持文本渲染；
 * - math 片段保持行内数学渲染；
 * - 不会因为进入前端 renderer 而退化成纯文本猜公式。
 */
function buildStructuredSegments(
  segments: RawStructuredSegment[],
  blockId: string,
): DetailInlineSegmentView[] {
  const normalizedSource = normalizeInlineSegments(segments);
  const result: DetailInlineSegmentView[] = [];

  for (let index = 0; index < normalizedSource.length; index += 1) {
    const segment = normalizedSource[index];

    if (segment.type === "math" && normalizeText(segment.latex)) {
      result.push({
        id: `${blockId}-segment-${index + 1}`,
        kind: "math",
        html: renderMath(segment.latex, false).html,
      });
      continue;
    }

    result.push({
      id: `${blockId}-segment-${index + 1}`,
      kind: "text",
      html: renderPlainTextHtml(segment.text, true),
    });
  }

  return result;
}

/**
 * 把同一个 item 内的所有 inline segments 组合成一个连续段落。
 *
 * 这里故意只包成一个容器，是为了保证：
 * - 中文 + inline math 在同一段落里自然换行；
 * - 不会因为 segment 边界而被拆成很多互不相关的小块。
 */
function composeInlineSegmentHtml(segments: DetailInlineSegmentView[]): string {
  const content = segments
    .map((segment) => segment.html)
    .filter((html) => html.length > 0)
    .join("");

  if (!content) {
    return "";
  }

  // Wrap one structured item into a single inline-flow container so text/math
  // segments behave like one paragraph instead of unrelated sibling blocks.
  return `<span style="display:inline;white-space:normal;line-height:inherit;">${content}</span>`;
}

/**
 * 归一化 structured segments。
 *
 * 主要做三件事：
 * 1. 去掉空 segment；
 * 2. 规范化 math latex；
 * 3. 合并相邻 text，避免页面渲染时出现无意义碎片。
 */
function normalizeInlineSegments(segments: RawStructuredSegment[]): RawStructuredSegment[] {
  const result: RawStructuredSegment[] = [];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (segment.type === "math") {
      const latex = normalizeText(segment.latex);

      if (!latex) {
        continue;
      }

      result.push({
        type: "math",
        latex,
      });
      continue;
    }

    const text = normalizeInlineText(segment.text);

    if (!text) {
      continue;
    }

    const previous = result[result.length - 1];
    if (previous && previous.type !== "math") {
      previous.text = `${previous.text || ""}${text}`;
      continue;
    }

    result.push({
      type: "text",
      text,
    });
  }

  return result;
}

/**
 * 保留行内文本中的自然换行，不做额外裁剪。
 * 这是为了尽量尊重 structured 数据原本的段内语义。
 */
function normalizeInlineText(text?: string): string {
  return (text || "").replace(/\r\n?/g, "\n");
}

/**
 * 判断一个 structured math segment 是否应该被提升为 display formula。
 *
 * 典型触发条件：
 * - 多行公式
 * - 明显的 aligned / matrix / cases 环境
 * - 很长的等式链或不等式链
 */
function isStructuredDisplayMathSegment(segment: RawStructuredSegment): boolean {
  if (segment.type !== "math") {
    return false;
  }

  const latex = normalizeText(segment.latex);
  if (!latex) {
    return false;
  }

  return (
    /\n/.test(latex)
    || /\\\\/.test(latex)
    || /\\begin\{(?:aligned|align\*?|gather\*?|cases|array|matrix|pmatrix|bmatrix|Bmatrix|vmatrix|Vmatrix|split)\}/.test(latex)
    || isStructuredLongEquationChain(latex)
  );
}

/**
 * 判断一条 latex 是否像“长推导公式链”。
 *
 * 这个函数的目标不是严格数学解析，而是做一个偏保守的 UI 决策：
 * 如果一条公式在正文中作为 inline math 很可能撑破布局，
 * 就优先提升成独立公式卡片，换取更稳定的阅读体验。
 */
function isStructuredLongEquationChain(latex: string): boolean {
  const normalized = latex.replace(/\s+/g, " ").trim();

  if (normalized.length < 24) {
    return false;
  }

  const relationTokenCount =
    (normalized.match(/\\(?:Rightarrow|Longrightarrow|Leftrightarrow|iff|implies|ge|geq|le|leq|neq|approx|sim|to|mapsto)/g) || []).length
    + (normalized.match(/[=<>]/g) || []).length;

  if (relationTokenCount >= 2 && normalized.length >= 28) {
    return true;
  }

  if (relationTokenCount >= 1 && normalized.length >= 40) {
    return true;
  }

  return (
    normalized.length >= 34
    && /(=|\\Rightarrow|\\Longrightarrow|\\left|\\right|\\frac|\\cdot|\\quad|\\ge|\\geq|\\le|\\leq|\\neq)/.test(normalized)
  );
}

/**
 * statement 字段的 legacy 解析器。
 *
 * 这是旧数据最后一道重要兜底：
 * - 识别 section heading（条件 / 结论 / 取等条件）
 * - 识别 theorem 风格条目
 * - 识别整行公式
 * - 其余内容作为普通文本
 */
function parseStatementContent(statement: string): DetailSectionView[] {
  const sections: DetailSectionView[] = [];
  const lines = statement
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  let currentSection = ensureSection(sections, "正文", "overview");
  let currentTheorem: DetailBlockView | null = null;

  const flushTheorem = () => {
    currentTheorem = null;
  };

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const sectionHeading = matchSectionHeading(line);

    if (sectionHeading) {
      flushTheorem();
      currentSection = ensureSection(sections, sectionHeading.title, sectionHeading.key);

      if (sectionHeading.inlineText) {
        currentSection.blocks.push({
          id: `${currentSection.key}-inline-${currentSection.blocks.length + 1}`,
          kind: "text",
          text: sectionHeading.inlineText,
        });
      }
      continue;
    }

    if (currentSection.key === "conclusions" && /^[-•]/.test(line)) {
      const title = line
        .replace(/^[-•]\s*/, "")
        .replace(/[：:]$/, "")
        .trim();

      currentTheorem = {
        id: `${currentSection.key}-theorem-${currentSection.blocks.length + 1}`,
        kind: "theorem",
        title,
      };
      currentSection.blocks.push(currentTheorem);
      continue;
    }

    if (/^直观描述[：:]?/.test(line)) {
      const description = line.replace(/^直观描述[：:]?\s*/, "").trim();
      if (currentTheorem) {
        currentTheorem.desc = appendText(currentTheorem.desc, description);
      } else {
        currentSection.blocks.push({
          id: `${currentSection.key}-text-${currentSection.blocks.length + 1}`,
          kind: "text",
          text: description,
        });
      }
      continue;
    }

    if (/^[-•]/.test(line)) {
      flushTheorem();
      currentSection.blocks.push({
        id: `${currentSection.key}-bullet-${currentSection.blocks.length + 1}`,
        kind: "bullet",
        text: line.replace(/^[-•]\s*/, "").trim(),
      });
      continue;
    }

    if (looksLikeFormula(line)) {
      const mathResult = renderMath(line, true);

      if (currentTheorem) {
        currentTheorem.formulaText = mathResult.source;
        currentTheorem.formulaHtml = mathResult.html;
      } else {
        currentSection.blocks.push({
          id: `${currentSection.key}-formula-${currentSection.blocks.length + 1}`,
          kind: "formula",
          formulaText: mathResult.source,
          formulaHtml: mathResult.html,
        });
      }
      continue;
    }

    if (currentTheorem) {
      currentTheorem.desc = appendText(currentTheorem.desc, line);
      continue;
    }

    currentSection.blocks.push({
      id: `${currentSection.key}-text-${currentSection.blocks.length + 1}`,
      kind: "text",
      text: line,
    });
  }

  return sections.filter((section) => section.blocks.length > 0);
}

/**
 * 为 legacy section 补充 HTML 展示字段。
 * 这样页面层在渲染 legacy 数据时，也能尽量复用统一模板。
 */
function decorateLegacySections(sections: DetailSectionView[]): DetailSectionView[] {
  return sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => decorateLegacyBlock(block)),
  }));
}

/**
 * 给单个 legacy block 补充 HTML。
 *
 * 说明：
 * - text / bullet 会走 mixed-text 渲染，以兼容旧文本中夹杂的简单公式。
 * - theorem 需要分别装饰标题和描述。
 */
function decorateLegacyBlock(block: DetailBlockView): DetailBlockView {
  if (block.kind === "text" || block.kind === "bullet") {
    return {
      ...block,
      html: renderMixedTextHtml(block.text),
    };
  }

  if (block.kind === "theorem") {
    return {
      ...block,
      titleHtml: renderMixedTextHtml(block.title),
      descHtml: renderMixedTextHtml(block.desc),
    };
  }

  return block;
}

/**
 * 识别 legacy statement 中的章节标题。
 * 返回值里同时保留 inlineText，便于把标题后面跟着的短说明继续挂到当前 section 上。
 */
function matchSectionHeading(
  line: string,
): { title: string; key: string; inlineText: string } | null {
  const matched = line.match(
    /^(条件|结论|等号\/取等条件|等号条件|取等条件)[：:]?\s*(.*)$/,
  );

  if (!matched) {
    return null;
  }

  const rawTitle = matched[1];
  const inlineText = matched[2].trim();

  if (rawTitle === "条件") {
    return {
      title: "条件",
      key: "conditions",
      inlineText,
    };
  }

  if (rawTitle === "结论") {
    return {
      title: "结论",
      key: "conclusions",
      inlineText,
    };
  }

  return {
    title: "取等条件",
    key: "equality",
    inlineText,
  };
}

/**
 * 判断某一行是否像独立公式。
 *
 * 这是 legacy 文本解析中的启发式规则：
 * - structured v2 数据不会依赖这里；
 * - 只有旧文本字段才需要用它来猜“这一整行应不应该当公式块处理”。
 */
function looksLikeFormula(line: string): boolean {
  if (!line) {
    return false;
  }

  const candidate = unwrapFormulaLine(line);
  const hasChinese = /[\u4e00-\u9fa5]/.test(candidate);
  const hasLatexCommand = /\\[A-Za-z]+/.test(candidate);
  const hasMathToken =
    hasLatexCommand
    || /[=<>+\-*/^_{}()[\]|]/.test(candidate)
    || /[A-Za-z]/.test(candidate);

  if (!hasMathToken) {
    return false;
  }

  if (hasLatexCommand) {
    return true;
  }

  return !hasChinese || /^[|$\\(]/.test(candidate);
}

/**
 * 去掉整行公式外层可能包裹的数学定界符，便于后续进一步判断和渲染。
 */
function unwrapFormulaLine(line: string): string {
  let normalized = normalizeText(line);
  const wrappedPairs: Array<[string, string]> = [
    ["$$", "$$"],
    ["\\[", "\\]"],
    ["$", "$"],
    ["\\(", "\\)"],
  ];
  let changed = true;

  while (changed && normalized) {
    changed = false;

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
 * 获取或创建 legacy section。
 * 这是 statement 解析过程中维护 section 聚合状态的一个小工具函数。
 */
function ensureSection(
  sections: DetailSectionView[],
  title: string,
  key: string,
): DetailSectionView {
  const existing = sections.find((section) => section.key === key);
  if (existing) {
    return existing;
  }

  const section: DetailSectionView = {
    key,
    title,
    layout: "legacy",
    blocks: [],
  };

  sections.push(section);
  return section;
}

/**
 * 标记当前条目的来源类型，便于页面层或调试时知道它究竟走的是哪条数据链。
 */
function detectSourceType(rawEntry: RawDetailEntry | null): "structured" | "legacy" | "meta" {
  if (!rawEntry) {
    return "meta";
  }

  if (hasStructuredSections(rawEntry)) {
    return "structured";
  }

  if (hasRichDetailFields(rawEntry) || getStatementSource(rawEntry)) {
    return "legacy";
  }

  return "meta";
}

/**
 * 判断旧 record 是否仍然拥有较丰富的详情字段。
 * 这主要用于区分“真正空数据”与“仍可从 legacy 字段拼出完整详情”的记录。
 */
function hasRichDetailFields(rawEntry: RawDetailEntry): boolean {
  return Boolean(
    rawEntry.core_summary
      || rawEntry.core_formula
      || rawEntry.explanation
      || rawEntry.proof
      || rawEntry.examples
      || rawEntry.traps
      || rawEntry.usage
      || rawEntry.assets
      || rawEntry.variables
      || rawEntry.related_formulas
      || rawEntry.conditions
      || rawEntry.conclusions,
  );
}

/**
 * 以下一组 helper 负责为详情页挑选“展示优先字段”。
 * 它们的共同目标是：在原始数据存在别名字段、兜底字段或轻微不一致时，
 * 仍然为页面返回尽量稳定的标题、摘要、公式、PDF 地址和分类。
 */
function getPreferredTitle(rawEntry: RawDetailEntry, id: string): string {
  const rawTitle = normalizeText(rawEntry.title);
  if (rawTitle && !looksLikeSyntheticTitle(rawTitle, id)) {
    return rawTitle;
  }

  const alias = Array.isArray(rawEntry.alias) ? normalizeText(rawEntry.alias[0]) : "";
  return alias || rawTitle || id;
}

function getPreferredCategory(rawEntry: RawDetailEntry): string {
  return normalizeText(rawEntry.category) || getModuleLabel(rawEntry.module);
}

function getPreferredSummary(rawEntry: RawDetailEntry): string {
  return (
    normalizeText(rawEntry.core_summary)
    || normalizeText(rawEntry.coreSummary)
    || normalizeText(rawEntry.summary)
  );
}

function getPreferredFormula(rawEntry: RawDetailEntry, sections: DetailSectionView[]): string {
  return (
    normalizeText(rawEntry.core_formula)
    || normalizeText(rawEntry.coreFormula)
    || getFirstFormulaFromSections(sections)
  );
}

function getStatementSource(rawEntry: RawDetailEntry | null): string {
  return normalizeText(
    rawEntry?.statement
      || rawEntry?.statementLatex
      || rawEntry?.statement_latex,
  );
}

function getPreferredPdfUrl(id: string, rawEntry: RawDetailEntry): string {
  const directPdfUrl = normalizeText(rawEntry.pdfUrl || rawEntry.pdfPath || rawEntry.assets?.pdf);
  if (directPdfUrl) {
    return resolvePdfUrl(directPdfUrl, id);
  }

  const numericId = extractNumericId(id);
  return numericId ? `/assets/svg/vector/${numericId}.pdf` : "";
}

function resolvePdfUrl(rawValue: string, id: string): string {
  if (/^https?:\/\//i.test(rawValue) || rawValue.startsWith("/")) {
    return rawValue;
  }

  const numericId = extractNumericId(rawValue) || extractNumericId(id);
  return numericId ? `/assets/svg/vector/${numericId}.pdf` : rawValue;
}

function extractNumericId(id: string): string {
  const matched = id.match(/(\d+)/);
  if (!matched) {
    return "";
  }

  return matched[1].padStart(3, "0");
}

function getModuleLabel(module?: string): string {
  const normalized = normalizeText(module);

  if (normalized === "function") {
    return "函数";
  }

  if (normalized === "trigonometry") {
    return "三角函数";
  }

  if (normalized === "inequality") {
    return "不等式";
  }

  return "数学";
}

function getFirstFormulaFromSections(sections: DetailSectionView[]): string {
  for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex += 1) {
    const section = sections[sectionIndex];

    for (let blockIndex = 0; blockIndex < section.blocks.length; blockIndex += 1) {
      const block = section.blocks[blockIndex];
      if (block.formulaText) {
        return block.formulaText;
      }
    }
  }

  return "";
}

function looksLikeSyntheticTitle(title: string, id: string): boolean {
  const normalized = normalizeText(title);
  if (!normalized) {
    return false;
  }

  if (normalized === id) {
    return true;
  }

  return /^I\d{3}_[A-Za-z0-9_]+$/.test(normalized);
}

function formatVariableText(variable: RawDetailVariable): string {
  if (typeof variable === "string") {
    return normalizeText(variable);
  }

  const name = normalizeText(variable.latex || variable.name);
  const description = normalizeText(variable.description);

  if (name && description) {
    return `${name}：${description}`;
  }

  return name || description;
}

/**
 * 以下一组 helper 负责做最基础的文本归一化与数组拼接。
 * 它们不承担业务判断，只提供低成本的清洗与聚合能力。
 */
function toNormalizedList(input?: string[]): string[] {
  if (!Array.isArray(input)) {
    return [];
  }

  const result: string[] = [];

  for (let index = 0; index < input.length; index += 1) {
    const normalized = normalizeText(input[index]);
    if (!normalized) {
      continue;
    }

    result.push(normalized);
  }

  return result;
}

function normalizeRichText(value?: string | string[]): string {
  if (Array.isArray(value)) {
    return value
      .map((item) => normalizeText(item))
      .filter((item) => item.length > 0)
      .join("\n");
  }

  return normalizeText(value);
}

function pushSection(target: DetailSectionView[], section: DetailSectionView | null) {
  if (section && section.blocks.length > 0) {
    target.push(section);
  }
}

function normalizeText(text?: string): string {
  return (text || "").trim();
}

function appendText(base?: string, extra?: string): string {
  const normalizedBase = normalizeText(base);
  const normalizedExtra = normalizeText(extra);

  if (!normalizedBase) {
    return normalizedExtra;
  }

  if (!normalizedExtra) {
    return normalizedBase;
  }

  return `${normalizedBase}\n${normalizedExtra}`;
}
