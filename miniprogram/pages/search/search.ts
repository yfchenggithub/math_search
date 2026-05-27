import type { ResultItem } from "../../types/search";
import { FEATURE_FLAGS } from "../../config/feature-flags";
import { renderMath } from "../../utils/math-render";
import {
  formatPdfRemainingTime,
  getPdfEntitlement,
  isPdfEntitlementActive,
} from "../../utils/pdf-entitlement";
import { unlockPdfEntitlement } from "../../utils/pdf-entitlement-unlock";
import { getErrorMessage } from "../../utils/request";
import { createLogger } from "../../utils/logger/logger";
import type {
  SearchDebugInfo,
  SearchSuggestion,
  SearchViewItem,
} from "../../utils/search-engine";
import {
  homeRecommendWithFacade,
  getSearchMeta,
  initSearchEngine,
  suggestWithFacade,
  searchWithFacade,
} from "../../utils/search-engine";
import {
  buildHomeSharePayload,
  buildHomeTimelinePayload,
  showShareMenuSafely,
} from "../../utils/share";

const TAB_ALL = "all";
const SET_DATA_WARN_BYTES = 180 * 1024;
const PDF_ENTITLEMENT_REFRESH_INTERVAL_MS = 30 * 1000;
const HOME_RECOMMEND_LIMIT = 4;
const NO_RESULT_RECOMMEND_LIMIT = 2;
const HOME_RECOMMEND_TAG_LIMIT = 3;
const searchPageLogger = createLogger("search-page");
const ENABLE_PDF_ENTITLEMENT_FLOW = FEATURE_FLAGS.ENABLE_PDF_ENTITLEMENT_FLOW;

const PDF_COPY = {
  lockedTitle: "\u9ad8\u6e05 PDF \u4e0b\u8f7d\u6743\u76ca",
  lockedSubtitle: "\u5185\u5bb9\u53ef\u514d\u8d39\u67e5\u770b\uff0cPDF \u4e0b\u8f7d\u9700\u89e3\u9501",
  lockedDescription: "\u770b\u4e00\u6b21\u89c6\u9891\uff0c2 \u5c0f\u65f6\u5185\u53ef\u4e0b\u8f7d PDF",
  lockedHint: "\u9002\u5408\u79bb\u7ebf\u67e5\u770b\u3001\u6253\u5370\u6574\u7406",
  lockedAction: "\u89e3\u9501\u4e0b\u8f7d\u6743\u76ca",
  unlockedTitle: "PDF \u4e0b\u8f7d\u6743\u76ca\u5df2\u5f00\u542f",
  unlockedSubtitle: "2 \u5c0f\u65f6\u5185\u53ef\u4e0b\u8f7d PDF",
  unlockedHint: "\u6743\u76ca\u5230\u671f\u540e\u53ef\u518d\u6b21\u89e3\u9501",
  unlockedAction: "\u67e5\u770b\u53ef\u4e0b\u8f7d\u5185\u5bb9",
  remainingPrefix: "\u5269\u4f59",
  searchFirstToast: "\u8bf7\u5148\u641c\u7d22\u9700\u8981\u67e5\u770b\u7684\u5185\u5bb9",
  unlockSuccessToast: "\u4e0b\u8f7d\u6743\u76ca\u5df2\u5f00\u542f\uff0c2 \u5c0f\u65f6\u5185\u53ef\u4e0b\u8f7d PDF",
  unlockDebugToast: "\u5f00\u53d1\u73af\u5883\uff1a\u5df2\u6a21\u62df\u5f00\u542f PDF \u4e0b\u8f7d\u6743\u76ca",
  unlockUnavailableToast: "\u6682\u65f6\u65e0\u6cd5\u6253\u5f00\u89c6\u9891\uff0c\u8bf7\u7a0d\u540e\u518d\u8bd5",
  unlockNeedFullWatchToast: "\u9700\u8981\u5b8c\u6574\u89c2\u770b\u540e\u624d\u80fd\u89e3\u9501\u4e0b\u8f7d\u6743\u76ca",
  actionPending: "\u5904\u7406\u4e2d...",
} as const;

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

const HOME_RECOMMEND_COPY = {
  hotTitle: "热门结论",
  hotSubtitle: "大家常用的结论与模型",
  recentTitle: "最近更新",
  recentSubtitle: "新加入的公式、结论与模型",
  commonTitle: "常用模型",
  commonSubtitle: "按使用场景快速查看",
  unavailableToast: "暂时无法打开该内容",
  defaultSummary: "按分类查看相关结论与模型",
  pdfTag: "可下载 PDF",
} as const;

type HighlightSegment = {
  text: string;
  highlight: boolean;
};

type HomeRecommendItem = {
  id: string;
  title: string;
  summary: string;
  module?: string;
  tags: string[];
  hasPdf: boolean;
  updatedAt?: string | number;
  rank?: number;
};

type HomeRecommendSection = {
  key: string;
  title: string;
  subtitle: string;
  items: HomeRecommendItem[];
};

type HomeRecommendSeed = HomeRecommendItem & {
  sourceOrder: number;
  rawTags: string[];
  hotScore: number;
  searchScore: number;
  rankValue: number;
  updatedAtTs: number;
  createdAtTs: number;
  hotFlag: boolean;
  commonFlag: boolean;
};

type HomeRecommendState = {
  sections: HomeRecommendSection[];
  noResultItems: HomeRecommendItem[];
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

type PdfEntitlementState = {
  unlocked: boolean;
  expireAt: number | null;
  remainingSeconds: number;
};

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
    listScrollTop: 0,
    homeRecommendSections: [] as HomeRecommendSection[],
    noResultRecommendItems: [] as HomeRecommendItem[],
    showPdfEntitlementCard: ENABLE_PDF_ENTITLEMENT_FLOW,
    pdfEntitlement: {
      unlocked: false,
      expireAt: null,
      remainingSeconds: 0,
    } as PdfEntitlementState,
    pdfEntitlementTitle: PDF_COPY.lockedTitle as string,
    pdfEntitlementSubtitle: PDF_COPY.lockedSubtitle as string,
    pdfEntitlementDescription: PDF_COPY.lockedDescription as string,
    pdfEntitlementHint: PDF_COPY.lockedHint as string,
    pdfEntitlementActionText: PDF_COPY.lockedAction as string,
    pdfEntitlementActionBusy: false,
  },

  searchTaskId: 0,
  suggestTaskId: 0,
  allResultsCache: [] as SearchCardItem[],
  pdfEntitlementTimer: null as number | null,
  shareMenuReady: false,

  onLoad() {
    this.ensureShareMenu();
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

    void this.loadHomeRecommendations();

    if (ENABLE_PDF_ENTITLEMENT_FLOW) {
      this.refreshPdfEntitlementState();
      this.startPdfEntitlementTimerIfNeeded();
    } else {
      this.stopPdfEntitlementTimer();
    }
  },

  onShow() {
    this.ensureShareMenu();

    if (ENABLE_PDF_ENTITLEMENT_FLOW) {
      this.refreshPdfEntitlementState();
      this.startPdfEntitlementTimerIfNeeded();
    }
  },

  onHide() {
    this.stopPdfEntitlementTimer();
  },

  onUnload() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    this.stopPdfEntitlementTimer();
  },

  ensureShareMenu() {
    if (this.shareMenuReady) {
      return;
    }

    this.shareMenuReady = true;
    showShareMenuSafely();
  },

  onShareAppMessage() {
    return buildHomeSharePayload("share");
  },

  onShareTimeline() {
    return buildHomeTimelinePayload();
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

    void this.executeSearch(text);
  },

  onConfirm() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    this.createSuggestTaskId();
    this.setData({
      focus: false,
      suggestions: [],
      suggestLoading: false,
      suggestErrorMessage: "",
    });
    void this.executeSearch(this.data.query);
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
      wx.showToast({
        title: HOME_RECOMMEND_COPY.unavailableToast,
        icon: "none",
      });
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
    });
  },

  onPdfEntitlementActionTap() {
    if (!ENABLE_PDF_ENTITLEMENT_FLOW) {
      return;
    }

    if (this.data.pdfEntitlementActionBusy) {
      return;
    }

    if (this.data.pdfEntitlement.unlocked) {
      this.scrollToDownloadableContent();
      return;
    }

    void this.handleUnlockPdfEntitlement();
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

  async executeSearch(query: string) {
    const rawQuery = String(query || "");
    const trimmedQuery = rawQuery.trim();
    const searchTaskId = this.createSearchTaskId();

    if (!trimmedQuery) {
      this.applyEmptySearchState(rawQuery);
      return;
    }

    this.setDataWithTrace("search_loading_start", {
      query: rawQuery,
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

  async loadHomeRecommendations() {
    try {
      const response = await homeRecommendWithFacade(80);
      const recommendState = this.buildHomeRecommendationState(response.items);

      this.setData({
        homeRecommendSections: recommendState.sections,
        noResultRecommendItems: recommendState.noResultItems,
      });
    } catch (error) {
      searchPageLogger.warn("home_recommend_load_failed", { error });
      this.setData({
        homeRecommendSections: [],
        noResultRecommendItems: [],
      });
    }
  },

  buildHomeRecommendationState(items: SearchViewItem[]): HomeRecommendState {
    const seeds = this.buildHomeRecommendationSeeds(items);

    if (seeds.length <= 0) {
      return {
        sections: [],
        noResultItems: [],
      };
    }

    const sections: HomeRecommendSection[] = [];
    const usedIds: Record<string, true> = {};

    const hotSeeds = this.pickHomeRecommendSeeds(
      seeds.slice().sort((left, right) => this.compareHotRecommendSeeds(left, right)),
      HOME_RECOMMEND_LIMIT,
    );

    if (hotSeeds.length > 0) {
      sections.push({
        key: "hot",
        title: HOME_RECOMMEND_COPY.hotTitle,
        subtitle: HOME_RECOMMEND_COPY.hotSubtitle,
        items: hotSeeds.map((seed) => this.toHomeRecommendItem(seed)),
      });

      hotSeeds.forEach((seed) => {
        usedIds[seed.id] = true;
      });
    }

    if (seeds.length >= 2) {
      const recentSeeds = this.pickHomeRecommendSeeds(
        seeds.slice().sort((left, right) => this.compareRecentRecommendSeeds(left, right)),
        HOME_RECOMMEND_LIMIT,
        usedIds,
      );

      if (recentSeeds.length > 0) {
        sections.push({
          key: "recent",
          title: HOME_RECOMMEND_COPY.recentTitle,
          subtitle: HOME_RECOMMEND_COPY.recentSubtitle,
          items: recentSeeds.map((seed) => this.toHomeRecommendItem(seed)),
        });

        recentSeeds.forEach((seed) => {
          usedIds[seed.id] = true;
        });
      }
    }

    if (seeds.length >= 3) {
      const commonSeeds = this.pickHomeRecommendSeeds(
        seeds.slice().sort((left, right) => this.compareCommonRecommendSeeds(left, right)),
        HOME_RECOMMEND_LIMIT,
        usedIds,
      );

      if (commonSeeds.length > 0) {
        sections.push({
          key: "common",
          title: HOME_RECOMMEND_COPY.commonTitle,
          subtitle: HOME_RECOMMEND_COPY.commonSubtitle,
          items: commonSeeds.map((seed) => this.toHomeRecommendItem(seed)),
        });
      }
    }

    const noResultItems = hotSeeds
      .slice(0, NO_RESULT_RECOMMEND_LIMIT)
      .map((seed) => this.toHomeRecommendItem(seed));

    return {
      sections,
      noResultItems,
    };
  },

  buildHomeRecommendationSeeds(items: SearchViewItem[]): HomeRecommendSeed[] {
    const seeds: HomeRecommendSeed[] = [];

    items.forEach((item, index) => {
      const id = String(item.id || "").trim();
      if (!id) {
        return;
      }

      const title = String(item.title || id).trim() || id;
      const summary = this.resolveSummaryText(item) || HOME_RECOMMEND_COPY.defaultSummary;
      const module = this.resolveCategory(item);
      const rawTags = Array.isArray(item.tags)
        ? item.tags
          .map((tag) => String(tag || "").trim())
          .filter((tag) => Boolean(tag))
        : [];

      const hasPdf = this.resolveRecommendHasPdf(item, rawTags);
      const updatedAtTs = this.resolveRecommendTimestamp(item, "updated");
      const createdAtTs = this.resolveRecommendTimestamp(item, "created");
      const rankValue = this.normalizeOptionalNumber(item.rank) || 0;
      const hotScore = this.normalizeOptionalNumber(item.hotScore) || 0;
      const searchScore = this.normalizeOptionalNumber(item.searchScore) || 0;
      const hotFlag = this.resolveRecommendHotFlag(item, rawTags, hotScore);
      const commonFlag = this.resolveRecommendCommonFlag(module, rawTags);

      seeds.push({
        id,
        title,
        summary,
        module,
        tags: this.buildRecommendTags(module, rawTags, hasPdf),
        hasPdf,
        updatedAt: updatedAtTs > 0 ? updatedAtTs : undefined,
        rank: rankValue > 0 ? rankValue : undefined,
        sourceOrder: index,
        rawTags,
        hotScore,
        searchScore,
        rankValue,
        updatedAtTs,
        createdAtTs,
        hotFlag,
        commonFlag,
      });
    });

    return seeds;
  },

  pickHomeRecommendSeeds(
    sortedSeeds: HomeRecommendSeed[],
    limit: number,
    usedIds: Record<string, true> = {},
  ): HomeRecommendSeed[] {
    const result: HomeRecommendSeed[] = [];

    for (let index = 0; index < sortedSeeds.length; index += 1) {
      const seed = sortedSeeds[index];
      if (!seed.id || usedIds[seed.id]) {
        continue;
      }

      result.push(seed);
      if (result.length >= limit) {
        break;
      }
    }

    return result;
  },

  toHomeRecommendItem(seed: HomeRecommendSeed): HomeRecommendItem {
    return {
      id: seed.id,
      title: seed.title,
      summary: seed.summary || HOME_RECOMMEND_COPY.defaultSummary,
      module: seed.module,
      tags: seed.tags,
      hasPdf: seed.hasPdf,
      updatedAt: seed.updatedAt,
      rank: seed.rank,
    };
  },

  compareHotRecommendSeeds(left: HomeRecommendSeed, right: HomeRecommendSeed): number {
    const leftScore = this.buildHotRecommendScore(left);
    const rightScore = this.buildHotRecommendScore(right);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return this.compareRecommendSeedFallback(left, right);
  },

  compareRecentRecommendSeeds(left: HomeRecommendSeed, right: HomeRecommendSeed): number {
    if (right.updatedAtTs !== left.updatedAtTs) {
      return right.updatedAtTs - left.updatedAtTs;
    }

    if (right.createdAtTs !== left.createdAtTs) {
      return right.createdAtTs - left.createdAtTs;
    }

    return right.sourceOrder - left.sourceOrder;
  },

  compareCommonRecommendSeeds(left: HomeRecommendSeed, right: HomeRecommendSeed): number {
    const leftScore = this.buildCommonRecommendScore(left);
    const rightScore = this.buildCommonRecommendScore(right);

    if (rightScore !== leftScore) {
      return rightScore - leftScore;
    }

    return this.compareRecommendSeedFallback(left, right);
  },

  compareRecommendSeedFallback(left: HomeRecommendSeed, right: HomeRecommendSeed): number {
    if (right.rankValue !== left.rankValue) {
      return right.rankValue - left.rankValue;
    }

    if (right.searchScore !== left.searchScore) {
      return right.searchScore - left.searchScore;
    }

    return left.sourceOrder - right.sourceOrder;
  },

  buildHotRecommendScore(seed: HomeRecommendSeed): number {
    let score = 0;

    if (seed.hotFlag) {
      score += 1200;
    }

    if (seed.commonFlag) {
      score += 120;
    }

    score += seed.hotScore * 6;
    score += seed.rankValue * 2;
    score += seed.searchScore;

    return score;
  },

  buildCommonRecommendScore(seed: HomeRecommendSeed): number {
    let score = 0;

    if (seed.commonFlag) {
      score += 1000;
    }

    if (this.isCommonModule(seed.module)) {
      score += 260;
    }

    score += seed.rankValue * 2;
    score += seed.hotScore * 3;
    score += seed.searchScore;

    return score;
  },

  buildRecommendTags(module: string, rawTags: string[], hasPdf: boolean): string[] {
    const tags: string[] = [];
    const seen: Record<string, true> = {};

    const appendTag = (rawTag: string) => {
      const tag = String(rawTag || "").trim();
      if (!tag || seen[tag] || tags.length >= HOME_RECOMMEND_TAG_LIMIT) {
        return;
      }

      seen[tag] = true;
      tags.push(tag);
    };

    appendTag(module);

    rawTags.forEach((tag) => {
      appendTag(tag);
    });

    if (hasPdf) {
      appendTag(HOME_RECOMMEND_COPY.pdfTag);
    }

    return tags;
  },

  resolveRecommendHasPdf(item: SearchViewItem, rawTags: string[]): boolean {
    const dynamicItem = item as SearchViewItem & Record<string, unknown>;

    const boolFields = ["hasPdf", "pdfAvailable", "pdf_available"];
    for (let index = 0; index < boolFields.length; index += 1) {
      const value = dynamicItem[boolFields[index]];
      if (typeof value === "boolean") {
        return value;
      }
    }

    const urlFields = ["pdfUrl", "pdf_url", "pdfPath", "pdf_path"];
    for (let index = 0; index < urlFields.length; index += 1) {
      const value = String(dynamicItem[urlFields[index]] || "").trim();
      if (value) {
        return true;
      }
    }

    return rawTags.some((tag) => tag.toLowerCase().includes("pdf"));
  },

  resolveRecommendTimestamp(item: SearchViewItem, mode: "updated" | "created"): number {
    const dynamicItem = item as SearchViewItem & Record<string, unknown>;
    const fields = mode === "updated"
      ? ["updated_at", "updatedAt", "update_time", "updateTime", "modified_at", "modifiedAt"]
      : ["created_at", "createdAt", "created_time", "createdTime"];

    for (let index = 0; index < fields.length; index += 1) {
      const value = this.parseRecommendTimestamp(dynamicItem[fields[index]]);
      if (value > 0) {
        return value;
      }
    }

    return 0;
  },

  parseRecommendTimestamp(value: unknown): number {
    if (typeof value === "number" && Number.isFinite(value)) {
      if (value > 1e12) {
        return Math.floor(value);
      }

      if (value > 1e9) {
        return Math.floor(value * 1000);
      }

      return 0;
    }

    const text = String(value || "").trim();
    if (!text) {
      return 0;
    }

    const numeric = Number(text);
    if (Number.isFinite(numeric)) {
      return this.parseRecommendTimestamp(numeric);
    }

    const parsed = Date.parse(text);
    if (!Number.isFinite(parsed)) {
      return 0;
    }

    return parsed;
  },

  resolveRecommendHotFlag(
    item: SearchViewItem,
    rawTags: string[],
    hotScore: number,
  ): boolean {
    const dynamicItem = item as SearchViewItem & Record<string, unknown>;
    const hotFields = ["hot", "is_hot", "isHot"];

    for (let index = 0; index < hotFields.length; index += 1) {
      const value = dynamicItem[hotFields[index]];
      if (typeof value === "boolean") {
        return value;
      }

      if (typeof value === "number") {
        return value > 0;
      }
    }

    if (hotScore >= 80) {
      return true;
    }

    return rawTags.some((tag) => {
      const normalized = tag.toLowerCase();
      return normalized.includes("高频")
        || normalized.includes("热门")
        || normalized.includes("hot");
    });
  },

  resolveRecommendCommonFlag(module: string, rawTags: string[]): boolean {
    if (this.isCommonModule(module)) {
      return true;
    }

    return rawTags.some((tag) => {
      const normalized = tag.toLowerCase();
      return normalized.includes("常用")
        || normalized.includes("基础")
        || normalized.includes("common");
    });
  },

  isCommonModule(module?: string): boolean {
    const normalized = String(module || "").trim().toLowerCase();
    if (!normalized) {
      return false;
    }

    const moduleKeywords = [
      "不等式",
      "函数",
      "圆锥",
      "导数",
      "三角函数",
      "inequality",
      "function",
      "conic",
      "derivative",
      "trigonometry",
    ];

    return moduleKeywords.some((keyword) => normalized.includes(keyword));
  },

  normalizeOptionalNumber(value: unknown): number | null {
    if (typeof value === "number" && Number.isFinite(value)) {
      return value;
    }

    const parsed = Number(value);
    if (!Number.isFinite(parsed)) {
      return null;
    }

    return parsed;
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

  refreshPdfEntitlementState() {
    const entitlement = getPdfEntitlement();
    const isUnlocked = isPdfEntitlementActive(entitlement);
    const normalizedEntitlement: PdfEntitlementState = isUnlocked
      ? entitlement
      : {
        unlocked: false,
        expireAt: null,
        remainingSeconds: 0,
      };

    const nextData = isUnlocked
      ? {
        pdfEntitlement: normalizedEntitlement,
        pdfEntitlementTitle: PDF_COPY.unlockedTitle,
        pdfEntitlementSubtitle: PDF_COPY.unlockedSubtitle,
        pdfEntitlementDescription: `${PDF_COPY.remainingPrefix}${formatPdfRemainingTime(normalizedEntitlement.remainingSeconds)}`,
        pdfEntitlementHint: PDF_COPY.unlockedHint,
        pdfEntitlementActionText: PDF_COPY.unlockedAction,
      }
      : {
        pdfEntitlement: normalizedEntitlement,
        pdfEntitlementTitle: PDF_COPY.lockedTitle,
        pdfEntitlementSubtitle: PDF_COPY.lockedSubtitle,
        pdfEntitlementDescription: PDF_COPY.lockedDescription,
        pdfEntitlementHint: PDF_COPY.lockedHint,
        pdfEntitlementActionText: PDF_COPY.lockedAction,
      };

    this.setData(nextData);

    if (!isUnlocked) {
      this.stopPdfEntitlementTimer();
    }
  },

  startPdfEntitlementTimerIfNeeded() {
    if (this.pdfEntitlementTimer !== null) {
      return;
    }

    if (!this.data.pdfEntitlement.unlocked) {
      return;
    }

    this.pdfEntitlementTimer = setInterval(() => {
      this.refreshPdfEntitlementState();
    }, PDF_ENTITLEMENT_REFRESH_INTERVAL_MS);
  },

  stopPdfEntitlementTimer() {
    if (this.pdfEntitlementTimer === null) {
      return;
    }

    clearInterval(this.pdfEntitlementTimer);
    this.pdfEntitlementTimer = null;
  },

  scrollToDownloadableContent() {
    if (this.data.results.length <= 0) {
      wx.showToast({
        title: PDF_COPY.searchFirstToast,
        icon: "none",
      });
      return;
    }

    const nextScrollTop = this.data.listScrollTop === 0 ? 1 : 0;
    this.setData({
      listScrollTop: nextScrollTop,
    });
  },

  async handleUnlockPdfEntitlement() {
    if (!ENABLE_PDF_ENTITLEMENT_FLOW) {
      return;
    }

    if (this.data.pdfEntitlementActionBusy) {
      return;
    }

    this.setData({
      pdfEntitlementActionBusy: true,
      pdfEntitlementActionText: PDF_COPY.actionPending,
    });

    try {
      const unlockResult = await unlockPdfEntitlement();
      if (unlockResult.unlocked) {
        this.refreshPdfEntitlementState();
        this.startPdfEntitlementTimerIfNeeded();
        wx.showToast({
          title: unlockResult.source === "mock"
            ? PDF_COPY.unlockDebugToast
            : PDF_COPY.unlockSuccessToast,
          icon: "none",
        });
        return;
      }

      if (unlockResult.reason === "cancelled") {
        wx.showToast({
          title: PDF_COPY.unlockNeedFullWatchToast,
          icon: "none",
        });
        return;
      }

      wx.showToast({
        title: PDF_COPY.unlockUnavailableToast,
        icon: "none",
      });
    } catch (error) {
      searchPageLogger.warn("unlock_pdf_entitlement_failed", { error });
      wx.showToast({
        title: PDF_COPY.unlockUnavailableToast,
        icon: "none",
      });
    } finally {
      this.setData({
        pdfEntitlementActionBusy: false,
      });
      this.refreshPdfEntitlementState();
      this.startPdfEntitlementTimerIfNeeded();
    }
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
