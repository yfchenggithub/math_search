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

const TAB_ALL = "All";
const SET_DATA_WARN_BYTES = 180 * 1024;
const searchPageLogger = createLogger("search-page");

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
}

let timer: number | null = null;

Page({
  data: {
    query: "",
    focus: false,
    loading: false,
    errorMessage: "",
    suggestLoading: false,
    suggestErrorMessage: "",

    results: [] as SearchCardItem[],
    suggestions: [] as SearchSuggestion[],
    debugInfo: null as SearchDebugInfo | null,
    debugExpanded: true,

    total: 0,
    hotCount: 0,
    learned: 0,
    rate1: 0,
    rate2: 0,

    tabs: [TAB_ALL] as string[],
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
      tabs: [TAB_ALL].concat(meta.categories),
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

  onToggleDebug() {
    this.setData({
      debugExpanded: !this.data.debugExpanded,
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
        suggestErrorMessage: getErrorMessage(error, "Suggest failed"),
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

      this.applyErrorState(
        rawQuery,
        getErrorMessage(error, "Search failed, please retry"),
      );
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

    const tabs = this.extendTabsWithResultCategories(allResults);
    const nextActiveTab = tabs.includes(this.data.activeTab)
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
      tabs,
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

  extendTabsWithResultCategories(results: SearchCardItem[]): string[] {
    const nextTabs = this.data.tabs.slice();
    const seen: Record<string, true> = {};

    nextTabs.forEach((tab) => {
      seen[tab] = true;
    });

    results.forEach((item) => {
      const category = String(item.category || "").trim();

      if (!category || seen[category]) {
        return;
      }

      seen[category] = true;
      nextTabs.push(category);
    });

    return nextTabs;
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

    const hasMatchedCategory = results.some(
      (item) => item.category === activeTab,
    );
    if (!hasMatchedCategory) {
      return results;
    }

    return results.filter((item) => item.category === activeTab);
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
