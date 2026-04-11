const appInstance = getApp<IAppOption>();

import type { ResultItem } from "../../types/search";
import { renderMath } from "../../utils/math-render";
import { getErrorMessage } from "../../utils/request";
import type {
  SearchDebugInfo,
  SearchSuggestion,
  SearchViewItem,
} from "../../utils/search-engine";
import {
  getSearchMeta,
  initSearchEngine,
  searchWithFacade,
} from "../../utils/search-engine";

const TAB_ALL = "All";

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

    results: [] as SearchCardItem[],
    allResults: [] as SearchCardItem[],
    suggestions: [] as SearchSuggestion[],
    debugInfo: null as SearchDebugInfo | null,
    debugExpanded: true,

    statusBarHeight: 0,
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

  onLoad() {
    initSearchEngine();

    const meta = getSearchMeta();
    const total = meta.totalDocs;
    const hotCount = meta.hotDocCount;
    const highExamFrequencyCount = meta.highExamFrequencyCount;

    this.setData({
      statusBarHeight: appInstance.globalData.statusBarHeight || 0,
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
    });

    if (timer !== null) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      void this.executeSearch(value);
    }, 80);
  },

  onSuggestionTap(e: SearchTextTapEvent) {
    const text = String(e.currentTarget.dataset.text || "");
    void this.executeSearch(text, true);
  },

  onConfirm() {
    void this.executeSearch(this.data.query, true);
  },

  onClear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    this.createSearchTaskId();

    this.setData({
      query: "",
      focus: true,
      loading: false,
      errorMessage: "",
      showClear: false,
      suggestions: [],
      allResults: [],
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
      this.data.allResults as SearchCardItem[],
      tab,
    );

    this.setData({
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

  async executeSearch(query: string, hideSuggestions = false) {
    const rawQuery = String(query || "");
    const trimmedQuery = rawQuery.trim();
    const searchTaskId = this.createSearchTaskId();

    if (!trimmedQuery) {
      this.applyEmptySearchState(rawQuery);
      return;
    }

    this.setData({
      query: rawQuery,
      focus: hideSuggestions ? false : this.data.focus,
      showClear: rawQuery.length > 0,
      loading: true,
      errorMessage: "",
      suggestions: hideSuggestions ? [] : this.data.suggestions,
    });

    try {
      const response = await searchWithFacade(rawQuery);

      if (!this.isLatestSearchTask(searchTaskId)) {
        return;
      }

      const allResults = this.buildSearchCards(response.items, rawQuery);
      const suggestions = hideSuggestions ? [] : response.suggestions;

      this.applySearchState(
        rawQuery,
        hideSuggestions,
        allResults,
        suggestions,
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
    }
  },

  applySearchState(
    rawQuery: string,
    hideSuggestions: boolean,
    allResults: SearchCardItem[],
    suggestions: SearchSuggestion[],
    debugInfo: SearchDebugInfo,
  ) {
    const tabs = this.extendTabsWithResultCategories(allResults);
    const nextActiveTab = tabs.includes(this.data.activeTab)
      ? this.data.activeTab
      : TAB_ALL;
    const filteredResults = this.filterResults(allResults, nextActiveTab);

    this.setData({
      query: rawQuery,
      focus: false,
      loading: false,
      errorMessage: "",
      showClear: rawQuery.length > 0,
      suggestions: hideSuggestions ? [] : suggestions,
      allResults,
      results: filteredResults,
      debugInfo,
      tabs,
      activeTab: nextActiveTab,
    });
  },

  applyErrorState(rawQuery: string, errorMessage: string) {
    this.setData({
      query: rawQuery,
      focus: false,
      loading: false,
      errorMessage,
      showClear: rawQuery.length > 0,
      suggestions: [],
      allResults: [],
      results: [],
      debugInfo: null,
      activeTab: TAB_ALL,
    });
  },

  applyEmptySearchState(rawQuery: string) {
    this.setData({
      query: rawQuery,
      loading: false,
      errorMessage: "",
      showClear: rawQuery.length > 0,
      suggestions: [],
      allResults: [],
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
