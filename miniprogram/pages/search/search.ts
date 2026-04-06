const appInstance = getApp<IAppOption>();

import type { ResultItem } from "../../types/search";
import type {
  SearchDebugInfo,
  SearchResult,
  SearchSuggestion,
} from "../../utils/search-engine";
import {
  getSearchMeta,
  initSearchEngine,
  searchWithDebug,
} from "../../utils/search-engine";
import { renderMath } from "../../utils/math-render";

type HighlightSegment = {
  text: string;
  highlight: boolean;
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

    tabs: ["全部"] as string[],
    activeTab: "全部",
    showClear: false,
  },

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
      tabs: ["全部"].concat(meta.categories),
    });
  },

  onInput(e: any) {
    const value = e.detail.value as string;

    this.setData({
      query: value,
      showClear: value.length > 0,
    });

    if (timer !== null) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      this.executeSearch(value);
    }, 80);
  },

  onSuggestionTap(e: any) {
    const text = e.currentTarget.dataset.text as string;
    this.executeSearch(text, true);
  },

  onConfirm() {
    this.executeSearch(this.data.query, true);
  },

  onClear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    this.setData({
      query: "",
      focus: true,
      showClear: false,
      suggestions: [],
      allResults: [],
      results: [],
      debugInfo: null,
    });
  },

  onToggleDebug() {
    this.setData({
      debugExpanded: !this.data.debugExpanded,
    });
  },

  onTabTap(e: any) {
    const tab = e.currentTarget.dataset.tab as string;
    const filteredResults = this.filterResults(this.data.allResults as SearchCardItem[], tab);

    this.setData({
      activeTab: tab,
      results: filteredResults,
    });
  },

  onDetailTap(e: any) {
    const id = e.currentTarget.dataset.id as string;

    if (!id) {
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
    });
  },

  executeSearch(query: string, hideSuggestions = false) {
    const rawQuery = query || "";
    const trimmedQuery = rawQuery.trim();

    if (!trimmedQuery) {
      this.setData({
        query: rawQuery,
        showClear: rawQuery.length > 0,
        suggestions: [],
        allResults: [],
        results: [],
        debugInfo: null,
      });
      return;
    }

    const response = searchWithDebug(rawQuery);
    const allResults = this.buildResults(response.results, rawQuery);
    const filteredResults = this.filterResults(allResults, this.data.activeTab);

    this.setData({
      query: rawQuery,
      focus: false,
      showClear: true,
      suggestions: hideSuggestions ? [] : response.suggestions,
      allResults,
      results: filteredResults,
      debugInfo: response.debug,
    });
  },

  buildResults(results: SearchResult[], highlightQuery: string): SearchCardItem[] {
    return results.map((result) => {
      const doc = result.doc;
      const summary = doc.summary || (doc.tags || []).join(" / ");
      const mathResult = renderMath(doc.coreFormula || doc.title, true);

      return {
        id: doc.id,
        title: doc.title,
        titleSegments: this.highlightSegments(doc.title, highlightQuery),
        summary,
        formula: mathResult.source,
        formulaHtml: mathResult.html,
        formulaText: mathResult.source,
        module: doc.moduleDir,
        category: doc.category || this.getModuleLabel(doc.module),
        tags: doc.tags || [],
        level: this.formatDifficulty(doc.difficulty),
        freq: this.formatFrequency(doc.examFrequency),
        score: result.score,
        searchScore: result.score,
        recentScore: Math.round(doc.examScore || 0),
        weight: doc.searchBoost,
        usage: summary,
      };
    });
  },

  filterResults(results: SearchCardItem[], activeTab: string): SearchCardItem[] {
    if (activeTab === "全部") {
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
    const value = Math.max(1, Math.min(5, Math.round(difficulty || 1)));
    return `${value} / 5`;
  },

  formatFrequency(examFrequency?: number): string {
    return `${Math.round((examFrequency || 0) * 100)}%`;
  },

  calculateRate(count: number, total: number): number {
    if (total <= 0) {
      return 0;
    }

    return Math.round((count / total) * 100);
  },

  getModuleLabel(module: string): string {
    if (module === "function") {
      return "函数";
    }

    if (module === "trigonometry") {
      return "三角函数";
    }

    return "不等式";
  },
});
