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
import { buildAbsoluteApiUrl } from "./api-url";
import { DETAIL_API_CONFIG } from "../config/api";
import type {
  CanonicalMathImageAsset,
  CanonicalMathImageBlock,
  CanonicalPrimaryFormula,
  CanonicalConclusionDetail,
  CanonicalDetailBlock,
  CanonicalDetailPlain,
  CanonicalDetailSection,
  CanonicalDetailToken,
  CanonicalTheoremItem,
} from "../types/detail";
import { createLogger } from "./logger/logger";
import { STORAGE_KEYS } from "./storage/storage-keys";

const detailContentLogger = createLogger("detail-content");
const DETAIL_DOCUMENT_CACHE_STORAGE_KEY = STORAGE_KEYS.DETAIL_DOCUMENT_CACHE;
const DETAIL_DOCUMENT_CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const DETAIL_DOCUMENT_CACHE_MAX_STALE_MS = 30 * 24 * 60 * 60 * 1000;
const DETAIL_DOCUMENT_CACHE_MAX_COUNT = 100;

const READING_ITEM_TITLE_COLOR = "#0f172a";
const READING_INDEX_MARKER_PATTERN = /[一二三四五六七八九十百千万两\d]+/;

type ReadingSectionRule = {
  subheadingColor: string;
  subheadingPattern: RegExp;
  itemPrefixes: string[];
  itemLinePattern?: RegExp;
};

const READING_SECTION_RULES: Record<string, ReadingSectionRule> = {
  explanation: {
    subheadingColor: "#315a88",
    subheadingPattern: /^(?:一句话直觉|核心拆解|(?:几何本质|代数意义|考点价值)(?:[（(][^）)]*[）)])?|顿悟点|使用场景)$/,
    itemPrefixes: ["要点", "考点", "考法", "场景"],
  },
  proof: {
    subheadingColor: "#6f5a87",
    subheadingPattern: /^(?:思路提示|正式推导|结论回扣)$/,
    itemPrefixes: ["步骤"],
  },
  examples: {
    subheadingColor: "#2f7d36",
    subheadingPattern: /^(?:例\s*[一二三四五六七八九十百千万两\d]+(?:\s*(?:（[^）]*）|\([^)]*\)))?|题目|解题步骤|关键结论)$/,
    itemPrefixes: [],
    itemLinePattern: /^((?:第[一二三四五六七八九十百千万两\d]+步(?:\s*(?:（[^）]*）|\([^)]*\)))?|理由|关键结论)(?:\s*([：:])\s*(.*))?)$/,
  },
  traps: {
    subheadingColor: "#9d2e2d",
    subheadingPattern: /^(?:(?:易错点(?:[一二三四五六七八九十百千万两\d]+)?|正确理解|错因分析)(?:\s*(?:（[^）]*）|\([^)]*\)))?)$/,
    itemPrefixes: [],
    itemLinePattern: /^((?:易错点(?:[一二三四五六七八九十百千万两\d]+)?|正确理解|错因分析)(?:\s*(?:（[^）]*）|\([^)]*\)))?)(?:\s*([：:])\s*(.*))?$/,
  },
  summary: {
    subheadingColor: "#6b4b3d",
    subheadingPattern: /^(?:一句话核心|使用条件|关键提醒)$/,
    itemPrefixes: [],
    itemLinePattern: /^((?:条件\s*[一二三四五六七八九十百千万两\d]+|易错点|检查项)(?:\s*(?:（[^）]*）|\([^)]*\)))?)(?:\s*([：:])\s*(.*))?$/,
  },
};

/**
 * 以下 Raw* 类型描述的是“构建脚本输出的数据形态”。
 * 这些类型并不直接用于页面渲染，而是作为适配层的输入。
 */
type RawStructuredSegment = {
  type?: "text" | "math";
  text?: string;
  latex?: string;
};

export interface DetailMathImageAsset {
  png?: string;
  webp?: string;
  width_px?: number;
  height_px?: number;
  display_width_px?: number;
  display_height_px?: number;
  scale?: number;
}

export interface MathImageNode {
  type: "math_image";
  latex?: string;
  alt?: string;
  asset?: DetailMathImageAsset;
  imageUrl?: string;
  displayWidth?: number;
  imageLoadFailed?: boolean;
  __path?: string;
}

type RawStructuredItem = {
  type?: string;
  title?: string;
  desc?: string;
  text?: string;
  alt?: string;
  latex?: string;
  asset?: DetailMathImageAsset;
  segments?: RawStructuredSegment[];
};

type RawStructuredSection = {
  key?: string;
  title?: string;
  layout?: "text" | "list" | "theorem-list";
  text?: string;
  items?: Array<string | RawStructuredItem>;
};

type RawPrimaryFormula = {
  latex?: string;
  type?: string;
  need_image?: boolean | number | string;
  asset?: DetailMathImageAsset;
  alt?: string;
  [key: string]: unknown;
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
  alias?: string[] | string;
  difficulty?: number | string;
  category?: string;
  tags?: string[] | string;
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
  primary_formula?: string | RawPrimaryFormula;
  pdfUrl?: string;
  pdfFilename?: string;
  pdfAvailable?: boolean;
  pdfPath?: string;
  is_favorited?: boolean | number | string;
  isFavorited?: boolean | number | string;
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

export interface TheoremDescPartView {
  kind: "html" | "math_image";
  html?: string;
  image?: MathImageNode;
}

export interface DetailBlockView {
  id: string;
  kind: "text" | "bullet" | "formula" | "theorem" | "mixed" | "math_image";
  formulaAlign?: "center" | "left";
  title?: string;
  titleHtml?: string;
  desc?: string;
  descHtml?: string;
  descLeadHtml?: string;
  descTailHtml?: string;
  descParts?: TheoremDescPartView[];
  text?: string;
  html?: string;
  segments?: DetailInlineSegmentView[];
  formulaText?: string;
  formulaHtml?: string;
  formulaImages?: MathImageNode[];
  type?: "math_image";
  latex?: string;
  alt?: string;
  asset?: DetailMathImageAsset;
  imageUrl?: string;
  displayWidth?: number;
  imageLoadFailed?: boolean;
  __path?: string;
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

interface DetailMetadataView {
  aliases: string[];
  tags: string[];
  hasDifficulty: boolean;
  difficultyLabel: string;
  isFavorited: boolean;
  showFavoriteStatus: boolean;
  favoriteStatusText: string;
}

export interface DetailDocumentView {
  id: string;
  title: string;
  category: string;
  summary: string;
  summaryHtml: string;
  aliases: string[];
  tags: string[];
  hasDifficulty: boolean;
  difficultyLabel: string;
  isFavorited: boolean;
  showFavoriteStatus: boolean;
  favoriteStatusText: string;
  coreFormula: string;
  coreFormulaHtml: string;
  coreFormulaImage?: MathImageNode;
  pdfUrl: string;
  pdfFilename: string;
  pdfAvailable: boolean;
  sections: DetailSectionView[];
  sourceType: "structured" | "legacy" | "meta" | "api";
  legacyPlain?: DetailLegacyPlainView;
}

type PersistedDetailDocumentRecord = {
  detail: DetailDocumentView;
  updatedAt: number;
  lastAccessAt: number;
};

type PersistedDetailDocumentMap = Record<string, PersistedDetailDocumentRecord>;

let detailContentCache: RawDetailMap | null = null;
let fetchConclusionDetailRuntime:
  | ((id: string) => Promise<CanonicalConclusionDetail>)
  | null = null;
let persistedDetailDocumentCache: PersistedDetailDocumentMap | null = null;
const detailDocumentRefreshTasks: Partial<Record<string, Promise<void>>> = {};

type PersistedDetailDocumentRead = {
  detail: DetailDocumentView;
  isFresh: boolean;
};

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function toPositiveTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return fallback;
}

function isDetailSourceType(value: unknown): value is DetailDocumentView["sourceType"] {
  return value === "structured" || value === "legacy" || value === "meta" || value === "api";
}

function looksLikeDetailDocumentView(value: unknown): value is DetailDocumentView {
  if (!isPlainObject(value)) {
    return false;
  }

  const candidate = value as Partial<DetailDocumentView>;
  return Boolean(
    typeof candidate.id === "string"
      && candidate.id.trim().length > 0
      && typeof candidate.title === "string"
      && typeof candidate.category === "string"
      && typeof candidate.summary === "string"
      && typeof candidate.summaryHtml === "string"
      && Array.isArray(candidate.aliases)
      && Array.isArray(candidate.tags)
      && typeof candidate.hasDifficulty === "boolean"
      && typeof candidate.difficultyLabel === "string"
      && typeof candidate.isFavorited === "boolean"
      && typeof candidate.showFavoriteStatus === "boolean"
      && typeof candidate.favoriteStatusText === "string"
      && typeof candidate.coreFormula === "string"
      && typeof candidate.coreFormulaHtml === "string"
      && typeof candidate.pdfUrl === "string"
      && typeof candidate.pdfFilename === "string"
      && typeof candidate.pdfAvailable === "boolean"
      && Array.isArray(candidate.sections)
      && isDetailSourceType(candidate.sourceType)
  );
}

function normalizePersistedDetailDocumentMap(raw: unknown): PersistedDetailDocumentMap {
  if (!isPlainObject(raw)) {
    return {};
  }

  const now = Date.now();
  const normalized: PersistedDetailDocumentMap = {};
  const entries = raw as Record<string, unknown>;

  Object.keys(entries).forEach((rawId) => {
    const normalizedId = normalizeText(rawId);
    const candidate = entries[rawId];
    let detail: DetailDocumentView | null = null;
    let updatedAt = now;
    let lastAccessAt = now;

    if (looksLikeDetailDocumentView(candidate)) {
      detail = candidate;
    } else if (isPlainObject(candidate) && looksLikeDetailDocumentView(candidate.detail)) {
      detail = candidate.detail;
      updatedAt = toPositiveTimestamp(candidate.updatedAt, now);
      lastAccessAt = toPositiveTimestamp(candidate.lastAccessAt, updatedAt);
    }

    if (!detail) {
      return;
    }

    const detailId = normalizeText(detail.id) || normalizedId;
    if (!detailId) {
      return;
    }

    normalized[detailId] = {
      detail,
      updatedAt: toPositiveTimestamp(updatedAt, now),
      lastAccessAt: toPositiveTimestamp(lastAccessAt, updatedAt),
    };
  });

  return normalized;
}

function prunePersistedDetailDocumentCache(
  cacheMap: PersistedDetailDocumentMap,
  now: number = Date.now(),
): PersistedDetailDocumentMap {
  const validEntries = Object.keys(cacheMap)
    .map((id) => {
      const record = cacheMap[id];
      if (!record || !looksLikeDetailDocumentView(record.detail)) {
        return null;
      }

      const normalizedId = normalizeText(id) || normalizeText(record.detail.id);
      if (!normalizedId) {
        return null;
      }

      const updatedAt = toPositiveTimestamp(record.updatedAt, now);
      const ageMs = now - updatedAt;
      if (ageMs > DETAIL_DOCUMENT_CACHE_MAX_STALE_MS) {
        return null;
      }

      const lastAccessAt = toPositiveTimestamp(record.lastAccessAt, updatedAt);
      return {
        id: normalizedId,
        record: {
          detail: record.detail,
          updatedAt,
          lastAccessAt,
        },
      };
    })
    .filter(
      (
        item,
      ): item is { id: string; record: PersistedDetailDocumentRecord } => Boolean(item),
    )
    .sort((left, right) => {
      if (right.record.lastAccessAt !== left.record.lastAccessAt) {
        return right.record.lastAccessAt - left.record.lastAccessAt;
      }

      return right.record.updatedAt - left.record.updatedAt;
    })
    .slice(0, DETAIL_DOCUMENT_CACHE_MAX_COUNT);

  const pruned: PersistedDetailDocumentMap = {};
  validEntries.forEach((entry) => {
    pruned[entry.id] = entry.record;
  });
  return pruned;
}

function readPersistedDetailDocumentCacheFromStorage(): PersistedDetailDocumentMap {
  try {
    return normalizePersistedDetailDocumentMap(
      wx.getStorageSync(DETAIL_DOCUMENT_CACHE_STORAGE_KEY),
    );
  } catch (error) {
    detailContentLogger.warn("read_detail_document_cache_failed", {
      error,
    });
    return {};
  }
}

function writePersistedDetailDocumentCacheToStorage(cacheMap: PersistedDetailDocumentMap): void {
  try {
    wx.setStorageSync(DETAIL_DOCUMENT_CACHE_STORAGE_KEY, cacheMap);
  } catch (error) {
    detailContentLogger.warn("write_detail_document_cache_failed", {
      size: Object.keys(cacheMap).length,
      error,
    });
  }
}

function getPersistedDetailDocumentCache(): PersistedDetailDocumentMap {
  if (!persistedDetailDocumentCache) {
    persistedDetailDocumentCache = prunePersistedDetailDocumentCache(
      readPersistedDetailDocumentCacheFromStorage(),
    );
  }

  return persistedDetailDocumentCache;
}

function readPersistedDetailDocument(id: string): PersistedDetailDocumentRead | null {
  const normalizedId = normalizeText(id);
  if (!normalizedId) {
    return null;
  }

  const cacheMap = getPersistedDetailDocumentCache();
  const record = cacheMap[normalizedId];
  if (!record) {
    return null;
  }

  const now = Date.now();
  const updatedAt = toPositiveTimestamp(record.updatedAt, now);
  const ageMs = now - updatedAt;
  if (ageMs > DETAIL_DOCUMENT_CACHE_MAX_STALE_MS) {
    delete cacheMap[normalizedId];
    writePersistedDetailDocumentCacheToStorage(cacheMap);
    return null;
  }

  record.lastAccessAt = now;
  return {
    detail: record.detail,
    isFresh: ageMs <= DETAIL_DOCUMENT_CACHE_TTL_MS,
  };
}

function upsertPersistedDetailDocument(detail: DetailDocumentView, updatedAt = Date.now()): void {
  const detailId = normalizeText(detail.id);
  if (!detailId) {
    return;
  }

  const now = Date.now();
  const cacheMap = getPersistedDetailDocumentCache();
  cacheMap[detailId] = {
    detail,
    updatedAt: toPositiveTimestamp(updatedAt, now),
    lastAccessAt: now,
  };

  persistedDetailDocumentCache = prunePersistedDetailDocumentCache(cacheMap, now);
  writePersistedDetailDocumentCacheToStorage(persistedDetailDocumentCache);
}

async function fetchRemoteDetailDocumentById(id: string): Promise<DetailDocumentView> {
  const fetchConclusionDetail = resolveDetailApiFetcher();
  const remoteDetail = await fetchConclusionDetail(id);
  const detailDocument = buildCanonicalDetailDocument(remoteDetail, id);
  upsertPersistedDetailDocument(detailDocument);
  return detailDocument;
}

function scheduleDetailDocumentBackgroundRefresh(id: string): void {
  const normalizedId = normalizeText(id);
  if (!normalizedId || detailDocumentRefreshTasks[normalizedId]) {
    return;
  }

  detailDocumentRefreshTasks[normalizedId] = fetchRemoteDetailDocumentById(normalizedId)
    .then(() => undefined)
    .catch((error) => {
      detailContentLogger.warn("detail_cache_background_refresh_failed", {
        id: normalizedId,
        error,
      });
    })
    .finally(() => {
      delete detailDocumentRefreshTasks[normalizedId];
    });
}

function resolveDetailApiFetcher(): (id: string) => Promise<CanonicalConclusionDetail> {
  if (fetchConclusionDetailRuntime) {
    return fetchConclusionDetailRuntime;
  }

  const detailApiModule = require("./detail-api") as {
    fetchConclusionDetail?: (id: string) => Promise<CanonicalConclusionDetail>;
  };

  if (!detailApiModule || typeof detailApiModule.fetchConclusionDetail !== "function") {
    throw new Error("detail-api fetcher is unavailable");
  }

  fetchConclusionDetailRuntime = detailApiModule.fetchConclusionDetail;
  return fetchConclusionDetailRuntime;
}

export async function refreshDetailDocumentById(id: string): Promise<DetailDocumentView | null> {
  const normalizedId = normalizeText(id);

  if (!normalizedId) {
    return null;
  }

  if (!DETAIL_API_CONFIG.USE_REMOTE_API) {
    const localDetail = getDetailDocument(normalizedId);
    if (localDetail) {
      upsertPersistedDetailDocument(localDetail);
    }
    return localDetail;
  }

  return fetchRemoteDetailDocumentById(normalizedId);
}

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
  const primaryFormula = resolvePrimaryFormula(rawEntry.primary_formula);
  const coreFormula = primaryFormula.latex || getPreferredFormula(rawEntry, viewModel.sections);
  const coreFormulaImage = primaryFormula.image;
  const coreFormulaHtml = coreFormula ? renderMath(coreFormula, true).html : "";

  return {
    id: viewModel.id,
    title: getPreferredTitle(rawEntry, id),
    category: getPreferredCategory(rawEntry),
    summary: viewModel.summary,
    summaryHtml: viewModel.summaryHtml,
    aliases: viewModel.aliases,
    tags: viewModel.tags,
    hasDifficulty: viewModel.hasDifficulty,
    difficultyLabel: viewModel.difficultyLabel,
    isFavorited: viewModel.isFavorited,
    showFavoriteStatus: viewModel.showFavoriteStatus,
    favoriteStatusText: viewModel.favoriteStatusText,
    coreFormula,
    coreFormulaHtml,
    coreFormulaImage,
    pdfUrl: viewModel.pdfUrl,
    pdfFilename: viewModel.pdfFilename,
    pdfAvailable: viewModel.pdfAvailable,
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
    const localDetail = getDetailDocument(normalizedId);
    if (localDetail) {
      upsertPersistedDetailDocument(localDetail);
    }
    return localDetail;
  }

  const persistedDetail = readPersistedDetailDocument(normalizedId);
  if (persistedDetail) {
    if (!persistedDetail.isFresh) {
      scheduleDetailDocumentBackgroundRefresh(normalizedId);
    }
    return persistedDetail.detail;
  }

  try {
    return await fetchRemoteDetailDocumentById(normalizedId);
  } catch (error) {
    if (!DETAIL_API_CONFIG.ENABLE_LOCAL_FALLBACK) {
      throw error;
    }

    const localDetail = getDetailDocument(normalizedId);
    if (localDetail) {
      upsertPersistedDetailDocument(localDetail);
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
  const sections = normalizeMathImageBlocksInSections(
    maybeInjectDevMathImageNode(buildCanonicalSections(detail)),
  );
  const summary = getCanonicalSummary(detail, sections);
  const metadata = buildCanonicalDetailMetadata(detail);
  const primaryFormula = resolvePrimaryFormula(detail.content?.primary_formula);
  const coreFormula = primaryFormula.latex || getFirstFormulaFromSections(sections);
  const coreFormulaImage = primaryFormula.image;
  const coreFormulaHtml = coreFormula ? renderMath(coreFormula, true).html : "";
  const pdfUrl = normalizeCanonicalPdfUrl(detail);
  const pdfFilename = normalizeCanonicalPdfFilename(detail, pdfUrl);
  const pdfAvailable = normalizeCanonicalPdfAvailable(detail, pdfUrl);

  return {
    id: resolvedId,
    title: normalizeText(detail.meta?.title) || resolvedId,
    category:
      normalizeText(detail.meta?.category)
      || getModuleLabel(detail.identity?.module),
    summary,
    summaryHtml: renderMixedTextHtml(summary),
    aliases: metadata.aliases,
    tags: metadata.tags,
    hasDifficulty: metadata.hasDifficulty,
    difficultyLabel: metadata.difficultyLabel,
    isFavorited: metadata.isFavorited,
    showFavoriteStatus: metadata.showFavoriteStatus,
    favoriteStatusText: metadata.favoriteStatusText,
    coreFormula,
    coreFormulaHtml,
    coreFormulaImage,
    pdfUrl,
    pdfFilename,
    pdfAvailable,
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

  if (blockType === "math_image") {
    return buildCanonicalMathImageBlock(
      sectionKey,
      block as CanonicalMathImageBlock,
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
): DetailBlockView | DetailBlockView[] | null {
  const blockId = resolveCanonicalBlockId(sectionKey, block, blockIndex, "paragraph");
  const tokens = normalizeCanonicalTokens(block.tokens);

  if (tokens.length === 0) {
    const fallbackText = normalizeUnknownText(block.text);
    if (!fallbackText) {
      return null;
    }

    return createCanonicalTextBlock(sectionKey, blockId, fallbackText);
  }

  const fragments = splitCanonicalTokenFragments(tokens);
  if (fragments.length === 1 && fragments[0].kind === "tokens") {
    return buildCanonicalParagraphTokenBlock(sectionKey, blockId, fragments[0].tokens);
  }

  const result: DetailBlockView[] = [];
  let tokenFragmentIndex = 0;
  let imageFragmentIndex = 0;

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];

    if (fragment.kind === "math_image") {
      imageFragmentIndex += 1;
      result.push(createMathImageBlock(`${blockId}-math-image-${imageFragmentIndex}`, fragment.node));
      continue;
    }

    tokenFragmentIndex += 1;
    const tokenBlock = buildCanonicalParagraphTokenBlock(
      sectionKey,
      `${blockId}-tokens-${tokenFragmentIndex}`,
      fragment.tokens,
    );
    if (tokenBlock) {
      result.push(tokenBlock);
    }
  }

  if (result.length === 0) {
    return null;
  }

  if (result.length === 1) {
    return result[0];
  }

  return result;
}

function buildCanonicalParagraphTokenBlock(
  sectionKey: string,
  blockId: string,
  tokens: CanonicalDetailToken[],
): DetailBlockView | null {
  if (tokens.length === 0) {
    return null;
  }

  if (tokens.length === 1 && tokens[0].type === "math_inline" && !isCanonicalBulletSection(sectionKey)) {
    return createStructuredFormulaBlock(blockId, normalizeUnknownText(tokens[0].latex));
  }

  const rawSegments = buildCanonicalRawSegments(tokens);
  const segments = buildStructuredSegments(rawSegments, blockId);
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

  const styledHtml = composeReadingStyledInlineHtml(sectionKey, blockId, rawSegments);
  const html = styledHtml || composeInlineSegmentHtml(segments);

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

type CanonicalTokenFragment =
  | { kind: "tokens"; tokens: CanonicalDetailToken[] }
  | { kind: "math_image"; node: MathImageNode };

function splitCanonicalTokenFragments(tokens: CanonicalDetailToken[]): CanonicalTokenFragment[] {
  const result: CanonicalTokenFragment[] = [];
  let tokenBuffer: CanonicalDetailToken[] = [];

  const flushTokenBuffer = () => {
    if (tokenBuffer.length === 0) {
      return;
    }

    result.push({
      kind: "tokens",
      tokens: tokenBuffer,
    });
    tokenBuffer = [];
  };

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    const mathImageNode = tryBuildCanonicalTokenMathImageNode(token);

    if (mathImageNode) {
      flushTokenBuffer();
      result.push({
        kind: "math_image",
        node: mathImageNode,
      });
      continue;
    }

    tokenBuffer.push(token);
  }

  flushTokenBuffer();
  return result;
}

function tryBuildCanonicalTokenMathImageNode(token: CanonicalDetailToken): MathImageNode | null {
  if (normalizeUnknownText(token.type) !== "math_image") {
    return null;
  }

  const tokenRecord = token as CanonicalDetailToken & {
    asset?: unknown;
    alt?: unknown;
    text?: unknown;
    latex?: unknown;
  };
  const node: MathImageNode = {
    type: "math_image",
    latex: normalizeUnknownText(tokenRecord.latex),
    alt:
      normalizeUnknownText(tokenRecord.alt)
      || normalizeUnknownText(tokenRecord.text),
    asset: normalizeMathImageAsset(tokenRecord.asset),
  };

  if (!node.latex && !node.alt && !node.asset) {
    return null;
  }

  return node;
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

function buildCanonicalMathImageBlock(
  sectionKey: string,
  block: CanonicalMathImageBlock,
  blockIndex: number,
): DetailBlockView {
  const blockId = resolveCanonicalBlockId(sectionKey, block, blockIndex, "math-image");
  const asset = normalizeMathImageAsset(block.asset);
  const node: MathImageNode = {
    type: "math_image",
    latex: normalizeUnknownText(block.latex),
    alt:
      normalizeUnknownText(block.alt)
      || normalizeUnknownText((block as { text?: unknown }).text)
      || normalizeUnknownText((block as { title?: unknown }).title),
    asset,
  };

  return createMathImageBlock(blockId, node);
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
    const theoremBlocks = buildCanonicalTheoremBlocksFromItem(items[index], `${baseId}-${index + 1}`);
    if (theoremBlocks.length > 0) {
      result.push(...theoremBlocks);
    }
  }

  return result;
}

function buildCanonicalTheoremBlocksFromItem(
  item: CanonicalTheoremItem,
  blockId: string,
): DetailBlockView[] {
  const title = normalizeUnknownText(item.title);
  const descTokenFragments = splitCanonicalTokenFragments(normalizeCanonicalTokens(item.desc_tokens));
  const inlineDescTokens = descTokenFragments
    .filter(
      (fragment): fragment is Extract<CanonicalTokenFragment, { kind: "tokens" }> =>
        fragment.kind === "tokens",
    )
    .flatMap((fragment) => fragment.tokens);
  const descMathImages = descTokenFragments
    .filter(
      (fragment): fragment is Extract<CanonicalTokenFragment, { kind: "math_image" }> =>
        fragment.kind === "math_image",
    )
    .map((fragment) => fragment.node);
  const hasDescMathImage = descMathImages.length > 0;
  const descText = inlineDescTokens.length > 0
    ? composeCanonicalTokenPlainText(inlineDescTokens)
    : normalizeUnknownText(item.desc);
  const descSegments = inlineDescTokens.length > 0
    ? buildCanonicalInlineSegments(inlineDescTokens, `${blockId}-desc`)
    : [];
  const descHtml = descSegments.length > 0
    ? composeInlineSegmentHtml(descSegments)
    : renderMixedTextHtml(descText);
  const latex = normalizeUnknownText(item.latex);
  const mathResult = latex ? renderMath(latex, true) : null;

  if (hasDescMathImage) {
    const descParts = buildCanonicalTheoremDescParts(descTokenFragments, blockId);

    if (!title && descParts.length === 0 && !mathResult) {
      return [];
    }

    return [
      {
        id: blockId,
        kind: "theorem",
        title,
        titleHtml: title ? renderPlainTextHtml(title) : "",
        desc: descText,
        descHtml: "",
        descLeadHtml: "",
        descTailHtml: "",
        descParts,
        formulaText: mathResult?.source || "",
        formulaHtml: mathResult?.html || "",
      },
    ];
  }

  const descSplit = splitCanonicalTheoremDescByFormula(inlineDescTokens, latex, `${blockId}-desc`);
  const descLeadHtml = descSplit?.leadHtml || "";
  const descTailHtml = descSplit?.tailHtml || "";
  const mergedDescHtml = descSplit ? descLeadHtml : descHtml;

  if (!title && !descText && !mathResult) {
    return [];
  }

  return [
    {
      id: blockId,
      kind: "theorem",
      title,
      titleHtml: title ? renderPlainTextHtml(title) : "",
      desc: descText,
      descHtml: mergedDescHtml,
      descLeadHtml,
      descTailHtml,
      formulaText: mathResult?.source || "",
      formulaHtml: mathResult?.html || "",
    },
  ];
}

function buildCanonicalTheoremDescParts(
  fragments: CanonicalTokenFragment[],
  blockId: string,
): TheoremDescPartView[] {
  const result: TheoremDescPartView[] = [];

  for (let index = 0; index < fragments.length; index += 1) {
    const fragment = fragments[index];

    if (fragment.kind === "math_image") {
      result.push({
        kind: "math_image",
        image: fragment.node,
      });
      continue;
    }

    const tokens = fragment.tokens;
    if (tokens.length === 0) {
      continue;
    }

    const segments = buildCanonicalInlineSegments(tokens, `${blockId}-desc-part-${index + 1}`);
    const html = segments.length > 0
      ? composeInlineSegmentHtml(segments)
      : renderMixedTextHtml(composeCanonicalTokenPlainText(tokens));

    if (!html) {
      continue;
    }

    result.push({
      kind: "html",
      html,
    });
  }

  return result;
}

function splitCanonicalTheoremDescByFormula(
  tokens: CanonicalDetailToken[],
  formulaLatex: string,
  blockId: string,
): { leadHtml: string; tailHtml: string } | null {
  const normalizedFormula = normalizeFormulaCompareKey(formulaLatex);
  if (!normalizedFormula || tokens.length === 0) {
    return null;
  }

  let matchedIndex = -1;

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];
    if (token.type !== "math_inline") {
      continue;
    }

    const tokenLatex = normalizeUnknownText(token.latex);
    if (!tokenLatex) {
      continue;
    }

    if (normalizeFormulaCompareKey(tokenLatex) === normalizedFormula) {
      matchedIndex = index;
      break;
    }
  }

  if (matchedIndex < 0) {
    return null;
  }

  const leadSegments = buildCanonicalInlineSegments(
    tokens.slice(0, matchedIndex),
    `${blockId}-lead`,
  );
  const tailSegments = buildCanonicalInlineSegments(
    tokens.slice(matchedIndex + 1),
    `${blockId}-tail`,
  );

  return {
    leadHtml: leadSegments.length > 0 ? composeInlineSegmentHtml(leadSegments) : "",
    tailHtml: tailSegments.length > 0 ? composeInlineSegmentHtml(tailSegments) : "",
  };
}

function normalizeFormulaCompareKey(value: string): string {
  return normalizeUnknownText(value)
    .replace(/\s+/g, "")
    .replace(/[。．，,;；:：]+$/g, "");
}

function buildCanonicalInlineSegments(
  tokens: CanonicalDetailToken[],
  blockId: string,
): DetailInlineSegmentView[] {
  return buildStructuredSegments(buildCanonicalRawSegments(tokens), blockId);
}

function buildCanonicalRawSegments(tokens: CanonicalDetailToken[]): RawStructuredSegment[] {
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

  return rawSegments;
}

function createCanonicalTextBlock(
  sectionKey: string,
  blockId: string,
  text: string,
): DetailBlockView {
  const styledHtml = renderReadingStyledTextHtml(sectionKey, text);

  if (isCanonicalBulletSection(sectionKey)) {
    return {
      id: blockId,
      kind: "bullet",
      text,
      html: styledHtml || renderMixedTextHtml(text),
    };
  }

  return {
    id: blockId,
    kind: "text",
    text,
    html: styledHtml || renderMixedTextHtml(text),
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

  if (block.kind === "math_image") {
    return normalizeText(block.alt) || normalizeText(block.latex);
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

function normalizeCanonicalPdfFilename(detail: CanonicalConclusionDetail, pdfUrl: string): string {
  const directFilename = normalizeUnknownText(detail.pdf_filename);
  if (directFilename) {
    return directFilename;
  }

  return extractPdfFilenameFromUrl(pdfUrl);
}

function normalizeCanonicalPdfAvailable(detail: CanonicalConclusionDetail, pdfUrl: string): boolean {
  if (typeof detail.pdf_available === "boolean") {
    return detail.pdf_available;
  }

  return pdfUrl.length > 0;
}

/**
 * 统一生成详情页元信息展示字段：
 * - aliases / tags 做数组清洗
 * - difficulty 映射为稳定展示文案
 * - is_favorited 规范成只读状态标签
 */
function buildCanonicalDetailMetadata(detail: CanonicalConclusionDetail): DetailMetadataView {
  return buildDetailMetadata({
    aliases: detail.meta?.aliases,
    tags: detail.meta?.tags,
    difficulty: detail.meta?.difficulty,
    isFavorited: detail.is_favorited,
  });
}

/**
 * 本地模式沿用旧字段构造同一套元信息 view model，
 * 页面层无需区分远程/本地数据结构。
 */
function buildLegacyDetailMetadata(rawEntry: RawDetailEntry): DetailMetadataView {
  return buildDetailMetadata({
    aliases: rawEntry.alias,
    tags: rawEntry.tags,
    difficulty: rawEntry.difficulty,
    isFavorited: rawEntry.is_favorited ?? rawEntry.isFavorited,
  });
}

function buildDetailMetadata(input: {
  aliases: unknown;
  tags: unknown;
  difficulty: unknown;
  isFavorited: unknown;
}): DetailMetadataView {
  const aliases = normalizeUnknownTextList(input.aliases);
  const tags = normalizeUnknownTextList(input.tags);
  const difficultyDisplay = normalizeDifficultyDisplay(input.difficulty);
  const favoriteDisplay = normalizeFavoriteDisplay(input.isFavorited);

  return {
    aliases,
    tags,
    hasDifficulty: difficultyDisplay.hasDifficulty,
    difficultyLabel: difficultyDisplay.difficultyLabel,
    isFavorited: favoriteDisplay.isFavorited,
    showFavoriteStatus: favoriteDisplay.showFavoriteStatus,
    favoriteStatusText: favoriteDisplay.favoriteStatusText,
  };
}

function normalizeUnknownTextList(value: unknown): string[] {
  const source = Array.isArray(value) ? value : [value];
  const dedupe = new Set<string>();
  const result: string[] = [];

  for (let index = 0; index < source.length; index += 1) {
    const item = source[index];
    const normalized = typeof item === "string" ? normalizeText(item) : "";

    if (!normalized || dedupe.has(normalized)) {
      continue;
    }

    dedupe.add(normalized);
    result.push(normalized);
  }

  return result;
}

function normalizeDifficultyDisplay(value: unknown): {
  hasDifficulty: boolean;
  difficultyLabel: string;
} {
  if (typeof value === "number" && Number.isFinite(value)) {
    return formatNumericDifficulty(value);
  }

  if (typeof value === "string") {
    const normalized = normalizeText(value);
    if (!normalized) {
      return {
        hasDifficulty: false,
        difficultyLabel: "",
      };
    }

    const numeric = Number(normalized);
    if (Number.isFinite(numeric)) {
      return formatNumericDifficulty(numeric);
    }

    return {
      hasDifficulty: true,
      difficultyLabel: normalized,
    };
  }

  return {
    hasDifficulty: false,
    difficultyLabel: "",
  };
}

function formatNumericDifficulty(value: number): {
  hasDifficulty: boolean;
  difficultyLabel: string;
} {
  const roundedLevel = Math.round(value);
  const levelLabelMap: Record<number, string> = {
    1: "入门",
    2: "基础",
    3: "中等",
    4: "较难",
    5: "困难",
  };

  if (
    Number.isInteger(value)
    && roundedLevel >= 1
    && roundedLevel <= 5
  ) {
    return {
      hasDifficulty: true,
      difficultyLabel: `${levelLabelMap[roundedLevel]} (${roundedLevel})`,
    };
  }

  return {
    hasDifficulty: true,
    difficultyLabel: `${value}`,
  };
}

function normalizeFavoriteDisplay(value: unknown): {
  isFavorited: boolean;
  showFavoriteStatus: boolean;
  favoriteStatusText: string;
} {
  const parsed = parseUnknownBoolean(value);

  if (parsed === null) {
    return {
      isFavorited: false,
      showFavoriteStatus: false,
      favoriteStatusText: "",
    };
  }

  return {
    isFavorited: parsed,
    showFavoriteStatus: true,
    favoriteStatusText: parsed ? "已收藏" : "未收藏",
  };
}

function parseUnknownBoolean(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }

  if (typeof value === "number") {
    if (value === 1) {
      return true;
    }
    if (value === 0) {
      return false;
    }
    return null;
  }

  if (typeof value === "string") {
    const normalized = normalizeText(value).toLowerCase();
    if (!normalized) {
      return null;
    }

    if (normalized === "1" || normalized === "true") {
      return true;
    }

    if (normalized === "0" || normalized === "false") {
      return false;
    }
  }

  return null;
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

// Dev-only math_image smoke test:
// - Keep disabled by default.
// - Temporarily set to true only when validating math_image rendering in develop env.
const ENABLE_DEV_MATH_IMAGE_NODE = false;
const MATH_IMAGE_DIRECT_MIN_WIDTH_PX = 16;
const MATH_IMAGE_DERIVED_MIN_WIDTH_PX = 80;
const MATH_IMAGE_DEFAULT_WIDTH_PX = 280;
const DEV_DEMO_MATH_IMAGE_NODE: MathImageNode = {
  type: "math_image",
  latex:
    "\\begin{aligned}\\frac{2}{\\dfrac{1}{a}+\\dfrac{1}{b}} &\\leq \\sqrt{ab} \\\\ &\\leq \\frac{a+b}{2} \\\\ &\\leq \\sqrt{\\frac{a^{2}+b^{2}}{2}}.\\end{aligned}",
  asset: {
    png: "https://ok-shuxue.cloud/static/formulas/ineq_mean_chain_demo@3x.png",
    webp: "https://ok-shuxue.cloud/static/formulas/ineq_mean_chain_demo@3x.webp",
    width_px: 960,
    height_px: 360,
    display_width_px: 320,
    display_height_px: 120,
    scale: 3,
  },
  alt: "均值不等式链",
};

function createMathImageBlock(blockId: string, node: MathImageNode): DetailBlockView {
  const normalizedAsset = normalizeMathImageAsset(node.asset);
  const normalizedNode = normalizeMathImageNode(
    {
      ...node,
      asset: normalizedAsset,
    },
    "",
  );

  return {
    id: blockId,
    kind: "math_image",
    ...normalizedNode,
  };
}

function normalizeMathImageNode(node: MathImageNode, nodePath: string): MathImageNode {
  const normalized: MathImageNode = {
    type: "math_image",
    latex: normalizeText(node.latex),
    alt: normalizeText(node.alt),
    asset: normalizeMathImageAsset(node.asset),
    imageUrl: getMathImageUrl(node),
    displayWidth: getMathImageDisplayWidth(node),
    imageLoadFailed: false,
  };

  if (nodePath) {
    normalized.__path = nodePath;
  }

  return normalized;
}

function normalizeMathImageBlocksInSections(sections: DetailSectionView[]): DetailSectionView[] {
  if (!Array.isArray(sections)) {
    return [];
  }

  return sections.map((section) => ({
    ...section,
    blocks: section.blocks.map((block, blockIndex) => {
      if (block.kind === "math_image") {
        const normalizedNode = normalizeMathImageNode(
          {
            type: "math_image",
            latex: block.latex,
            alt: block.alt,
            asset: block.asset,
          },
          `section.blocks[${blockIndex}]`,
        );

        return {
          ...block,
          ...normalizedNode,
        };
      }

      if (block.kind !== "theorem") {
        return block;
      }

      let descParts = block.descParts;
      if (Array.isArray(descParts)) {
        descParts = descParts.map((part, partIndex) => {
          if (part.kind !== "math_image" || !part.image) {
            return part;
          }

          return {
            ...part,
            image: normalizeMathImageNode(
              {
                type: "math_image",
                latex: part.image.latex,
                alt: part.image.alt,
                asset: part.image.asset,
              },
              `section.blocks[${blockIndex}].descParts[${partIndex}].image`,
            ),
          };
        });
      }

      let formulaImages = block.formulaImages;
      if (Array.isArray(formulaImages)) {
        formulaImages = formulaImages.map((node, imageIndex) =>
          normalizeMathImageNode(
            {
              type: "math_image",
              latex: node.latex,
              alt: node.alt,
              asset: node.asset,
            },
            `section.blocks[${blockIndex}].formulaImages[${imageIndex}]`,
          )
        );
      }

      return {
        ...block,
        descParts,
        formulaImages,
      };
    }),
  }));
}

function maybeInjectDevMathImageNode(sections: DetailSectionView[]): DetailSectionView[] {
  if (!shouldInjectDevMathImageNode() || sections.length === 0) {
    return sections;
  }

  const firstSection = sections[0];
  const demoBlockId = `${firstSection.key}-dev-math-image`;
  const hasDemoNode = firstSection.blocks.some((block) => block.id === demoBlockId);
  if (hasDemoNode) {
    return sections;
  }

  return [
    {
      ...firstSection,
      blocks: [
        ...firstSection.blocks,
        createMathImageBlock(demoBlockId, DEV_DEMO_MATH_IMAGE_NODE),
      ],
    },
    ...sections.slice(1),
  ];
}

function shouldInjectDevMathImageNode(): boolean {
  if (!ENABLE_DEV_MATH_IMAGE_NODE) {
    return false;
  }

  if (typeof wx === "undefined" || typeof wx.getAccountInfoSync !== "function") {
    return false;
  }

  try {
    const envVersion = wx.getAccountInfoSync()?.miniProgram?.envVersion;
    return envVersion === "develop";
  } catch (_error) {
    return false;
  }
}

function normalizeMathImageAsset(asset: unknown): DetailMathImageAsset | undefined {
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) {
    return undefined;
  }

  const raw = asset as CanonicalMathImageAsset;
  const normalized: DetailMathImageAsset = {
    png: normalizeUnknownText(raw.png),
    webp: normalizeUnknownText(raw.webp),
    width_px: normalizeUnknownPositiveNumber(raw.width_px),
    height_px: normalizeUnknownPositiveNumber(raw.height_px),
    display_width_px: normalizeUnknownPositiveNumber(raw.display_width_px),
    display_height_px: normalizeUnknownPositiveNumber(raw.display_height_px),
    scale: normalizeUnknownPositiveNumber(raw.scale),
  };

  return normalized;
}

function normalizeUnknownPositiveNumber(value: unknown): number | undefined {
  const numberValue =
    typeof value === "number"
      ? value
      : typeof value === "string"
        ? Number(normalizeText(value))
        : Number.NaN;

  if (!Number.isFinite(numberValue) || numberValue <= 0) {
    return undefined;
  }

  return numberValue;
}

function getMathImageUrl(node: MathImageNode): string {
  const selectedPath = normalizeText(node.asset?.png) || normalizeText(node.asset?.webp) || "";
  return buildAbsoluteApiUrl(selectedPath);
}

function getMathImageDisplayWidth(node: MathImageNode): number {
  const asset = node.asset;
  const directWidth = asset?.display_width_px;

  if (typeof directWidth === "number" && directWidth > 0) {
    // Canonical display_width_px is editorial output. Respect it to avoid
    // over-scaling narrow formulas like "2/3" into oversized display blocks.
    return Math.max(MATH_IMAGE_DIRECT_MIN_WIDTH_PX, Math.round(directWidth));
  }

  if (
    typeof asset?.width_px === "number"
    && typeof asset?.scale === "number"
    && asset.scale > 0
  ) {
    return Math.max(MATH_IMAGE_DERIVED_MIN_WIDTH_PX, Math.round(asset.width_px / asset.scale));
  }

  return MATH_IMAGE_DEFAULT_WIDTH_PX;
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
      detailContentLogger.error("load_detail_content_failed", {
        error,
      });
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
  const sections = normalizeMathImageBlocksInSections(
    maybeInjectDevMathImageNode(buildSections(rawEntry, summary)),
  );
  const pdfUrl = getPreferredPdfUrl(id, rawEntry);
  const pdfFilename = getPreferredPdfFilename(rawEntry, pdfUrl);
  const metadata = buildLegacyDetailMetadata(rawEntry);

  return {
    id: normalizeText(rawEntry.id) || id,
    summary,
    summaryHtml: renderMixedTextHtml(summary),
    aliases: metadata.aliases,
    tags: metadata.tags,
    hasDifficulty: metadata.hasDifficulty,
    difficultyLabel: metadata.difficultyLabel,
    isFavorited: metadata.isFavorited,
    showFavoriteStatus: metadata.showFavoriteStatus,
    favoriteStatusText: metadata.favoriteStatusText,
    pdfUrl,
    pdfFilename,
    pdfAvailable: typeof rawEntry.pdfAvailable === "boolean"
      ? rawEntry.pdfAvailable
      : pdfUrl.length > 0,
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

  if (normalizeText(rawItem.type) === "math_image") {
    return createStructuredMathImageBlock(section, blockId, rawItem);
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

function shouldApplyReadingHeadingStyle(sectionKey: string): boolean {
  return Boolean(getReadingSectionRule(sectionKey));
}

function getReadingSectionRule(sectionKey: string): ReadingSectionRule | null {
  return READING_SECTION_RULES[sectionKey] || null;
}

function escapeRegExpLiteral(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function getReadingItemLinePattern(sectionKey: string): RegExp | null {
  const rule = getReadingSectionRule(sectionKey);
  if (!rule) {
    return null;
  }

  if (rule.itemLinePattern) {
    return rule.itemLinePattern;
  }

  if (rule.itemPrefixes.length === 0) {
    return null;
  }

  const prefixPattern = rule.itemPrefixes
    .map((prefix) => escapeRegExpLiteral(prefix))
    .join("|");

  return new RegExp(
    `^((?:${prefixPattern})${READING_INDEX_MARKER_PATTERN.source}(?:[（(][^）)]*[）)])?)(?:\\s*([：:])\\s*(.*))?$`,
  );
}

function isReadingSubheadingLine(sectionKey: string, line: string): boolean {
  const rule = getReadingSectionRule(sectionKey);
  if (!rule) {
    return false;
  }

  const normalized = normalizeText(line)
    .replace(/[：:]+\s*$/, "")
    .trim();

  if (!normalized) {
    return false;
  }

  return rule.subheadingPattern.test(normalized);
}

function parseReadingItemLineText(
  sectionKey: string,
  line: string,
): { label: string; body: string; hasColon: boolean } | null {
  const normalized = normalizeText(line);
  if (!normalized) {
    return null;
  }

  const itemLinePattern = getReadingItemLinePattern(sectionKey);
  if (!itemLinePattern) {
    return null;
  }

  const matched = normalized.match(itemLinePattern);
  if (!matched) {
    return null;
  }

  const label = normalizeText(matched[1]);
  const colon = normalizeText(matched[2]);
  const body = normalizeText(matched[3]);

  if (!label) {
    return null;
  }

  return {
    label: colon ? `${label}${colon}` : label,
    body,
    hasColon: Boolean(colon),
  };
}

function wrapReadingSubheadingHtml(sectionKey: string, html: string): string {
  const rule = getReadingSectionRule(sectionKey);
  if (!rule || !html) {
    return "";
  }

  return `<span style="display:inline;color:${rule.subheadingColor};font-weight:700;">${html}</span>`;
}

function wrapReadingItemLabelHtml(html: string): string {
  if (!html) {
    return "";
  }

  return `<span style="display:inline;color:${READING_ITEM_TITLE_COLOR};font-weight:700;">${html}</span>`;
}

function normalizeReadingLabelText(text: string): string {
  return normalizeText(text)
    .replace(/[：:]+\s*$/, "")
    .trim();
}

function shouldUseSubheadingLabelStyle(sectionKey: string, labelText: string): boolean {
  const normalizedLabel = normalizeReadingLabelText(labelText);
  if (!normalizedLabel) {
    return false;
  }

  return isReadingSubheadingLine(sectionKey, normalizedLabel);
}

function wrapReadingLineLabelHtml(
  sectionKey: string,
  labelText: string,
  labelHtml: string,
): string {
  if (shouldUseSubheadingLabelStyle(sectionKey, labelText)) {
    return wrapReadingSubheadingHtml(sectionKey, labelHtml);
  }

  return wrapReadingItemLabelHtml(labelHtml);
}

function renderReadingStyledTextHtml(sectionKey: string, text: string): string | null {
  if (!shouldApplyReadingHeadingStyle(sectionKey) || !text) {
    return null;
  }

  const lines = text.split(/\r?\n/);
  const renderedLines: string[] = [];
  let hasStyledLine = false;

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const normalizedLine = normalizeText(line);

    if (!normalizedLine) {
      renderedLines.push("");
      continue;
    }

    const baseLineHtml = renderPlainTextHtml(line, true);

    if (isReadingSubheadingLine(sectionKey, normalizedLine)) {
      hasStyledLine = true;
      renderedLines.push(wrapReadingSubheadingHtml(sectionKey, baseLineHtml));
      continue;
    }

    const itemLine = parseReadingItemLineText(sectionKey, normalizedLine);
    if (!itemLine) {
      renderedLines.push(baseLineHtml);
      continue;
    }

    hasStyledLine = true;
    const labelHtml = wrapReadingLineLabelHtml(
      sectionKey,
      itemLine.label,
      renderPlainTextHtml(itemLine.label, true),
    );
    if (!itemLine.hasColon || !itemLine.body) {
      renderedLines.push(labelHtml);
      continue;
    }

    renderedLines.push(`${labelHtml}${renderPlainTextHtml(itemLine.body, true)}`);
  }

  if (!hasStyledLine) {
    return null;
  }

  return renderedLines.join("<br/>");
}

function pushRawTextSegment(target: RawStructuredSegment[], text: string) {
  if (!text) {
    return;
  }

  const previous = target[target.length - 1];
  if (previous && previous.type !== "math") {
    previous.text = `${previous.text || ""}${text}`;
    return;
  }

  target.push({
    type: "text",
    text,
  });
}

function splitRawSegmentsByLine(segments: RawStructuredSegment[]): RawStructuredSegment[][] {
  const lines: RawStructuredSegment[][] = [[]];

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const activeLine = lines[lines.length - 1];

    if (segment.type === "math") {
      const latex = normalizeText(segment.latex);
      if (!latex) {
        continue;
      }

      activeLine.push({
        type: "math",
        latex,
      });
      continue;
    }

    const rawText = normalizeInlineText(segment.text);
    if (!rawText) {
      continue;
    }

    const parts = rawText.split("\n");
    for (let partIndex = 0; partIndex < parts.length; partIndex += 1) {
      pushRawTextSegment(lines[lines.length - 1], parts[partIndex]);

      if (partIndex < parts.length - 1) {
        lines.push([]);
      }
    }
  }

  return lines;
}

function composeRawSegmentPlainText(segments: RawStructuredSegment[]): string {
  return segments
    .map((segment) => {
      if (segment.type === "math") {
        return normalizeText(segment.latex);
      }

      return normalizeText(segment.text);
    })
    .join("");
}

function splitRawSegmentsAtFirstColon(segments: RawStructuredSegment[]): {
  labelSegments: RawStructuredSegment[];
  bodySegments: RawStructuredSegment[];
  hasColon: boolean;
} {
  const labelSegments: RawStructuredSegment[] = [];
  const bodySegments: RawStructuredSegment[] = [];
  let seenColon = false;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];

    if (segment.type === "math") {
      const latex = normalizeText(segment.latex);
      if (!latex) {
        continue;
      }

      const target = seenColon ? bodySegments : labelSegments;
      target.push({
        type: "math",
        latex,
      });
      continue;
    }

    const rawText = segment.text || "";
    if (!rawText) {
      continue;
    }

    if (seenColon) {
      pushRawTextSegment(bodySegments, rawText);
      continue;
    }

    const colonIndex = rawText.search(/[：:]/);
    if (colonIndex < 0) {
      pushRawTextSegment(labelSegments, rawText);
      continue;
    }

    pushRawTextSegment(labelSegments, rawText.slice(0, colonIndex + 1));
    seenColon = true;
    pushRawTextSegment(bodySegments, rawText.slice(colonIndex + 1));
  }

  return {
    labelSegments,
    bodySegments,
    hasColon: seenColon,
  };
}

function composeReadingStyledInlineHtml(
  sectionKey: string,
  blockId: string,
  sourceSegments: RawStructuredSegment[],
): string | null {
  if (!shouldApplyReadingHeadingStyle(sectionKey) || sourceSegments.length === 0) {
    return null;
  }

  const lines = splitRawSegmentsByLine(sourceSegments);
  const renderedLines: string[] = [];
  let hasStyledLine = false;

  for (let index = 0; index < lines.length; index += 1) {
    const lineSegments = normalizeInlineSegments(lines[index]);
    if (lineSegments.length === 0) {
      renderedLines.push("");
      continue;
    }

    const lineId = `${blockId}-line-${index + 1}`;
    const baseLineHtml = composeInlineSegmentHtml(
      buildStructuredSegments(lineSegments, lineId),
    );
    const lineText = normalizeText(composeRawSegmentPlainText(lineSegments));

    if (!lineText) {
      renderedLines.push(baseLineHtml);
      continue;
    }

    if (isReadingSubheadingLine(sectionKey, lineText)) {
      hasStyledLine = true;
      renderedLines.push(wrapReadingSubheadingHtml(sectionKey, baseLineHtml));
      continue;
    }

    const itemLine = parseReadingItemLineText(sectionKey, lineText);
    if (!itemLine) {
      renderedLines.push(baseLineHtml);
      continue;
    }

    hasStyledLine = true;
    const split = splitRawSegmentsAtFirstColon(lineSegments);
    if (!split.hasColon) {
      renderedLines.push(
        wrapReadingLineLabelHtml(sectionKey, itemLine.label, baseLineHtml),
      );
      continue;
    }

    const labelHtml = composeInlineSegmentHtml(
      buildStructuredSegments(
        normalizeInlineSegments(split.labelSegments),
        `${lineId}-label`,
      ),
    );
    const bodyHtml = composeInlineSegmentHtml(
      buildStructuredSegments(
        normalizeInlineSegments(split.bodySegments),
        `${lineId}-body`,
      ),
    );

    if (!bodyHtml) {
      renderedLines.push(
        wrapReadingLineLabelHtml(
          sectionKey,
          composeRawSegmentPlainText(split.labelSegments),
          labelHtml || baseLineHtml,
        ),
      );
      continue;
    }

    renderedLines.push(
      `${wrapReadingLineLabelHtml(
        sectionKey,
        composeRawSegmentPlainText(split.labelSegments),
        labelHtml,
      )}${bodyHtml}`,
    );
  }

  if (!hasStyledLine) {
    return null;
  }

  return renderedLines.join("<br/>");
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
  const styledHtml = renderReadingStyledTextHtml(section.key, text);

  if (section.layout === "list" || section.key === "variables") {
    return {
      id: blockId,
      kind: "bullet",
      text,
      html: styledHtml || renderPlainTextHtml(text),
    };
  }

  return {
    id: blockId,
    kind: "text",
    text,
    html: styledHtml || renderPlainTextHtml(text),
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

function createStructuredMathImageBlock(
  _section: DetailSectionView,
  blockId: string,
  rawItem: RawStructuredItem,
): DetailBlockView {
  const asset = normalizeMathImageAsset(rawItem.asset);
  const node: MathImageNode = {
    type: "math_image",
    latex: normalizeText(rawItem.latex),
    alt: normalizeText(rawItem.alt || rawItem.text || rawItem.desc),
    asset,
  };

  return createMathImageBlock(blockId, node);
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
  const normalizedSource = normalizeInlineSegments(sourceSegments);
  const normalizedSegments = buildStructuredSegments(normalizedSource, blockId);
  const styledHtml = composeReadingStyledInlineHtml(section.key, blockId, normalizedSource);
  const inlineHtml = styledHtml || composeInlineSegmentHtml(normalizedSegments);

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
    blocks: section.blocks.map((block) => decorateLegacyBlock(block, section.key)),
  }));
}

/**
 * 给单个 legacy block 补充 HTML。
 *
 * 说明：
 * - text / bullet 会走 mixed-text 渲染，以兼容旧文本中夹杂的简单公式。
 * - theorem 需要分别装饰标题和描述。
 */
function decorateLegacyBlock(block: DetailBlockView, sectionKey = ""): DetailBlockView {
  if (block.kind === "text" || block.kind === "bullet") {
    const styledHtml = renderReadingStyledTextHtml(sectionKey, block.text || "");
    return {
      ...block,
      html: styledHtml || renderMixedTextHtml(block.text),
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
  const hasChinese = /[一-龥]/.test(candidate);
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
      || rawEntry.primary_formula
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
    || extractPrimaryFormulaLatex(rawEntry.primary_formula)
    || getFirstFormulaFromSections(sections)
  );
}

type PrimaryFormulaResolved = {
  latex: string;
  image?: MathImageNode;
};

function resolvePrimaryFormula(
  primaryFormula: RawPrimaryFormula | CanonicalPrimaryFormula | string | unknown,
): PrimaryFormulaResolved {
  if (typeof primaryFormula === "string") {
    return {
      latex: normalizeText(primaryFormula),
    };
  }

  if (!primaryFormula || typeof primaryFormula !== "object" || Array.isArray(primaryFormula)) {
    return {
      latex: "",
    };
  }

  const rawFormula = primaryFormula as {
    latex?: unknown;
    type?: unknown;
    need_image?: unknown;
    asset?: unknown;
    alt?: unknown;
  };
  const latex = normalizeUnknownText(rawFormula.latex);

  if (!isPrimaryFormulaMathImageType(rawFormula.type)) {
    return {
      latex,
    };
  }

  return {
    latex,
    image: normalizeMathImageNode(
      {
        type: "math_image",
        latex,
        alt: normalizeUnknownText(rawFormula.alt),
        asset: normalizeMathImageAsset(rawFormula.asset),
      },
      "coreFormulaImage",
    ),
  };
}

function extractPrimaryFormulaLatex(
  primaryFormula: RawPrimaryFormula | CanonicalPrimaryFormula | string | unknown,
): string {
  return resolvePrimaryFormula(primaryFormula).latex;
}

function isPrimaryFormulaMathImageType(value: unknown): boolean {
  return normalizeUnknownText(value) === "math_image";
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

function getPreferredPdfFilename(rawEntry: RawDetailEntry, pdfUrl: string): string {
  const directFilename = normalizeText(rawEntry.pdfFilename);
  if (directFilename) {
    return directFilename;
  }

  return extractPdfFilenameFromUrl(pdfUrl);
}

function extractPdfFilenameFromUrl(pdfUrl: string): string {
  const normalizedUrl = normalizeText(pdfUrl);
  if (!normalizedUrl) {
    return "";
  }

  const cleanUrl = normalizedUrl.split(/[?#]/, 1)[0];
  const parts = cleanUrl.split("/").filter((part) => part.length > 0);

  return parts.length > 0 ? parts[parts.length - 1] : "";
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
