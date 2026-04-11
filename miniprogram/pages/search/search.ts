/**
 * 搜索页控制器。
 *
 * 当前页面采用“后端优先，本地降级”的请求策略：
 * 1. 优先调用 REST `/search` 和 `/suggest`
 * 2. 如果后端暂未就绪、域名未配置或接口报错，则自动回退到本地搜索索引
 * 3. 页面层始终只消费统一的 `SearchCardItem[]`
 *
 * 这样做的好处是：
 * - 现在就能验证后端搜索链路
 * - 后端不稳定时不影响 MVP 联调
 * - 后续真正迁移到后端时，不需要重做页面结构
 */
const appInstance = getApp<IAppOption>();

import { getSuggestions, searchConclusions } from "../../api/search";
import type { SearchItem } from "../../types/api";
import type { ResultItem } from "../../types/search";
import { renderMath, renderMixedTextHtml } from "../../utils/math-render";
import { getErrorMessage } from "../../utils/request";
import type {
  SearchDebugInfo,
  SearchDebugMatch,
  SearchResult,
  SearchSuggestion,
} from "../../utils/search-engine";
import {
  getSearchMeta,
  initSearchEngine,
  searchWithDebug,
} from "../../utils/search-engine";

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

/**
 * 输入防抖计时器。
 * 搜索页改成远端请求后，需要避免连续输入时反复发请求。
 */
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

  /**
   * 当前搜索任务序号。
   *
   * 远端搜索是异步的，用户连续输入时可能出现旧请求比新请求更晚返回。
   * 这里用自增序号只接纳最后一次请求，避免页面被过期结果覆盖。
   */
  searchTaskId: 0,

  /**
   * 页面初始化。
   *
   * 这里仍然复用本地索引的元信息来渲染顶部统计和默认 tab，
   * 这样即使后端元信息接口还没准备好，页面也能先工作。
   */
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

  /**
   * 输入框实时输入。
   *
   * 行为保持和以前一致：
   * - 先更新输入框文本和清空按钮状态
   * - 再经过很短的防抖窗口发起搜索
   */
  onInput(e: SearchInputEvent) {
    const value = String(e.detail.value || "");

    this.setData({
      query: value,
      showClear: value.length > 0,
    });

    if (timer !== null) {
      clearTimeout(timer);
    }

    timer = setTimeout(() => {
      void this.executeSearch(value);
    }, 80);
  },

  /**
   * 点击联想建议后，直接用建议词发起搜索，并收起建议列表。
   */
  onSuggestionTap(e: SearchTextTapEvent) {
    const text = String(e.currentTarget.dataset.text || "");
    void this.executeSearch(text, true);
  },

  /**
   * 键盘确认搜索。
   */
  onConfirm() {
    void this.executeSearch(this.data.query, true);
  },

  /**
   * 清空搜索状态并回到初始界面。
   */
  onClear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    // 推进任务序号，让仍在飞行中的旧请求失效。
    this.createSearchTaskId();

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

  /**
   * 展开或收起调试面板。
   */
  onToggleDebug() {
    this.setData({
      debugExpanded: !this.data.debugExpanded,
    });
  },

  /**
   * 切换分类 tab。
   *
   * 这里只对已有结果做前端过滤，不重复发请求。
   */
  onTabTap(e: SearchTabTapEvent) {
    const tab = String(e.currentTarget.dataset.tab || "全部");
    const filteredResults = this.filterResults(this.data.allResults as SearchCardItem[], tab);

    this.setData({
      activeTab: tab,
      results: filteredResults,
    });
  },

  /**
   * 打开详情页。
   */
  onDetailTap(e: SearchDetailTapEvent) {
    const id = String(e.currentTarget.dataset.id || "");

    if (!id) {
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
    });
  },

  /**
   * 搜索主入口。
   *
   * 执行策略：
   * 1. 非空查询时先请求后端 `/search` 和 `/suggest`
   * 2. 只要后端链路失败，就自动回退到本地搜索引擎
   * 3. 不论结果来自哪里，最终都统一适配成页面使用的数据结构
   */
  async executeSearch(query: string, hideSuggestions = false) {
    const rawQuery = String(query || "");
    const trimmedQuery = rawQuery.trim();
    const searchTaskId = this.createSearchTaskId();

    if (!trimmedQuery) {
      this.applyEmptySearchState(rawQuery);
      return;
    }

    if (hideSuggestions) {
      this.setData({
        query: rawQuery,
        focus: false,
        showClear: true,
        suggestions: [],
      });
    }

    try {
      const [searchResponse, suggestResponse] = await Promise.all([
        searchConclusions({
          q: rawQuery,
          limit: 20,
          offset: 0,
        }),
        hideSuggestions
          ? Promise.resolve({ suggestions: [] })
          : getSuggestions(rawQuery),
      ]);

      if (!this.isLatestSearchTask(searchTaskId)) {
        return;
      }

      const suggestions = this.buildRemoteSuggestions(suggestResponse.suggestions);
      const allResults = this.buildRemoteResults(searchResponse.list, rawQuery);
      const debugInfo = this.buildRemoteDebugInfo(rawQuery, suggestions, searchResponse.list);

      this.applySearchState(rawQuery, hideSuggestions, allResults, suggestions, debugInfo);
    } catch (error) {
      console.warn("后端搜索失败，已回退到本地搜索索引", getErrorMessage(error), error);

      if (!this.isLatestSearchTask(searchTaskId)) {
        return;
      }

      this.executeLocalSearch(rawQuery, hideSuggestions, true);
    }
  },

  /**
   * 本地降级搜索。
   *
   * 当后端接口不可用时，继续复用原来的本地索引能力，
   * 这样页面层不会因为联调阶段的网络问题而中断。
   */
  executeLocalSearch(query: string, hideSuggestions = false, forceFallbackFlag = false) {
    const response = searchWithDebug(query);
    const allResults = this.buildLocalResults(response.results, query);
    const debugInfo: SearchDebugInfo = forceFallbackFlag
      ? {
          ...response.debug,
          fallbackUsed: true,
        }
      : response.debug;

    this.applySearchState(
      query,
      hideSuggestions,
      allResults,
      hideSuggestions ? [] : response.suggestions,
      debugInfo,
    );
  },

  /**
   * 把搜索状态统一写回页面。
   *
   * 这里额外做两件事：
   * 1. 把结果中出现的新分类并入 tabs，避免后端分类扩展后前端 tab 丢失
   * 2. 如果当前 activeTab 在新结果里不存在，则自动回到“全部”
   */
  applySearchState(
    rawQuery: string,
    hideSuggestions: boolean,
    allResults: SearchCardItem[],
    suggestions: SearchSuggestion[],
    debugInfo: SearchDebugInfo,
  ) {
    const tabs = this.extendTabsWithResultCategories(allResults);
    const nextActiveTab = tabs.includes(this.data.activeTab) ? this.data.activeTab : "全部";
    const filteredResults = this.filterResults(allResults, nextActiveTab);

    this.setData({
      query: rawQuery,
      focus: false,
      showClear: rawQuery.length > 0,
      suggestions: hideSuggestions ? [] : suggestions,
      allResults,
      results: filteredResults,
      debugInfo,
      tabs,
      activeTab: nextActiveTab,
    });
  },

  /**
   * 空查询时的统一清理逻辑。
   */
  applyEmptySearchState(rawQuery: string) {
    this.setData({
      query: rawQuery,
      showClear: rawQuery.length > 0,
      suggestions: [],
      allResults: [],
      results: [],
      debugInfo: null,
    });
  },

  /**
   * 把本地搜索引擎结果适配成页面卡片数据。
   */
  buildLocalResults(results: SearchResult[], highlightQuery: string): SearchCardItem[] {
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

  /**
   * 把后端 `/search` 返回结果适配成页面卡片数据。
   *
   * 说明：
   * - 后端当前返回 `title/module/snippet/score`
   * - 现有卡片还需要公式区、难度、频率等字段
   * - MVP 阶段先用 snippet 填充预览区，其它暂缺字段用占位值兜底
   */
  buildRemoteResults(results: SearchItem[], highlightQuery: string): SearchCardItem[] {
    return results.map((item) => {
      const previewText = String(item.snippet || item.title || "").trim();
      const category = String(item.module || "").trim() || this.getModuleLabel(item.module || "");
      const normalizedScore = this.normalizeSearchScore(item.score);

      return {
        id: item.id,
        title: item.title,
        titleSegments: this.highlightSegments(item.title, highlightQuery),
        summary: previewText,
        formula: previewText,
        formulaHtml: renderMixedTextHtml(previewText || item.title),
        formulaText: previewText,
        module: category,
        category,
        tags: category ? [category] : [],
        level: "-",
        freq: "-",
        score: normalizedScore,
        searchScore: normalizedScore,
        recentScore: 0,
        weight: normalizedScore,
        usage: previewText || "后端结果暂无补充摘要",
      };
    });
  },

  /**
   * 把后端建议词适配成现有建议列表结构。
   *
   * 建议接口目前只返回字符串数组，因此这里补一个轻量的占位 id/score，
   * 让现有 WXML 无需改动。
   */
  buildRemoteSuggestions(suggestions: string[]): SearchSuggestion[] {
    const seen: Record<string, true> = {};

    return suggestions.reduce<SearchSuggestion[]>((result, text, index) => {
      const normalizedText = String(text || "").trim();

      if (!normalizedText || seen[normalizedText]) {
        return result;
      }

      seen[normalizedText] = true;

      result.push({
        text: normalizedText,
        id: "API",
        score: suggestions.length - index,
      });

      return result;
    }, []);
  },

  /**
   * 为后端结果构造一份最小可用的调试信息。
   *
   * 这样既能保留现有调试面板，也能明确区分这批结果来自 REST API。
   */
  buildRemoteDebugInfo(
    query: string,
    suggestions: SearchSuggestion[],
    results: SearchItem[],
  ): SearchDebugInfo {
    const normalizedQuery = query.trim().toLowerCase().replace(/\s+/g, " ");
    const topMatches: SearchDebugMatch[] = results.slice(0, 5).map((item) => ({
      id: item.id,
      title: item.title,
      score: this.normalizeSearchScore(item.score),
      matchedFieldsLabel: "server-result",
      reasonSummary: this.buildRemoteReasonSummary(item),
    }));

    return {
      normalizedQuery,
      lookupTokens: this.buildLookupTokens(normalizedQuery),
      termHitCount: 0,
      prefixHitCount: 0,
      suggestionHitCount: suggestions.length,
      resultCount: results.length,
      fallbackUsed: false,
      topSuggestions: suggestions.slice(0, 5),
      topMatches,
    };
  },

  /**
   * 后端结果的简易命中摘要。
   */
  buildRemoteReasonSummary(item: SearchItem): string {
    if (item.snippet) {
      return "由 REST 搜索接口返回，预览内容来自 snippet";
    }

    return "由 REST 搜索接口返回";
  },

  /**
   * 给调试面板构造一组稳定的 lookup tokens。
   */
  buildLookupTokens(normalizedQuery: string): string[] {
    if (!normalizedQuery) {
      return [];
    }

    const compact = normalizedQuery.replace(/\s+/g, "");
    const parts = normalizedQuery.split(/\s+/);
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
  },

  /**
   * 将结果中出现的分类并入当前 tabs。
   */
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

  /**
   * 生成新的搜索任务序号。
   */
  createSearchTaskId(): number {
    this.searchTaskId += 1;
    return this.searchTaskId;
  },

  /**
   * 判断一个异步搜索结果是否仍然有效。
   */
  isLatestSearchTask(taskId: number): boolean {
    return taskId === this.searchTaskId;
  },

  /**
   * 按当前分类过滤结果。
   *
   * 如果当前 tab 已不在本轮结果中，则回退显示全部结果，
   * 避免后端分类和本地 tab 命名暂时不完全一致时出现“明明有结果但列表为空”。
   */
  filterResults(results: SearchCardItem[], activeTab: string): SearchCardItem[] {
    if (activeTab === "全部") {
      return results;
    }

    const hasMatchedCategory = results.some((item) => item.category === activeTab);
    if (!hasMatchedCategory) {
      return results;
    }

    return results.filter((item) => item.category === activeTab);
  },

  /**
   * 把标题拆成普通片段和高亮片段，供 WXML 逐段渲染。
   */
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

  /**
   * 难度字段格式化。
   */
  formatDifficulty(difficulty?: number): string {
    const value = Math.max(1, Math.min(5, Math.round(difficulty || 1)));
    return `${value} / 5`;
  },

  /**
   * 频率字段格式化。
   */
  formatFrequency(examFrequency?: number): string {
    return `${Math.round((examFrequency || 0) * 100)}%`;
  },

  /**
   * 将后端分数统一收敛成适合页面显示的小数格式。
   */
  normalizeSearchScore(score?: number): number {
    const numericScore = Number(score || 0);

    if (!Number.isFinite(numericScore)) {
      return 0;
    }

    return Math.round(numericScore * 10) / 10;
  },

  /**
   * 计算头部统计区的百分比。
   */
  calculateRate(count: number, total: number): number {
    if (total <= 0) {
      return 0;
    }

    return Math.round((count / total) * 100);
  },

  /**
   * 模块英文代号到中文展示文案的兜底映射。
   */
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
