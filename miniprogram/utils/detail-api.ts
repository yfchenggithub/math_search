import type { ConclusionDetail } from "../types/api";
import type {
  DetailBlockView,
  DetailDocumentView,
  DetailSectionView,
} from "./detail-content";
import { renderMixedTextHtml } from "./math-render";

/**
 * 将后端详情接口数据适配成详情页现有的 view model。
 *
 * 这样详情页仍然只消费统一的 `DetailDocumentView`，
 * 不需要知道数据究竟来自本地内容文件还是 REST API。
 */
export function buildApiDetailDocument(detail: ConclusionDetail): DetailDocumentView {
  const summary = normalizeDetailText(detail.summary);

  return {
    id: normalizeDetailText(detail.id),
    title: normalizeDetailText(detail.title) || normalizeDetailText(detail.id),
    category: normalizeDetailText(detail.module) || "未分类",
    summary,
    summaryHtml: renderMixedTextHtml(summary),
    coreFormula: "",
    coreFormulaHtml: "",
    pdfUrl: "",
    hasPdf: false,
    sections: buildApiDetailSections(detail),
    sourceType: "api",
  };
}

/**
 * 将接口返回的各段正文映射成详情页的 section 列表。
 *
 * 当前先做最小适配：
 * - `statement` -> 结论
 * - `explanation` -> 理解
 * - `proof` -> 证明
 * - `examples` -> 例题/例子
 * - `traps` -> 易错点
 *
 * 后续如果后端返回更结构化的数据，再往这里升级即可。
 */
function buildApiDetailSections(detail: ConclusionDetail): DetailSectionView[] {
  const sections = [
    createApiTextSection("statement", "结论", detail.statement),
    createApiTextSection("explanation", "理解", detail.explanation),
    createApiTextSection("proof", "证明", detail.proof),
    createApiTextSection("examples", "例题/例子", detail.examples),
    createApiTextSection("traps", "易错点", detail.traps),
  ];

  return sections.filter((section): section is DetailSectionView => section !== null);
}

/**
 * 构造一个纯文本 section。
 *
 * 这里用 `renderMixedTextHtml`，是为了兼容“中文说明 + 简单数学公式”的混排内容。
 */
function createApiTextSection(
  key: string,
  title: string,
  content?: string,
): DetailSectionView | null {
  const normalizedContent = normalizeDetailText(content);

  if (!normalizedContent) {
    return null;
  }

  return {
    key,
    title,
    layout: "legacy",
    blocks: [createApiTextBlock(key, normalizedContent)],
  };
}

/**
 * 构造一个最小可用的正文 block。
 */
function createApiTextBlock(key: string, content: string): DetailBlockView {
  return {
    id: `${key}-1`,
    kind: "text",
    text: content,
    html: renderMixedTextHtml(content),
  };
}

/**
 * 统一做字符串清洗，避免把空白内容渲染成空 section。
 */
function normalizeDetailText(value?: string): string {
  return String(value || "").trim();
}
