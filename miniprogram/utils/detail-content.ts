import {
  renderMath,
  renderMixedTextHtml,
  renderPlainTextHtml,
} from "./math-render";

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
  sourceType: "structured" | "legacy" | "meta";
}

let detailContentCache: RawDetailMap | null = null;

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

function loadDetailContentModules(): Array<Record<string, unknown>> {
  // The detail page should only hydrate from detail-content bundles.
  // Pulling in the shared registry also loads search indexes, which can
  // reference files that do not exist in the detail-page runtime bundle.
  return [
    require("../data/content/inequality.js") as Record<string, unknown>,
  ];
}

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

function hasStructuredSections(
  rawEntry: RawDetailEntry | null | undefined,
): rawEntry is RawDetailEntry & { display_version: 2; sections: RawStructuredSection[] } {
  return Boolean(
    rawEntry?.display_version === 2
      && Array.isArray(rawEntry.sections)
      && rawEntry.sections.length > 0,
  );
}

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

    const layout = section.layout || "text";
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

function normalizeInlineText(text?: string): string {
  return (text || "").replace(/\r\n?/g, "\n");
}

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
  );
}

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

function decorateLegacySections(sections: DetailSectionView[]): DetailSectionView[] {
  return sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block) => decorateLegacyBlock(block)),
  }));
}

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
