import { SEARCH_API_CONFIG } from "../config/api";
import { loadSearchBundleFallback } from "./data-loader";
import { request } from "./request";

/**
 * 本地搜索引擎。
 *
 * 这个文件负责消费 `data/index/search_bundle.js`，并提供搜索页需要的几种能力：
 * - 初始化索引
 * - 读取搜索库元信息
 * - 联想建议
 * - 查询结果
 * - 调试信息输出
 *
 * 设计目标：
 * 1. 保持搜索页调用简单，页面只关心“给我 suggestions / results / debug”。
 * 2. 保持搜索逻辑完全本地化，不依赖网络。
 * 3. 兼顾可解释性，所以除了结果，还额外保留匹配原因与命中字段。
 *
 * 推荐阅读顺序：
 * 1. `initSearchEngine`
 * 2. `searchWithDebug`
 * 3. `collectSuggestions`
 * 4. `mergeIndexEntries`
 * 5. `finalizeResults`
 */
type SearchIndexTuple = [string, number, number];
type SearchSuggestionTuple = [string, string, number];

/**
 * `SearchDoc` 表示搜索索引中的单个文档。
 * 搜索页最终展示的标题、摘要、分类、核心公式等，基本都来自这里。
 */
export interface SearchDoc {
  id: string;
  module: string;
  moduleDir: string;
  title: string;
  summary?: string;
  category?: string;
  tags?: string[];
  coreFormula?: string;
  rank?: number;
  difficulty?: number;
  searchBoost?: number;
  hotScore?: number;
  examFrequency?: number;
  examScore?: number;
  isFavorited?: boolean;
}

interface SearchBundle {
  version: number;
  generatedAt: string;
  fieldMaskLegend: Record<string, number>;
  docs: Record<string, SearchDoc>;
  termIndex: Record<string, SearchIndexTuple[]>;
  prefixIndex: Record<string, SearchIndexTuple[]>;
  suggestions: SearchSuggestionTuple[];
}

export interface SearchSuggestion {
  text: string;
  id: string;
  score: number;
  title?: string;
  subtitle?: string;
  route?: string;
  module?: string;
  difficulty?: number;
  tags?: string[];
  matchType?: string;
  matchField?: string;
  matchedText?: string;
  badge?: string;
}

export interface SearchMatchReason {
  source: "term" | "prefix" | "suggestion";
  token: string;
  score: number;
  fields: string[];
}

export interface SearchResult {
  id: string;
  score: number;
  doc: SearchDoc;
  reasons: SearchMatchReason[];
  matchedFields: string[];
}

export interface SearchDebugMatch {
  id: string;
  title: string;
  score: number;
  matchedFieldsLabel: string;
  reasonSummary: string;
}

export interface SearchDebugInfo {
  normalizedQuery: string;
  lookupTokens: string[];
  termHitCount: number;
  prefixHitCount: number;
  suggestionHitCount: number;
  resultCount: number;
  fallbackUsed: boolean;
  topSuggestions: SearchSuggestion[];
  topMatches: SearchDebugMatch[];
}

export interface SearchResponse {
  query: string;
  normalizedQuery: string;
  suggestions: SearchSuggestion[];
  results: SearchResult[];
  debug: SearchDebugInfo;
}

export interface SearchMeta {
  totalDocs: number;
  hotDocCount: number;
  highExamFrequencyCount: number;
  categories: string[];
  generatedAt: string;
}

export type SearchSource = "remote" | "local";

export interface SearchFacetBucket<TValue extends string | number = string | number> {
  value: TValue;
  count: number;
}

export type SearchFacets = Record<string, SearchFacetBucket[]> & {
  module?: SearchFacetBucket<string>[];
  difficulty?: SearchFacetBucket<number>[];
  tags?: SearchFacetBucket<string>[];
};

export interface SearchViewItem {
  id: string;
  title: string;
  module: string;
  moduleDir: string;
  category: string;
  tags: string[];
  summary: string;
  snippet: string;
  coreFormula: string;
  difficulty?: number;
  rank?: number;
  searchBoost?: number;
  hotScore?: number;
  examFrequency?: number;
  examScore?: number;
  searchScore: number;
  moduleLabel: string;
  difficultyLabel: string;
  badgeList: string[];
  isFavorited: boolean;
}

export interface SearchFacadeResponse {
  query: string;
  normalizedQuery: string;
  total: number;
  page: number;
  pageSize: number;
  items: SearchViewItem[];
  facets: SearchFacets;
  debug: SearchDebugInfo;
  source: SearchSource;
}

export interface SuggestFacadeResponse {
  query: string;
  normalizedQuery: string;
  total: number;
  emptyHint: string;
  suggestions: SearchSuggestion[];
  source: SearchSource;
}

interface RemoteSearchFacetBucketRaw {
  value?: string | number;
  count?: number;
}

interface RemoteSearchItemRaw {
  id?: string;
  module?: string;
  moduleDir?: string;
  title?: string;
  summary?: string;
  statement_clean?: string;
  snippet?: string;
  category?: string;
  tags?: string[];
  coreFormula?: string;
  rank?: number;
  difficulty?: number;
  searchBoost?: number;
  hotScore?: number;
  examFrequency?: number;
  examScore?: number;
  score?: number;
  is_favorited?: boolean;
  isFavorited?: boolean;
}

interface RemoteSearchDataRaw {
  query?: string;
  total?: number;
  page?: number;
  page_size?: number;
  items?: RemoteSearchItemRaw[];
  facets?: Record<string, RemoteSearchFacetBucketRaw[]>;
}

interface RemoteSuggestItemRaw {
  id?: string;
  title?: string;
  subtitle?: string;
  route?: string;
  module?: string;
  difficulty?: number;
  tags?: string[];
  match_type?: string;
  match_field?: string;
  matched_text?: string;
  score?: number;
  badge?: string;
}

interface RemoteSuggestDataRaw {
  query?: string;
  total?: number;
  empty_hint?: string;
  items?: RemoteSuggestItemRaw[];
}

interface SearchAccumulator {
  id: string;
  score: number;
  doc: SearchDoc;
  reasons: SearchMatchReason[];
  matchedFieldMap: Record<string, true>;
}

type DebugWx = WechatMiniprogram.Wx & {
  debugSearchBundle?: SearchBundle;
  debugSearchEngine?: SearchResponse;
};

/**
 * 这些常量控制搜索体验：
 * - 联想词最多显示多少条
 * - 最终结果最多保留多少条
 * - 单个 token 最多扫描多少条索引记录
 * - prefix 匹配和 suggestion fallback 的权重
 */
const MAX_SUGGEST = 8;
const MAX_RESULTS = 20;
const MAX_INDEX_SCAN = 32;
const PREFIX_WEIGHT = 0.72;
const SUGGESTION_FALLBACK_WEIGHT = 0.9;

let SEARCH_BUNDLE: SearchBundle | null = null;
let FIELD_MASK_ENTRIES: Array<{ name: string; mask: number }> = [];

/**
 * 校验加载到的搜索 bundle 是否至少具备搜索所需的核心字段。
 */
function isValidSearchBundle(bundle: Partial<SearchBundle> | null): bundle is SearchBundle {
  return !!bundle
    && !!bundle.docs
    && !!bundle.termIndex
    && !!bundle.prefixIndex
    && !!bundle.suggestions
    && !!bundle.fieldMaskLegend;
}

/**
 * 初始化搜索引擎。
 *
 * 主要职责：
 * 1. 加载构建产物 `search_bundle.js`。
 * 2. 验证 bundle 结构是否可用。
 * 3. 缓存 bundle，避免重复 require。
 * 4. 把 field mask legend 整理成更适合运行时解码的数组。
 *
 * 这是搜索页第一次进入时最先调用的函数。
 */
export function initSearchEngine() {
  if (SEARCH_BUNDLE) {
    return;
  }

  try {
    const loadedBundle = loadSearchBundleFallback() as Partial<SearchBundle> | null;

    if (!isValidSearchBundle(loadedBundle)) {
      throw new Error("Invalid search bundle payload");
    }

    SEARCH_BUNDLE = loadedBundle;
    FIELD_MASK_ENTRIES = Object.keys(SEARCH_BUNDLE.fieldMaskLegend)
      .map((name) => ({
        name,
        mask: SEARCH_BUNDLE!.fieldMaskLegend[name],
      }))
      .sort((left, right) => left.mask - right.mask);

    if (typeof wx !== "undefined") {
      (wx as DebugWx).debugSearchBundle = SEARCH_BUNDLE;
    }

    console.log("Search bundle ready");
  } catch (error) {
    SEARCH_BUNDLE = null;
    FIELD_MASK_ENTRIES = [];
    console.error("Search bundle init failed", error);
  }
}

/**
 * 返回搜索库元信息。
 *
 * 使用场景：
 * - 搜索页头部统计
 * - 分类 tab 初始化
 * - 展示搜索库生成时间等信息
 */
export function getSearchMeta(): SearchMeta {
  const bundle = getBundle();

  if (!bundle) {
    return {
      totalDocs: 0,
      hotDocCount: 0,
      highExamFrequencyCount: 0,
      categories: [],
      generatedAt: "",
    };
  }

  const categories: string[] = [];
  const categorySeen: Record<string, true> = {};
  let hotDocCount = 0;
  let highExamFrequencyCount = 0;

  for (const id in bundle.docs) {
    const doc = bundle.docs[id];

    if ((doc.hotScore || 0) >= 80) {
      hotDocCount += 1;
    }

    if ((doc.examFrequency || 0) >= 0.8) {
      highExamFrequencyCount += 1;
    }

    if (doc.category && !categorySeen[doc.category]) {
      categorySeen[doc.category] = true;
      categories.push(doc.category);
    }
  }

  return {
    totalDocs: Object.keys(bundle.docs).length,
    hotDocCount,
    highExamFrequencyCount,
    categories,
    generatedAt: bundle.generatedAt,
  };
}

/**
 * 按 id 获取搜索文档原始信息。
 * 主要用于需要从搜索索引里读取某条文档元数据的场景。
 */
export function getSearchDocument(id: string): SearchDoc | null {
  const bundle = getBundle();

  if (!bundle || !bundle.docs[id]) {
    return null;
  }

  return bundle.docs[id];
}

/**
 * 联想建议入口。
 *
 * 输出的是建议词列表，不做最终结果排序。
 * 通常用于搜索框下方的 suggestion 区域。
 */
export function suggest(query: string): SearchSuggestion[] {
  const bundle = getBundle();
  const normalizedQuery = normalize(query);

  if (!bundle || !normalizedQuery) {
    return [];
  }

  return collectSuggestions(bundle, normalizedQuery, MAX_SUGGEST);
}

/**
 * 面向简单调用者的搜索入口，只返回结果 id 列表。
 * 更完整的页面场景通常使用 `searchWithDebug`。
 */
export function search(query: string): string[] {
  return searchWithDebug(query).results.map((item) => item.id);
}

/**
 * 搜索主入口。
 *
 * 输入：
 * - `query`：用户原始输入。
 *
 * 输出：
 * - `SearchResponse`
 *   - `suggestions`：联想词
 *   - `results`：排序后的命中文档
 *   - `debug`：命中 token、命中次数、fallback 情况、top matches 等调试信息
 *
 * 处理流程：
 * 1. 归一化 query。
 * 2. 基于 query 先收集 suggestions。
 * 3. 构建 lookup tokens，同时查 termIndex 和 prefixIndex。
 * 4. 把命中信息合并进 accumulator。
 * 5. 若完全没有结果，则退回 suggestion fallback。
 * 6. 排序并裁剪结果。
 */
export function searchWithDebug(query: string): SearchResponse {
  const bundle = getBundle();
  const normalizedQuery = normalize(query);

  if (!bundle || !normalizedQuery) {
    return createEmptyResponse(query, normalizedQuery);
  }

  const suggestions = collectSuggestions(bundle, normalizedQuery, MAX_SUGGEST);
  const lookupTokens = buildLookupTokens(normalizedQuery);
  const accumulatorMap: Record<string, SearchAccumulator> = {};

  let termHitCount = 0;
  let prefixHitCount = 0;

  for (let index = 0; index < lookupTokens.length; index += 1) {
    const token = lookupTokens[index];
    const termEntries = bundle.termIndex[token] || [];
    const prefixEntries = bundle.prefixIndex[token] || [];

    termHitCount += termEntries.length;
    prefixHitCount += prefixEntries.length;

    mergeIndexEntries(accumulatorMap, bundle, termEntries, "term", token, 1);
    mergeIndexEntries(accumulatorMap, bundle, prefixEntries, "prefix", token, PREFIX_WEIGHT);
  }

  let fallbackUsed = false;

  if (Object.keys(accumulatorMap).length === 0 && suggestions.length > 0) {
    fallbackUsed = true;
    mergeSuggestionEntries(accumulatorMap, bundle, suggestions, SUGGESTION_FALLBACK_WEIGHT);
  }

  const results = finalizeResults(accumulatorMap);
  const debug: SearchDebugInfo = {
    normalizedQuery,
    lookupTokens,
    termHitCount,
    prefixHitCount,
    suggestionHitCount: suggestions.length,
    resultCount: results.length,
    fallbackUsed,
    topSuggestions: suggestions.slice(0, 5),
    topMatches: buildTopMatches(results),
  };

  const response: SearchResponse = {
    query,
    normalizedQuery,
    suggestions,
    results,
    debug,
  };

  if (typeof wx !== "undefined") {
    (wx as DebugWx).debugSearchEngine = response;
  }

  return response;
}

/**
 * 统一搜索入口（页面层应优先使用这个方法）。
 *
 * 行为：
 * 1. `USE_REMOTE_API=true` 时优先请求后端；失败后自动回退本地索引。
 * 2. `USE_REMOTE_API=false` 时只走本地索引。
 * 3. 不把后端原始结构暴露给页面，只返回统一的前端模型。
 */
/**
 * 统一 suggest 入口（与 search 解耦）。
 */
export async function suggestWithFacade(query: string): Promise<SuggestFacadeResponse> {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return createEmptySuggestFacadeResponse(query);
  }

  if (!SEARCH_API_CONFIG.USE_REMOTE_API) {
    return buildLocalSuggestFacadeResponse(query);
  }

  try {
    return await suggestRemoteFacade(query);
  } catch (error) {
    console.warn("远程 suggest 失败，准备回退到本地索引", error);
    return buildLocalSuggestFacadeResponse(query);
  }
}

export async function searchWithFacade(query: string): Promise<SearchFacadeResponse> {
  const normalizedQuery = normalize(query);

  if (!normalizedQuery) {
    return createEmptyFacadeResponse(query);
  }

  if (!SEARCH_API_CONFIG.USE_REMOTE_API) {
    const localResponse = buildLocalFacadeResponse(query);
    if (localResponse) {
      return localResponse;
    }

    throw new Error("本地搜索索引不可用，请检查 search_bundle.js");
  }

  try {
    return await searchRemoteFacade(query);
  } catch (error) {
    console.warn("远程搜索失败，准备回退到本地索引", error);

    const localResponse = buildLocalFacadeResponse(query, true);
    if (localResponse) {
      return localResponse;
    }

    throw error;
  }
}

function createEmptySuggestFacadeResponse(query: string): SuggestFacadeResponse {
  return {
    query,
    normalizedQuery: normalize(query),
    total: 0,
    emptyHint: "",
    suggestions: [],
    source: SEARCH_API_CONFIG.USE_REMOTE_API ? "remote" : "local",
  };
}

function buildLocalSuggestFacadeResponse(query: string): SuggestFacadeResponse {
  const normalizedQuery = normalize(query);
  const suggestions = suggest(query).slice(0, MAX_SUGGEST);

  return {
    query,
    normalizedQuery,
    total: suggestions.length,
    emptyHint: "",
    suggestions,
    source: "local",
  };
}

async function suggestRemoteFacade(query: string): Promise<SuggestFacadeResponse> {
  const normalizedQuery = normalize(query);

  const remoteData = await request<RemoteSuggestDataRaw>({
    url: SEARCH_API_CONFIG.SUGGEST_PATH,
    method: "GET",
    query: {
      q: query.trim(),
    },
  });

  const remoteItems = Array.isArray(remoteData.items) ? remoteData.items : [];
  const suggestions = remoteItems
    .map((item, index) => adaptRemoteSuggestItem(item, index))
    .filter((item) => Boolean(item.text))
    .slice(0, MAX_SUGGEST);

  return {
    query,
    normalizedQuery,
    total: normalizeInteger(remoteData.total, 0) ?? suggestions.length,
    emptyHint: normalizeText(remoteData.empty_hint),
    suggestions,
    source: "remote",
  };
}

function adaptRemoteSuggestItem(item: RemoteSuggestItemRaw, index: number): SearchSuggestion {
  const title = normalizeText(item.title);
  const id = normalizeText(item.id) || `REMOTE_SUGGEST_${index + 1}`;

  return {
    text: title || normalizeText(item.matched_text) || id,
    id,
    score: normalizeScore(item.score),
    title: title || undefined,
    subtitle: normalizeText(item.subtitle) || undefined,
    route: normalizeText(item.route) || undefined,
    module: normalizeText(item.module) || undefined,
    difficulty: normalizeNumber(item.difficulty) ?? undefined,
    tags: normalizeTags(item.tags),
    matchType: normalizeText(item.match_type) || undefined,
    matchField: normalizeText(item.match_field) || undefined,
    matchedText: normalizeText(item.matched_text) || undefined,
    badge: normalizeText(item.badge) || undefined,
  };
}

function createEmptyFacadeResponse(query: string): SearchFacadeResponse {
  const normalizedQuery = normalize(query);

  return {
    query,
    normalizedQuery,
    total: 0,
    page: 1,
    pageSize: SEARCH_API_CONFIG.PAGE_SIZE,
    items: [],
    facets: {},
    debug: {
      normalizedQuery,
      lookupTokens: normalizedQuery ? buildLookupTokens(normalizedQuery) : [],
      termHitCount: 0,
      prefixHitCount: 0,
      suggestionHitCount: 0,
      resultCount: 0,
      fallbackUsed: false,
      topSuggestions: [],
      topMatches: [],
    },
    source: SEARCH_API_CONFIG.USE_REMOTE_API ? "remote" : "local",
  };
}

async function searchRemoteFacade(query: string): Promise<SearchFacadeResponse> {
  const normalizedQuery = normalize(query);

  const remoteData = await request<RemoteSearchDataRaw>({
    url: SEARCH_API_CONFIG.SEARCH_PATH,
    method: "GET",
    query: {
      q: query.trim(),
      page: 1,
      page_size: SEARCH_API_CONFIG.PAGE_SIZE,
    },
  });

  const remoteItems = Array.isArray(remoteData.items) ? remoteData.items : [];
  const items = remoteItems.map((item, index) => adaptRemoteSearchItem(item, index));
  const facets = normalizeRemoteFacets(remoteData.facets, items);

  const total = normalizeInteger(remoteData.total, 0) ?? items.length;
  const page = normalizeInteger(remoteData.page, 1) ?? 1;
  const pageSize = normalizeInteger(remoteData.page_size, 1)
    ?? SEARCH_API_CONFIG.PAGE_SIZE;

  return {
    query,
    normalizedQuery,
    total,
    page,
    pageSize,
    items,
    facets,
    debug: buildRemoteDebugInfo(query, items),
    source: "remote",
  };
}

function buildLocalFacadeResponse(query: string, fallbackUsed = false): SearchFacadeResponse | null {
  const bundle = getBundle();
  if (!bundle) {
    return null;
  }

  const response = searchWithDebug(query);
  const items = response.results.map((result) => adaptLocalSearchResult(result));
  const facets = buildFacetsFromItems(items);

  return {
    query,
    normalizedQuery: response.normalizedQuery,
    total: response.results.length,
    page: 1,
    pageSize: MAX_RESULTS,
    items,
    facets,
    debug: fallbackUsed
      ? {
          ...response.debug,
          fallbackUsed: true,
        }
      : response.debug,
    source: "local",
  };
}

function adaptLocalSearchResult(result: SearchResult): SearchViewItem {
  const doc = result.doc;
  const moduleLabel = getModuleLabel(doc.module);
  const category = normalizeText(doc.category) || moduleLabel;
  const tags = normalizeTags(doc.tags);
  const summary = resolveSummaryText(normalizeText(doc.summary), tags, doc.title);
  const difficulty = normalizeNumber(doc.difficulty);

  return {
    id: doc.id,
    title: doc.title,
    module: doc.module,
    moduleDir: normalizeText(doc.moduleDir) || doc.module,
    category,
    tags,
    summary,
    snippet: summary,
    coreFormula: normalizeText(doc.coreFormula),
    difficulty: difficulty ?? undefined,
    rank: normalizeNumber(doc.rank) ?? undefined,
    searchBoost: normalizeNumber(doc.searchBoost) ?? undefined,
    hotScore: normalizeNumber(doc.hotScore) ?? undefined,
    examFrequency: normalizeNumber(doc.examFrequency) ?? undefined,
    examScore: normalizeNumber(doc.examScore) ?? undefined,
    searchScore: normalizeScore(result.score),
    moduleLabel,
    difficultyLabel: formatDifficultyLabel(difficulty),
    badgeList: buildBadgeList(category, difficulty),
    isFavorited: Boolean(doc.isFavorited),
  };
}

function adaptRemoteSearchItem(item: RemoteSearchItemRaw, index: number): SearchViewItem {
  const id = normalizeText(item.id) || `REMOTE_${index + 1}`;
  const title = normalizeText(item.title) || id;
  const module = normalizeText(item.module) || "inequality";
  const moduleDir = normalizeText(item.moduleDir) || module;
  const moduleLabel = getModuleLabel(module);
  const tags = normalizeTags(item.tags);

  const summary = resolveSummaryText(
    normalizeText(item.summary),
    tags,
    normalizeText(item.statement_clean) || normalizeText(item.snippet) || title,
  );

  const difficulty = normalizeNumber(item.difficulty);
  const rank = normalizeNumber(item.rank);
  const searchBoost = normalizeNumber(item.searchBoost);
  const hotScore = normalizeNumber(item.hotScore);
  const score = normalizeScore(item.score ?? rank ?? searchBoost ?? hotScore ?? 0);

  const category = normalizeText(item.category) || moduleLabel;

  return {
    id,
    title,
    module,
    moduleDir,
    category,
    tags,
    summary,
    snippet: summary,
    coreFormula: normalizeText(item.coreFormula),
    difficulty: difficulty ?? undefined,
    rank: rank ?? undefined,
    searchBoost: searchBoost ?? undefined,
    hotScore: hotScore ?? undefined,
    examFrequency: normalizeNumber(item.examFrequency) ?? undefined,
    examScore: normalizeNumber(item.examScore) ?? undefined,
    searchScore: score,
    moduleLabel,
    difficultyLabel: formatDifficultyLabel(difficulty),
    badgeList: buildBadgeList(category, difficulty),
    isFavorited: Boolean(item.is_favorited ?? item.isFavorited),
  };
}

function buildRemoteDebugInfo(
  query: string,
  items: SearchViewItem[],
): SearchDebugInfo {
  const normalizedQuery = normalize(query);

  return {
    normalizedQuery,
    lookupTokens: buildLookupTokens(normalizedQuery),
    termHitCount: 0,
    prefixHitCount: 0,
    suggestionHitCount: 0,
    resultCount: items.length,
    fallbackUsed: false,
    topSuggestions: [],
    topMatches: items.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      score: item.searchScore,
      matchedFieldsLabel: "remote",
      reasonSummary: item.summary
        ? "来自远程搜索接口，摘要字段为 summary"
        : "来自远程搜索接口",
    })),
  };
}

function normalizeRemoteFacets(rawFacets: unknown, items: SearchViewItem[]): SearchFacets {
  if (!isPlainObject(rawFacets)) {
    return buildFacetsFromItems(items);
  }

  const normalizedFacets: SearchFacets = {};
  const keys = Object.keys(rawFacets);

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const buckets = normalizeFacetBuckets(rawFacets[key]);

    if (buckets.length > 0) {
      normalizedFacets[key] = buckets;
    }
  }

  if (Object.keys(normalizedFacets).length === 0) {
    return buildFacetsFromItems(items);
  }

  return normalizedFacets;
}

function normalizeFacetBuckets(value: unknown): SearchFacetBucket[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const result: SearchFacetBucket[] = [];

  for (let index = 0; index < value.length; index += 1) {
    const bucket = value[index];
    if (!isPlainObject(bucket)) {
      continue;
    }

    const facetValue = bucket.value;
    const count = normalizeInteger(bucket.count, 0);

    if ((typeof facetValue !== "string" && typeof facetValue !== "number") || count === undefined) {
      continue;
    }

    result.push({
      value: facetValue,
      count,
    });
  }

  return result;
}

function buildFacetsFromItems(items: SearchViewItem[]): SearchFacets {
  const moduleCount = createFacetCounter();
  const difficultyCount = createFacetCounter();
  const tagCount = createFacetCounter();

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];

    const moduleValue = normalizeText(item.module) || normalizeText(item.moduleDir);
    if (moduleValue) {
      moduleCount[moduleValue] = (moduleCount[moduleValue] || 0) + 1;
    }

    if (typeof item.difficulty === "number") {
      const difficulty = Math.round(item.difficulty);
      difficultyCount[difficulty] = (difficultyCount[difficulty] || 0) + 1;
    }

    for (let tagIndex = 0; tagIndex < item.tags.length; tagIndex += 1) {
      const tag = normalizeText(item.tags[tagIndex]);
      if (!tag) {
        continue;
      }

      tagCount[tag] = (tagCount[tag] || 0) + 1;
    }
  }

  const facets: SearchFacets = {};
  const moduleFacet = mapCounterToFacetBuckets(moduleCount);
  const difficultyFacet = mapCounterToFacetBuckets(difficultyCount);
  const tagFacet = mapCounterToFacetBuckets(tagCount);

  if (moduleFacet.length > 0) {
    facets.module = moduleFacet as SearchFacetBucket<string>[];
  }

  if (difficultyFacet.length > 0) {
    facets.difficulty = difficultyFacet as SearchFacetBucket<number>[];
  }

  if (tagFacet.length > 0) {
    facets.tags = tagFacet as SearchFacetBucket<string>[];
  }

  return facets;
}

type FacetCounter = Record<string, number>;

function createFacetCounter(): FacetCounter {
  return {};
}

function mapCounterToFacetBuckets<TValue extends string | number>(
  counter: FacetCounter,
): SearchFacetBucket<TValue>[] {
  const keys = Object.keys(counter);

  return keys
    .map((key) => ({
      value: castFacetValue<TValue>(key),
      count: counter[key],
    }))
    .sort((left, right) => {
      if (right.count !== left.count) {
        return right.count - left.count;
      }

      return String(left.value).localeCompare(String(right.value));
    });
}

function castFacetValue<TValue extends string | number>(value: string): TValue {
  const numeric = Number(value);

  if (Number.isFinite(numeric) && String(numeric) === value) {
    return numeric as TValue;
  }

  return value as TValue;
}

function resolveSummaryText(summary: string, tags: string[], fallbackText: string): string {
  if (summary) {
    return summary;
  }

  if (tags.length > 0) {
    return tags.join(" / ");
  }

  return fallbackText;
}

function buildBadgeList(category: string, difficulty?: number | null): string[] {
  const badges: string[] = [];

  if (category) {
    badges.push(category);
  }

  const difficultyLabel = formatDifficultyLabel(difficulty);
  if (difficultyLabel) {
    badges.push(difficultyLabel);
  }

  return badges;
}

function formatDifficultyLabel(difficulty?: number | null): string {
  if (typeof difficulty !== "number" || !Number.isFinite(difficulty)) {
    return "-";
  }

  const clamped = Math.max(1, Math.min(5, difficulty));
  const rounded = Math.round(clamped * 10) / 10;
  const displayText = Number.isInteger(rounded) ? `${rounded}` : rounded.toFixed(1);

  return `${displayText} / 5`;
}

function getModuleLabel(module: string): string {
  if (module === "function") {
    return "函数";
  }

  if (module === "trigonometry") {
    return "三角函数";
  }

  if (module === "inequality") {
    return "不等式";
  }

  return "数学";
}

function normalizeTags(tags: unknown): string[] {
  if (!Array.isArray(tags)) {
    return [];
  }

  const seen: Record<string, true> = {};
  const normalizedTags: string[] = [];

  for (let index = 0; index < tags.length; index += 1) {
    const tag = normalizeText(tags[index]);

    if (!tag || seen[tag]) {
      continue;
    }

    seen[tag] = true;
    normalizedTags.push(tag);
  }

  return normalizedTags;
}

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function normalizeNumber(value: unknown): number | null {
  if (typeof value !== "number") {
    return null;
  }

  if (!Number.isFinite(value)) {
    return null;
  }

  return value;
}

function normalizeInteger(value: unknown, minimum: number): number | undefined {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return undefined;
  }

  return Math.max(minimum, Math.round(value));
}

function normalizeScore(value: unknown): number {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    return 0;
  }

  return Math.round(value * 10) / 10;
}

/**
 * 构造一个空结果响应。
 * 用于搜索引擎尚未初始化成功，或用户输入为空时的统一返回结构。
 */
function createEmptyResponse(query: string, normalizedQuery: string): SearchResponse {
  return {
    query,
    normalizedQuery,
    suggestions: [],
    results: [],
    debug: {
      normalizedQuery,
      lookupTokens: [],
      termHitCount: 0,
      prefixHitCount: 0,
      suggestionHitCount: 0,
      resultCount: 0,
      fallbackUsed: false,
      topSuggestions: [],
      topMatches: [],
    },
  };
}

/**
 * 获取已初始化的 bundle。
 * 如果尚未初始化，则尝试惰性初始化一次。
 */
function getBundle(): SearchBundle | null {
  if (!SEARCH_BUNDLE) {
    initSearchEngine();
  }

  return SEARCH_BUNDLE;
}

/**
 * 根据当前 query 收集联想建议。
 *
 * 规则：
 * - 对 suggestions 列表逐项计算匹配 bonus。
 * - 对同一 `(text, docId)` 做去重。
 * - 最终按得分和文本长度排序。
 */
function collectSuggestions(bundle: SearchBundle, normalizedQuery: string, limit: number): SearchSuggestion[] {
  const normalizedNeedles = buildLookupTokens(normalizedQuery);
  const seen: Record<string, true> = {};
  const matches: SearchSuggestion[] = [];

  for (let index = 0; index < bundle.suggestions.length; index += 1) {
    const tuple = bundle.suggestions[index];
    const text = tuple[0];
    const docId = tuple[1];
    const baseScore = tuple[2];
    const normalizedText = normalize(text);
    const matchBonus = getSuggestionMatchBonus(normalizedText, normalizedNeedles);

    if (matchBonus === 0) {
      continue;
    }

    const dedupeKey = `${text}::${docId}`;

    if (seen[dedupeKey]) {
      continue;
    }

    seen[dedupeKey] = true;

    matches.push({
      text,
      id: docId,
      score: baseScore + matchBonus,
    });
  }

  matches.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    return left.text.length - right.text.length;
  });

  return matches.slice(0, limit);
}

/**
 * 计算 suggestion 相对于 query 的匹配加分。
 * 完全匹配 > 前缀匹配 > 包含匹配。
 */
function getSuggestionMatchBonus(normalizedText: string, needles: string[]): number {
  for (let index = 0; index < needles.length; index += 1) {
    const needle = needles[index];

    if (!needle) {
      continue;
    }

    if (normalizedText === needle) {
      return 300;
    }

    if (normalizedText.startsWith(needle)) {
      return 200;
    }

    if (normalizedText.includes(needle)) {
      return 100;
    }
  }

  return 0;
}

/**
 * 从一个 query 构建查索引时使用的 token 集合。
 *
 * 例如：
 * - 原始归一化 query
 * - 去掉空格后的紧凑版本
 * - 按空格拆开的多个片段
 *
 * 这样可以同时兼顾完整短语匹配和分词匹配。
 */
function buildLookupTokens(normalizedQuery: string): string[] {
  const parts = normalizedQuery.split(/\s+/);
  const compact = normalizedQuery.replace(/\s+/g, "");
  const tokens = [normalizedQuery, compact].concat(parts);
  const seen: Record<string, true> = {};
  const result: string[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index];

    if (!token || seen[token]) {
      continue;
    }

    seen[token] = true;
    result.push(token);
  }

  return result;
}

/**
 * 将 term / prefix 索引命中结果合并进 accumulator。
 *
 * accumulator 的作用：
 * - 以 docId 为键累积分数；
 * - 记录命中的字段；
 * - 保留少量可解释的原因，便于调试和排序回溯。
 */
function mergeIndexEntries(
  accumulatorMap: Record<string, SearchAccumulator>,
  bundle: SearchBundle,
  entries: SearchIndexTuple[],
  source: "term" | "prefix",
  token: string,
  weight: number,
) {
  const scanLimit = Math.min(entries.length, MAX_INDEX_SCAN);

  for (let index = 0; index < scanLimit; index += 1) {
    const entry = entries[index];
    const docId = entry[0];
    const baseScore = entry[1];
    const fieldMask = entry[2];
    const doc = bundle.docs[docId];

    if (!doc) {
      continue;
    }

    const accumulator = getAccumulator(accumulatorMap, docId, doc);
    const weightedScore = Math.round(baseScore * weight);
    const fields = decodeFieldMask(fieldMask);

    accumulator.score += weightedScore;

    for (let fieldIndex = 0; fieldIndex < fields.length; fieldIndex += 1) {
      accumulator.matchedFieldMap[fields[fieldIndex]] = true;
    }

    if (accumulator.reasons.length < 6) {
      accumulator.reasons.push({
        source,
        token,
        score: weightedScore,
        fields,
      });
    }
  }
}

/**
 * 当 term/prefix 完全没有结果时，使用 suggestion 结果做弱兜底。
 * 这样用户至少还能看到“比较接近的条目”，而不是一个空白结果页。
 */
function mergeSuggestionEntries(
  accumulatorMap: Record<string, SearchAccumulator>,
  bundle: SearchBundle,
  suggestions: SearchSuggestion[],
  weight: number,
) {
  const seenDocIds: Record<string, true> = {};

  for (let index = 0; index < suggestions.length; index += 1) {
    const suggestion = suggestions[index];
    const doc = bundle.docs[suggestion.id];

    if (!doc || seenDocIds[suggestion.id]) {
      continue;
    }

    seenDocIds[suggestion.id] = true;

    const accumulator = getAccumulator(accumulatorMap, suggestion.id, doc);
    const weightedScore = Math.round(suggestion.score * weight);

    accumulator.score += weightedScore;
    accumulator.matchedFieldMap.suggestions = true;

    if (accumulator.reasons.length < 6) {
      accumulator.reasons.push({
        source: "suggestion",
        token: suggestion.text,
        score: weightedScore,
        fields: ["suggestions"],
      });
    }
  }
}

/**
 * 获取或创建某个文档对应的 accumulator。
 */
function getAccumulator(
  accumulatorMap: Record<string, SearchAccumulator>,
  docId: string,
  doc: SearchDoc,
): SearchAccumulator {
  if (!accumulatorMap[docId]) {
    accumulatorMap[docId] = {
      id: docId,
      score: 0,
      doc,
      reasons: [],
      matchedFieldMap: {},
    };
  }

  return accumulatorMap[docId];
}

/**
 * 汇总并排序最终结果。
 *
 * 排序优先级：
 * 1. 搜索分数
 * 2. 业务 rank
 * 3. 热度 hotScore
 * 4. id 字典序（作为最后稳定兜底）
 */
function finalizeResults(accumulatorMap: Record<string, SearchAccumulator>): SearchResult[] {
  const results: SearchResult[] = [];

  for (const id in accumulatorMap) {
    const accumulator = accumulatorMap[id];
    const matchedFields = Object.keys(accumulator.matchedFieldMap);

    results.push({
      id: accumulator.id,
      score: accumulator.score,
      doc: accumulator.doc,
      reasons: accumulator.reasons,
      matchedFields,
    });
  }

  results.sort((left, right) => {
    if (right.score !== left.score) {
      return right.score - left.score;
    }

    const rightRank = right.doc.rank || 0;
    const leftRank = left.doc.rank || 0;

    if (rightRank !== leftRank) {
      return rightRank - leftRank;
    }

    const rightHotScore = right.doc.hotScore || 0;
    const leftHotScore = left.doc.hotScore || 0;

    if (rightHotScore !== leftHotScore) {
      return rightHotScore - leftHotScore;
    }

    return left.id.localeCompare(right.id);
  });

  return results.slice(0, MAX_RESULTS);
}

/**
 * 生成调试面板中展示的 top matches。
 * 这是给开发者看的摘要信息，不参与真实搜索排序。
 */
function buildTopMatches(results: SearchResult[]): SearchDebugMatch[] {
  return results.slice(0, 5).map((result) => ({
    id: result.id,
    title: result.doc.title,
    score: result.score,
    matchedFieldsLabel: result.matchedFields.length > 0
      ? result.matchedFields.slice(0, 4).join(" / ")
      : "unknown",
    reasonSummary: summarizeReasons(result.reasons),
  }));
}

/**
 * 将多个匹配原因压缩成一行可读摘要，便于调试面板快速查看。
 */
function summarizeReasons(reasons: SearchMatchReason[]): string {
  if (reasons.length === 0) {
    return "no-reason";
  }

  return reasons
    .slice(0, 3)
    .map((reason) => {
      const fieldLabel = reason.fields.length > 0
        ? `@${reason.fields.slice(0, 2).join("/")}`
        : "";

      return `${reason.source}:${reason.token}${fieldLabel}`;
    })
    .join(" | ");
}

/**
 * 将索引里的字段位掩码解码为字段名列表。
 * 这样页面或调试工具就能知道“这条结果到底命中了标题、标签还是摘要”。
 */
function decodeFieldMask(fieldMask: number): string[] {
  const fields: string[] = [];

  for (let index = 0; index < FIELD_MASK_ENTRIES.length; index += 1) {
    const entry = FIELD_MASK_ENTRIES[index];

    if ((fieldMask & entry.mask) === entry.mask) {
      fields.push(entry.name);
    }
  }

  return fields;
}

/**
 * 统一 query 归一化规则。
 * 当前策略比较保守：trim、转小写、压缩多余空格。
 */
function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalize(query: string): string {
  return query.trim().toLowerCase().replace(/\s+/g, " ");
}
