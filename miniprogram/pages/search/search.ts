import type { ResultItem } from "../../types/search";
import { renderMath } from "../../utils/math-render";
import { getErrorMessage } from "../../utils/request";
import { createLogger } from "../../utils/logger/logger";
import type {
  SearchDebugInfo,
  SearchSuggestion,
  SearchViewItem,
} from "../../utils/search-engine";
import {
  getSearchMeta,
  initSearchEngine,
  suggestWithFacade,
  searchWithFacade,
} from "../../utils/search-engine";

const TAB_ALL = "all";
const SET_DATA_WARN_BYTES = 180 * 1024;
const searchPageLogger = createLogger("search-page");

const HOME_COPY = {
  title: "数秒查",
  subtitle: "常用公式、结论与模型，快速查询",
  searchTitle: "搜索结论、公式、关键词",
  searchPlaceholder: "例如：柯西、均值、sin、ln x、圆锥曲线",
  emptyTitle: "输入关键词，快速找到相关结论",
  emptySubtitle: "可搜索：柯西、均值、导数、圆锥曲线",
  noResultTitle: "暂未找到相关内容",
  noResultSubtitle: "可以换个关键词试试，例如：均值、导数、圆锥曲线",
} as const;

type QuickFilter = {
  key: string;
  label: string;
};

const QUICK_FILTERS: QuickFilter[] = [
  { key: TAB_ALL, label: "全部" },
  { key: "hot", label: "高频" },
  { key: "common", label: "常用" },
  { key: "inequality", label: "不等式" },
  { key: "function", label: "函数" },
  { key: "conic", label: "圆锥" },
  { key: "derivative", label: "导数" },
];

const FILTER_KEYWORDS: Record<string, string[]> = {
  inequality: ["不等式", "inequality"],
  function: ["函数", "function", "trigonometry", "三角函数"],
  conic: ["圆锥", "conic", "椭圆", "抛物线", "双曲线"],
  derivative: ["导数", "derivative", "微分"],
};

type HighlightSegment = {
  text: string;
  highlight: boolean;
};

type SearchInputEvent = {
  detail: {
    value?: string;
  };
};

type SearchTextTapEvent = {
  currentTarget: {
    dataset: {
      text?: string;
    };
  };
};

type SearchTabTapEvent = {
  currentTarget: {
    dataset: {
      tab?: string;
    };
  };
};

type SearchDetailTapEvent = {
  currentTarget: {
    dataset: {
      id?: string;
    };
  };
};

interface SearchCardItem extends ResultItem {
  titleSegments: HighlightSegment[];
  category: string;
  searchScore: number;
  formulaHtml: string;
  formulaText: string;
  freq: string;
}

let timer: number | null = null;

Page({
  data: {
    homeCopy: HOME_COPY,
    query: "",
    focus: false,
    loading: false,
    errorMessage: "",
    suggestLoading: false,
    suggestErrorMessage: "",

    results: [] as SearchCardItem[],
    suggestions: [] as SearchSuggestion[],
    debugInfo: null as SearchDebugInfo | null,

    total: 0,
    hotCount: 0,
    learned: 0,
    rate1: 0,
    rate2: 0,

    quickFilters: QUICK_FILTERS as QuickFilter[],
    activeTab: TAB_ALL,
    showClear: false,
  },

  searchTaskId: 0,
  suggestTaskId: 0,
  allResultsCache: [] as SearchCardItem[],

  onLoad() {
    initSearchEngine();

    const meta = getSearchMeta();
    const total = meta.totalDocs;
    const hotCount = meta.hotDocCount;
    const highExamFrequencyCount = meta.highExamFrequencyCount;

    this.setData({
      total,
      hotCount,
      learned: total,
      rate1: this.calculateRate(hotCount, total),
      rate2: this.calculateRate(highExamFrequencyCount, total),
      quickFilters: this.buildQuickFilters(meta.categories),
    });
  },

  onInput(e: SearchInputEvent) {
    const value = String(e.detail.value || "");

    this.setData({
      query: value,
      showClear: value.length > 0,
      errorMessage: "",
      suggestErrorMessage: "",
    });

    if (timer !== null) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      void this.executeInputFlow(value);
    }, 80);
  },

  onSuggestionTap(e: SearchTextTapEvent) {
    const text = String(e.currentTarget.dataset.text || "");
    if (!text.trim()) {
      return;
    }

    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    this.createSuggestTaskId();
    this.setData({
      query: text,
      showClear: text.length > 0,
      focus: false,
      suggestions: [],
      suggestLoading: false,
      suggestErrorMessage: "",
    });

    void this.executeSearch(text, true);
  },

  onConfirm() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    this.createSuggestTaskId();
    this.setData({
      suggestions: [],
      suggestLoading: false,
      suggestErrorMessage: "",
    });
    void this.executeSearch(this.data.query, true);
  },

  onClear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    this.createSearchTaskId();
    this.createSuggestTaskId();

    this.allResultsCache = [];

    this.setData({
      query: "",
      focus: true,
      loading: false,
      errorMessage: "",
      suggestLoading: false,
      suggestErrorMessage: "",
      showClear: false,
      suggestions: [],
      results: [],
      debugInfo: null,
      activeTab: TAB_ALL,
    });
  },

  onTabTap(e: SearchTabTapEvent) {
    const tab = String(e.currentTarget.dataset.tab || TAB_ALL);
    const filteredResults = this.filterResults(
      this.allResultsCache,
      tab,
    );

    this.setDataWithTrace("search_tab_switch", {
      activeTab: tab,
      results: filteredResults,
    });
  },

  onDetailTap(e: SearchDetailTapEvent) {
    const id = String(e.currentTarget.dataset.id || "");
    if (!id) {
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
    });
  },

  async executeInputFlow(query: string) {
    const rawQuery = String(query || "");
    const trimmedQuery = rawQuery.trim();

    if (!trimmedQuery) {
      this.createSuggestTaskId();
      this.createSearchTaskId();
      this.applyEmptySearchState(rawQuery);
      return;
    }

    await Promise.allSettled([
      this.executeSuggest(rawQuery),
      this.executeSearch(rawQuery),
    ]);
  },

  async executeSuggest(query: string) {
    const rawQuery = String(query || "");
    const trimmedQuery = rawQuery.trim();
    const suggestTaskId = this.createSuggestTaskId();

    if (!trimmedQuery) {
      this.setData({
        suggestions: [],
        suggestLoading: false,
        suggestErrorMessage: "",
      });
      return;
    }

    this.setData({
      suggestLoading: true,
      suggestErrorMessage: "",
    });

    try {
      const response = await suggestWithFacade(rawQuery);

      if (!this.isLatestSuggestTask(suggestTaskId)) {
        return;
      }

      this.setData({
        suggestions: response.suggestions,
        suggestLoading: false,
        suggestErrorMessage: "",
      });
    } catch (error) {
      if (!this.isLatestSuggestTask(suggestTaskId)) {
        return;
      }

      this.setData({
        suggestions: [],
        suggestLoading: false,
        suggestErrorMessage: getErrorMessage(error, "联想词加载失败，请稍后重试"),
      });
    }
  },

  async executeSearch(query: string, hideSuggestions = false) {
    const rawQuery = String(query || "");
    const trimmedQuery = rawQuery.trim();
    const searchTaskId = this.createSearchTaskId();

    if (!trimmedQuery) {
      this.applyEmptySearchState(rawQuery);
      return;
    }

    this.setDataWithTrace("search_loading_start", {
      query: rawQuery,
      focus: hideSuggestions ? false : this.data.focus,
      showClear: rawQuery.length > 0,
      loading: true,
      errorMessage: "",
    });

    try {
      const response = await searchWithFacade(rawQuery);

      if (!this.isLatestSearchTask(searchTaskId)) {
        return;
      }

      const allResults = this.buildSearchCards(response.items, rawQuery);
      const formulaHtmlChars = this.sumFormulaHtmlChars(allResults);

      searchPageLogger.debug("search_response_adapted", {
        query: rawQuery,
        source: response.source,
        itemCount: response.items.length,
        cardCount: allResults.length,
        formulaHtmlChars,
        resultCountFromDebug: response.debug.resultCount,
      });

      this.applySearchState(
        rawQuery,
        allResults,
        response.debug,
      );
    } catch (error) {
      if (!this.isLatestSearchTask(searchTaskId)) {
        return;
      }

      searchPageLogger.warn("search_request_failed", {
        query: rawQuery,
        error,
      });
      this.applyErrorState(rawQuery, "搜索暂时不可用，请稍后重试");
    } finally {
      if (!this.isLatestSearchTask(searchTaskId)) {
        return;
      }

      if (this.data.loading) {
        this.setDataWithTrace("search_loading_finally", {
          loading: false,
        });
      }
    }
  },

  applySearchState(
    rawQuery: string,
    allResults: SearchCardItem[],
    debugInfo: SearchDebugInfo,
  ) {
    this.allResultsCache = allResults;

    const quickFilters = this.extendQuickFiltersWithResultCategories(allResults);
    const nextActiveTab = quickFilters.some(
      (filter) => filter.key === this.data.activeTab,
    )
      ? this.data.activeTab
      : TAB_ALL;
    const filteredResults = this.filterResults(allResults, nextActiveTab);

    this.setDataWithTrace("search_state_success", {
      query: rawQuery,
      focus: false,
      loading: false,
      errorMessage: "",
      showClear: rawQuery.length > 0,
      results: filteredResults,
      debugInfo,
      quickFilters,
      activeTab: nextActiveTab,
    });
  },

  applyErrorState(rawQuery: string, errorMessage: string) {
    this.allResultsCache = [];

    this.setDataWithTrace("search_state_error", {
      query: rawQuery,
      focus: false,
      loading: false,
      errorMessage,
      showClear: rawQuery.length > 0,
      results: [],
      debugInfo: null,
      activeTab: TAB_ALL,
    });
  },

  applyEmptySearchState(rawQuery: string) {
    this.allResultsCache = [];

    this.setDataWithTrace("search_state_empty", {
      query: rawQuery,
      loading: false,
      errorMessage: "",
      suggestLoading: false,
      suggestErrorMessage: "",
      showClear: rawQuery.length > 0,
      suggestions: [],
      results: [],
      debugInfo: null,
      activeTab: TAB_ALL,
    });
  },

  buildSearchCards(
    items: SearchViewItem[],
    highlightQuery: string,
  ): SearchCardItem[] {
    return items.map((item) => {
      const title = item.title || item.id;
      const summary = this.resolveSummaryText(item);
      const formulaSource = item.coreFormula || title;
      const mathResult = renderMath(formulaSource, true);
      const category = this.resolveCategory(item);
      const level =
        item.difficultyLabel || this.formatDifficulty(item.difficulty);
      const frequency = this.formatFrequency(item.examFrequency);
      const score = this.normalizeSearchScore(item.searchScore);

      return {
        id: item.id,
        title,
        titleSegments: this.highlightSegments(title, highlightQuery),
        summary,
        formula: mathResult.source,
        formulaHtml: mathResult.html,
        formulaText: mathResult.source,
        module: item.moduleDir || item.module || category,
        category,
        tags: Array.isArray(item.tags) ? item.tags : [],
        level,
        freq: frequency,
        score,
        searchScore: score,
        recentScore: Math.round(item.examScore || 0),
        weight: item.searchBoost,
        usage: summary,
      };
    });
  },

  resolveSummaryText(item: SearchViewItem): string {
    const summary = String(item.summary || "").trim();
    if (summary) {
      return summary;
    }

    const tags = Array.isArray(item.tags) ? item.tags : [];
    if (tags.length > 0) {
      return tags.join(" / ");
    }

    return item.title || "\u6682\u65e0\u6458\u8981";
  },

  resolveCategory(item: SearchViewItem): string {
    const category = String(item.category || "").trim();
    if (category) {
      return category;
    }

    const moduleLabel = String(item.moduleLabel || "").trim();
    if (moduleLabel) {
      return moduleLabel;
    }

    return this.getModuleLabel(item.module);
  },

  buildQuickFilters(categories: string[]): QuickFilter[] {
    const filters = QUICK_FILTERS.map((item) => ({ ...item }));
    const seenKeys: Record<string, true> = {};

    filters.forEach((item) => {
      seenKeys[item.key] = true;
    });

    categories.forEach((category) => {
      const normalizedCategory = String(category || "").trim();
      if (!normalizedCategory) {
        return;
      }

      if (this.isCoveredByPresetCategory(normalizedCategory)) {
        return;
      }

      const key = `category:${normalizedCategory}`;
      if (seenKeys[key]) {
        return;
      }

      seenKeys[key] = true;
      filters.push({
        key,
        label: normalizedCategory,
      });
    });

    return filters;
  },

  extendQuickFiltersWithResultCategories(results: SearchCardItem[]): QuickFilter[] {
    const categories: string[] = [];

    this.data.quickFilters.forEach((filter) => {
      if (String(filter.key || "").startsWith("category:")) {
        categories.push(filter.label);
      }
    });

    results.forEach((item) => {
      categories.push(String(item.category || "").trim());
    });

    return this.buildQuickFilters(categories);
  },

  isCoveredByPresetCategory(category: string): boolean {
    const normalized = category.toLowerCase();

    return this.hasAnyKeyword(normalized, FILTER_KEYWORDS.inequality)
      || this.hasAnyKeyword(normalized, FILTER_KEYWORDS.function)
      || this.hasAnyKeyword(normalized, FILTER_KEYWORDS.conic)
      || this.hasAnyKeyword(normalized, FILTER_KEYWORDS.derivative);
  },

  hasAnyKeyword(text: string, keywords: string[]): boolean {
    for (let index = 0; index < keywords.length; index += 1) {
      if (text.includes(keywords[index])) {
        return true;
      }
    }

    return false;
  },

  createSearchTaskId(): number {
    this.searchTaskId += 1;
    return this.searchTaskId;
  },

  isLatestSearchTask(taskId: number): boolean {
    return taskId === this.searchTaskId;
  },

  createSuggestTaskId(): number {
    this.suggestTaskId += 1;
    return this.suggestTaskId;
  },

  isLatestSuggestTask(taskId: number): boolean {
    return taskId === this.suggestTaskId;
  },

  setDataWithTrace(tag: string, payload: WechatMiniprogram.IAnyObject) {
    const startedAt = Date.now();
    const payloadBytes = this.estimatePayloadBytes(payload);
    const summary = this.buildPayloadSummary(payload);

    searchPageLogger.debug("set_data_start", {
      tag,
      payloadBytes,
      ...summary,
    });

    if (payloadBytes >= SET_DATA_WARN_BYTES) {
      searchPageLogger.warn("set_data_payload_large", {
        tag,
        payloadBytes,
        ...summary,
      });
    }

    this.setData(payload, () => {
      searchPageLogger.debug("set_data_done", {
        tag,
        payloadBytes,
        durationMs: Date.now() - startedAt,
      });
    });
  },

  estimatePayloadBytes(payload: WechatMiniprogram.IAnyObject): number {
    try {
      return JSON.stringify(payload).length;
    } catch (_error) {
      return -1;
    }
  },

  buildPayloadSummary(
    payload: WechatMiniprogram.IAnyObject,
  ): WechatMiniprogram.IAnyObject {
    const keys = Object.keys(payload);
    const summary: WechatMiniprogram.IAnyObject = {
      keyCount: keys.length,
      keys: keys.slice(0, 10),
    };

    if (Array.isArray(payload.results)) {
      summary.resultCount = payload.results.length;
      summary.resultFormulaHtmlChars = this.sumFormulaHtmlChars(
        payload.results as SearchCardItem[],
      );
    }

    if (Array.isArray(payload.suggestions)) {
      summary.suggestionCount = payload.suggestions.length;
    }

    if (typeof payload.loading === "boolean") {
      summary.loading = payload.loading;
    }

    if (typeof payload.query === "string") {
      summary.queryLength = payload.query.length;
    }

    return summary;
  },

  sumFormulaHtmlChars(items: SearchCardItem[]): number {
    let total = 0;

    for (let index = 0; index < items.length; index += 1) {
      const formulaHtml = items[index].formulaHtml;
      if (typeof formulaHtml === "string") {
        total += formulaHtml.length;
      }
    }

    return total;
  },

  filterResults(
    results: SearchCardItem[],
    activeTab: string,
  ): SearchCardItem[] {
    if (activeTab === TAB_ALL) {
      return results;
    }

    if (activeTab === "hot") {
      return results.filter((item) => this.isHotItem(item));
    }

    if (activeTab === "common") {
      return results.filter((item) => this.isCommonItem(item));
    }

    if (activeTab === "inequality") {
      return results.filter((item) => this.matchesKeywordFilter(item, FILTER_KEYWORDS.inequality));
    }

    if (activeTab === "function") {
      return results.filter((item) => this.matchesKeywordFilter(item, FILTER_KEYWORDS.function));
    }

    if (activeTab === "conic") {
      return results.filter((item) => this.matchesKeywordFilter(item, FILTER_KEYWORDS.conic));
    }

    if (activeTab === "derivative") {
      return results.filter((item) => this.matchesKeywordFilter(item, FILTER_KEYWORDS.derivative));
    }

    if (activeTab.startsWith("category:")) {
      const category = activeTab.slice("category:".length).trim().toLowerCase();
      if (!category) {
        return [];
      }

      return results.filter((item) => this.matchesCategory(item, category));
    }

    return results.filter((item) => this.matchesCategory(item, activeTab.toLowerCase()));
  },

  matchesCategory(item: SearchCardItem, category: string): boolean {
    const itemCategory = String(item.category || "").trim().toLowerCase();
    if (itemCategory === category) {
      return true;
    }

    return this.buildItemSearchText(item).includes(category);
  },

  matchesKeywordFilter(item: SearchCardItem, keywords: string[]): boolean {
    const text = this.buildItemSearchText(item);
    return this.hasAnyKeyword(text, keywords);
  },

  isHotItem(item: SearchCardItem): boolean {
    if ((item.recentScore || 0) >= 80) {
      return true;
    }

    const frequency = this.parsePercent(item.freq);
    if (frequency !== null && frequency >= 60) {
      return true;
    }

    return this.matchesKeywordFilter(item, ["高频", "热门", "hot"]);
  },

  isCommonItem(item: SearchCardItem): boolean {
    const frequency = this.parsePercent(item.freq);
    if (frequency !== null && frequency >= 40) {
      return true;
    }

    return this.matchesKeywordFilter(item, ["常用", "基础", "common"]);
  },

  parsePercent(value: string | undefined): number | null {
    if (!value) {
      return null;
    }

    const normalized = String(value).trim();
    if (!normalized.endsWith("%")) {
      return null;
    }

    const parsed = Number(normalized.slice(0, -1));
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return parsed;
  },

  buildItemSearchText(item: SearchCardItem): string {
    const tags = Array.isArray(item.tags) ? item.tags.join(" ") : "";
    const text = [
      item.title,
      item.category,
      item.module,
      tags,
      item.summary,
      item.usage,
    ]
      .map((part) => String(part || "").toLowerCase())
      .join(" ");

    return text;
  },

  highlightSegments(text: string, keyword: string): HighlightSegment[] {
    const searchKeyword = keyword.trim();

    if (!searchKeyword) {
      return [{ text, highlight: false }];
    }

    const lowerText = text.toLowerCase();
    const lowerKeyword = searchKeyword.toLowerCase();
    const result: HighlightSegment[] = [];

    let start = 0;
    let index = lowerText.indexOf(lowerKeyword);

    while (index !== -1) {
      if (index > start) {
        result.push({
          text: text.slice(start, index),
          highlight: false,
        });
      }

      result.push({
        text: text.slice(index, index + searchKeyword.length),
        highlight: true,
      });

      start = index + searchKeyword.length;
      index = lowerText.indexOf(lowerKeyword, start);
    }

    if (start < text.length) {
      result.push({
        text: text.slice(start),
        highlight: false,
      });
    }

    return result.length > 0 ? result : [{ text, highlight: false }];
  },

  formatDifficulty(difficulty?: number): string {
    if (typeof difficulty !== "number" || !Number.isFinite(difficulty)) {
      return "-";
    }

    const clamped = Math.max(1, Math.min(5, difficulty));
    const rounded = Math.round(clamped * 10) / 10;
    const displayText = Number.isInteger(rounded)
      ? `${rounded}`
      : rounded.toFixed(1);

    return `${displayText} / 5`;
  },

  formatFrequency(examFrequency?: number): string {
    if (typeof examFrequency !== "number" || !Number.isFinite(examFrequency)) {
      return "-";
    }

    return `${Math.round(examFrequency * 100)}%`;
  },

  normalizeSearchScore(score?: number): number {
    const numericScore = Number(score || 0);
    if (!Number.isFinite(numericScore)) {
      return 0;
    }

    return Math.round(numericScore * 10) / 10;
  },

  calculateRate(count: number, total: number): number {
    if (total <= 0) {
      return 0;
    }

    return Math.round((count / total) * 100);
  },

  getModuleLabel(module: string): string {
    if (module === "function") {
      return "\u51fd\u6570";
    }

    if (module === "trigonometry") {
      return "\u4e09\u89d2\u51fd\u6570";
    }

    if (module === "inequality") {
      return "\u4e0d\u7b49\u5f0f";
    }

    return "\u6570\u5b66";
  },
});
