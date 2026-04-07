/**
 * 搜索页页面控制器。
 *
 * 这个文件负责把“本地搜索索引返回的数据”整理成页面可以直接消费的展示结构，
 * 同时承接搜索输入、联想建议、分类筛选、调试面板和结果跳转。
 *
 * 在当前仓库中的职责分工：
 * - 本文件：页面状态管理、事件响应、结果展示层适配。
 * - `search-engine.ts`：本地索引初始化、查询、排序、调试信息生成。
 * - `math-render.ts`：把搜索结果中的核心公式渲染成可在小程序中展示的 HTML。
 *
 * 推荐阅读顺序：
 * 1. `onLoad`：搜索页初始化做了什么。
 * 2. `onInput` / `executeSearch`：搜索请求如何从输入流转到页面结果。
 * 3. `buildResults`：搜索引擎结果如何被包装成 UI 卡片。
 * 4. `filterResults` / `highlightSegments`：页面层的二次展示处理。
 */
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

// 输入防抖计时器。
// 搜索是本地索引查询，但在连续输入时仍然会触发一整套结果构建和 setData，
// 这里做轻量防抖可以减少无意义刷新，让输入手感更稳定。
let timer: number | null = null;

/**
 * 搜索页的整体流程：
 * 1. 页面加载时初始化搜索引擎，并读取搜索库的统计信息。
 * 2. 用户输入后经过极短防抖，统一进入 `executeSearch`。
 * 3. `executeSearch` 从搜索引擎拿到 suggestions / results / debug。
 * 4. 页面把原始 `SearchResult` 转成更贴近 UI 的 `SearchCardItem`。
 * 5. 点击 tab 只在前端过滤已有结果，不重复查询索引。
 */
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
   * 页面初始化。
   *
   * 主要用途：
   * - 预热本地搜索索引，避免第一次输入时才初始化导致卡顿。
   * - 获取搜索库元信息，用于头部统计和分类 tab。
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
   * 输入框实时输入事件。
   *
   * 输入：
   * - `e.detail.value`：当前输入框中的原始文本。
   *
   * 输出：
   * - 更新 query / 清空按钮状态。
   * - 通过短防抖触发搜索。
   */
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

  /**
   * 点击联想建议时，以建议词直接执行搜索。
   * 这里会顺带收起建议列表，让结果页更聚焦。
   */
  onSuggestionTap(e: any) {
    const text = e.currentTarget.dataset.text as string;
    this.executeSearch(text, true);
  },

  /**
   * 键盘确认搜索。
   * 与点击联想词一样，都会隐藏建议列表，直接进入结果态。
   */
  onConfirm() {
    this.executeSearch(this.data.query, true);
  },

  /**
   * 清空搜索状态。
   *
   * 这里会把输入、联想、结果和调试信息一起清掉，
   * 让页面恢复到“尚未开始搜索”的初始状态。
   */
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

  /**
   * 调试面板展开/收起。
   *
   * 搜索引擎会返回命中 token、排序原因等信息，
   * 这个开关主要服务开发和调试阶段。
   */
  onToggleDebug() {
    this.setData({
      debugExpanded: !this.data.debugExpanded,
    });
  },

  /**
   * 分类 tab 切换。
   *
   * 注意：这里不会重新调用搜索引擎，而是对 `allResults` 做前端过滤。
   * 这样可以减少重复计算，并保持切换 tab 的即时反馈。
   */
  onTabTap(e: any) {
    const tab = e.currentTarget.dataset.tab as string;
    const filteredResults = this.filterResults(this.data.allResults as SearchCardItem[], tab);

    this.setData({
      activeTab: tab,
      results: filteredResults,
    });
  },

  /**
   * 结果卡片跳转详情页。
   *
   * 输入：
   * - 卡片 dataset 中透出的条目 id。
   */
  onDetailTap(e: any) {
    const id = e.currentTarget.dataset.id as string;

    if (!id) {
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
    });
  },

  /**
   * 搜索页的核心调度函数。
   *
   * 为什么单独抽出来：
   * - 输入实时搜索、点击建议词、点击确认键，本质上都要走同一条搜索链。
   * - 把空查询、建议词显示策略、结果构建逻辑收敛到一个函数里，页面会更好维护。
   *
   * 输入：
   * - `query`：用户当前输入的原始文本。
   * - `hideSuggestions`：本次搜索完成后是否立即隐藏建议列表。
   *
   * 输出：
   * - 更新页面 data 中的结果列表、联想建议和调试信息。
   */
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

  /**
   * 将搜索引擎结果转换为页面卡片数据。
   *
   * 这一层是“页面展示适配层”：
   * - 搜索引擎返回的是通用检索结果，强调 score / reasons / matchedFields。
   * - 搜索页需要的是标题高亮、公式 HTML、标签、难度、频率等展示字段。
   *
   * 输入：
   * - `results`：搜索引擎返回的排序结果。
   * - `highlightQuery`：当前查询词，用于标题高亮。
   *
   * 输出：
   * - 供 WXML 直接渲染的 `SearchCardItem[]`。
   */
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

  /**
   * 按当前分类筛选结果。
   *
   * 输入：
   * - `results`：完整结果集。
   * - `activeTab`：当前激活的分类名。
   */
  filterResults(results: SearchCardItem[], activeTab: string): SearchCardItem[] {
    if (activeTab === "全部") {
      return results;
    }

    return results.filter((item) => item.category === activeTab);
  },

  /**
   * 将标题拆成“普通片段 + 高亮片段”。
   *
   * 使用场景：
   * - 搜索结果标题高亮命中词。
   *
   * 输出：
   * - 按原顺序排列的片段数组，不会改变原始文本内容，只增加高亮标记。
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
   * 把难度值格式化为稳定的展示文案。
   * 这里顺手做了取整和范围夹紧，避免异常数据把 UI 撑坏。
   */
  formatDifficulty(difficulty?: number): string {
    const value = Math.max(1, Math.min(5, Math.round(difficulty || 1)));
    return `${value} / 5`;
  },

  /**
   * 将考试频率的小数值转为百分比字符串。
   */
  formatFrequency(examFrequency?: number): string {
    return `${Math.round((examFrequency || 0) * 100)}%`;
  },

  /**
   * 计算头部统计的百分比。
   *
   * 输入：
   * - `count`：命中数量。
   * - `total`：总数量。
   *
   * 输出：
   * - 四舍五入后的整数百分比。
   */
  calculateRate(count: number, total: number): number {
    if (total <= 0) {
      return 0;
    }

    return Math.round((count / total) * 100);
  },

  /**
   * 模块代号兜底映射。
   *
   * 有些搜索结果没有独立 category 时，会退回到模块名展示。
   * 这个函数的作用就是把搜索索引里的内部模块代号转换成适合页面展示的文案。
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
