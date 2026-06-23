import type { ResultItem } from "../../types/search";
import { FEATURE_FLAGS } from "../../config/feature-flags";
import {
  CONTENT_MODULE_FILTERS,
  type ContentModuleFilter,
} from "../../constants/content-modules";
import { addSearchHistory } from "../../services/history";
import { getSettings } from "../../services/settings";
import type { AuthStatusToastType } from "../../services/auth/auth-types";
import {
  submitConclusionRequest,
  type SubmitConclusionRequestPayload,
} from "../../services/api/conclusion-requests-api";
import { promptWeeklyUpdateSubscription } from "../../services/weekly-update-subscription";
import type { AuthStatusToastState } from "../../utils/auth/auth-status-feedback";
import {
  hideAuthStatusToast,
  retryAuthStatusToast,
  showAuthStatusToast,
  subscribeAuthStatusToast,
} from "../../utils/auth/auth-status-feedback";
import {
  trackEvent,
  trackPageView,
  trackSearch,
  trackShare,
} from "../../utils/analytics";
import {
  buildConclusionCardPreview,
  type ConclusionCardPreviewType,
} from "../../utils/conclusion-card-preview";
import {
  formatPdfRemainingTime,
  getPdfEntitlement,
  isPdfEntitlementActive,
} from "../../utils/pdf-entitlement";
import { formatBeijingDateTime } from "../../utils/beijing-time";
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
const TAB_HOT = "hot";
const TAB_COMMON = "common";
const TAB_MODULE_TOGGLE = "__module_toggle__";
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

type HomeCopy = Record<keyof typeof HOME_COPY, string>;
const DEFAULT_HOME_COPY: HomeCopy = HOME_COPY;

function normalizeHomeMetaTotal(value: unknown): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return 0;
  }

  return Math.round(parsed);
}

function buildHomeMetaSubtitle(total: unknown, generatedAt: unknown): string {
  const totalCount = normalizeHomeMetaTotal(total);
  const updatedAtText = formatBeijingDateTime(
    generatedAt as string | number | Date | null | undefined,
    { fallback: "", includeYear: false },
  );

  if (totalCount > 0 && updatedAtText) {
    return `收录${totalCount}条 · 更新于 ${updatedAtText}`;
  }

  if (totalCount > 0) {
    return `收录${totalCount}条`;
  }

  if (updatedAtText) {
    return `更新于 ${updatedAtText}`;
  }

  return HOME_COPY.subtitle;
}

function buildHomeCopyWithMeta(total: unknown, generatedAt: unknown): HomeCopy {
  return {
    ...HOME_COPY,
    subtitle: buildHomeMetaSubtitle(total, generatedAt),
  };
}

const CONCLUSION_REQUEST_QUERY_MAX_LENGTH = 40;
const CONCLUSION_REQUEST_NOTE_MAX_LENGTH = 100;
const CONCLUSION_REQUEST_COPY = {
  emptyToast: "先写下你想找的结论",
  submitSuccessToast: "已收到，这条结论已进入更新清单。",
  submitFailedToast: "提交失败，请稍后再试",
} as const;

type QuickFilterAction = "filter" | "toggle";

type QuickFilter = {
  key: string;
  label: string;
  action?: QuickFilterAction;
};

type ModuleFilter = QuickFilter & ContentModuleFilter;

const QUICK_FILTERS: QuickFilter[] = [
  { key: TAB_ALL, label: "全部" },
  { key: TAB_HOT, label: "高频" },
  { key: TAB_COMMON, label: "常用" },
];

const MODULE_FILTERS: ModuleFilter[] = CONTENT_MODULE_FILTERS;

const FILTER_KEYWORDS: Record<string, string[]> = {
  inequality: ["不等式", "inequality"],
  function: ["函数", "function", "trigonometry", "三角函数"],
  conic: ["圆锥", "conic", "椭圆", "抛物线", "双曲线"],
  derivative: ["导数", "derivative", "微分"],
};

function findModuleFilterByKey(key: string): ModuleFilter | null {
  for (let index = 0; index < MODULE_FILTERS.length; index += 1) {
    if (MODULE_FILTERS[index].key === key) {
      return MODULE_FILTERS[index];
    }
  }

  return null;
}

function buildPrimaryQuickFilters(
  activeTab: string,
  isModuleExpanded: boolean,
): QuickFilter[] {
  const toggleFilter: QuickFilter = {
    key: TAB_MODULE_TOGGLE,
    label: isModuleExpanded ? "收起 ∧" : "更多 ∨",
    action: "toggle",
  };

  if (isModuleExpanded) {
    return [
      { key: TAB_ALL, label: "全部" },
      { key: TAB_HOT, label: "高频" },
      { key: TAB_COMMON, label: "常用" },
      toggleFilter,
    ];
  }

  const activeModule = findModuleFilterByKey(activeTab);
  if (activeModule) {
    return [
      { key: TAB_ALL, label: "全部" },
      { key: activeModule.key, label: activeModule.label },
      { key: TAB_COMMON, label: "常用" },
      toggleFilter,
    ];
  }

  return [
    { key: TAB_ALL, label: "全部" },
    { key: TAB_HOT, label: "高频" },
    { key: TAB_COMMON, label: "常用" },
    toggleFilter,
  ];
}

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

type CardPreviewType = ConclusionCardPreviewType;

type HomeRecommendItem = {
  id: string;
  title: string;
  summary: string;
  module?: string;
  tags: string[];
  hasPdf: boolean;
  previewType: CardPreviewType;
  previewHtml: string;
  previewText: string;
  previewImage: string;
  previewImageWidth: number;
  previewImageHeight: number;
  previewFallbackText: string;
  updatedAt?: string | number;
  favoriteCount: number;
  viewCount: number;
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
  coreFormula: string;
  moduleKey: string;
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
      id?: string;
      module?: string;
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

type SearchDetailTapPayload = {
  id?: string;
  entry?: string;
  section?: string;
  title?: string;
  module?: string;
  hasPdf?: string | boolean;
};

type SearchDetailTapEvent = {
  currentTarget?: {
    dataset?: SearchDetailTapPayload;
  };
  detail?: SearchDetailTapPayload;
};

type ExecuteSearchOptions = {
  trackSubmit?: boolean;
  entry?: string;
};

type RefreshHomePageDataOptions = {
  showCompletionToast?: boolean;
};

interface SearchCardItem extends ResultItem {
  titleSegments: HighlightSegment[];
  category: string;
  displayTags: string[];
  searchScore: number;
  previewType: CardPreviewType;
  previewHtml: string;
  previewText: string;
  previewImage: string;
  previewImageWidth: number;
  previewImageHeight: number;
  previewFallbackText: string;
  formulaHtml: string;
  formulaText: string;
  freq: string;
  updatedAt?: string | number;
  createdAt?: string | number;
  favoriteCount: number;
  viewCount: number;
}

type PdfEntitlementState = {
  unlocked: boolean;
  expireAt: number | null;
  remainingSeconds: number;
};

let timer: number | null = null;

Page({
  data: {
    homeCopy: DEFAULT_HOME_COPY,
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
    primaryQuickFilters: buildPrimaryQuickFilters(TAB_ALL, false),
    moduleFilters: MODULE_FILTERS as ModuleFilter[],
    isModuleExpanded: false,
    activeTab: TAB_ALL,
    showClear: false,
    listScrollTop: 0,
    homeRecommendSections: [] as HomeRecommendSection[],
    noResultRecommendItems: [] as HomeRecommendItem[],
    conclusionRequestDialogVisible: false,
    conclusionRequestQuery: "",
    conclusionRequestNote: "",
    conclusionRequestNoteLength: 0,
    conclusionRequestNoteMaxLength: CONCLUSION_REQUEST_NOTE_MAX_LENGTH,
    conclusionRequestSubmitting: false,
    conclusionRequestQueryFocus: false,
    conclusionRequestNoteFocus: false,
    conclusionRequestEntry: "",
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
    authStatusToastVisible: false,
    authStatusToastType: "idle" as AuthStatusToastType,
    authStatusToastTitle: "",
    authStatusToastMessage: "",
    authStatusToastRetryable: false,
    authStatusToastClosable: false,
  },

  searchTaskId: 0,
  suggestTaskId: 0,
  allResultsCache: [] as SearchCardItem[],
  homeRecommendSeeds: [] as HomeRecommendSeed[],
  pdfEntitlementTimer: null as number | null,
  shareMenuReady: false,
  homeViewTracked: false,
  unsubscribeAuthStatusToast: undefined as undefined | (() => void),

  onLoad() {
    this.ensureShareMenu();
    this.unsubscribeAuthStatusToast = subscribeAuthStatusToast((state) => {
      this.syncAuthStatusToast(state);
    });
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
    if (!this.homeViewTracked) {
      this.homeViewTracked = true;
      trackPageView(
        "home",
        {
          source: "home",
          page: "home",
        },
        {
          dedupeKey: "home_view_once",
          dedupeMs: 5 * 60 * 1000,
        },
      );
    }

    if (ENABLE_PDF_ENTITLEMENT_FLOW) {
      this.refreshPdfEntitlementState();
      this.startPdfEntitlementTimerIfNeeded();
    }
  },

  onPullDownRefresh() {
    void this.refreshHomePageData({
      showCompletionToast: true,
    }).finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async refreshHomePageData(options: RefreshHomePageDataOptions = {}) {
    const showCompletionToast = Boolean(options.showCompletionToast);
    const query = String(this.data.query || "");

    try {
      initSearchEngine();

      const meta = getSearchMeta();
      const total = meta.totalDocs;
      const hotCount = meta.hotDocCount;
      const highExamFrequencyCount = meta.highExamFrequencyCount;
      const quickFilters = this.buildQuickFilters(meta.categories);
      const activeTab = this.isKnownFilterKey(this.data.activeTab, quickFilters)
        ? this.data.activeTab
        : TAB_ALL;

      this.setData({
        total,
        hotCount,
        learned: total,
        rate1: this.calculateRate(hotCount, total),
        rate2: this.calculateRate(highExamFrequencyCount, total),
        quickFilters,
        activeTab,
        primaryQuickFilters: buildPrimaryQuickFilters(
          activeTab,
          this.data.isModuleExpanded,
        ),
      });

      const recommendationsReady = await this.loadHomeRecommendations();

      if (query.trim()) {
        await this.executeSearch(query);
        if (showCompletionToast) {
          this.showRefreshCompleteToast(recommendationsReady);
        }
        return;
      }

      this.allResultsCache = [];
      const recommendState = this.buildHomeRecommendationStateFromSeeds(
        this.homeRecommendSeeds,
        activeTab,
      );

      this.setDataWithTrace("home_refresh_empty_state", {
        loading: false,
        errorMessage: "",
        suggestLoading: false,
        suggestErrorMessage: "",
        suggestions: [],
        results: [],
        debugInfo: null,
        showClear: query.length > 0,
        homeRecommendSections: recommendState.sections,
        noResultRecommendItems: recommendState.noResultItems,
      });
      if (showCompletionToast) {
        this.showRefreshCompleteToast(recommendationsReady);
      }
    } catch (error) {
      searchPageLogger.warn("home_refresh_failed", { error });
      if (showCompletionToast) {
        showAuthStatusToast({
          type: "error",
          title: "刷新失败",
          message: getErrorMessage(error, "刷新失败，请稍后重试"),
          closable: true,
          source: "unknown",
        });
      }
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
    this.unsubscribeAuthStatusToast?.();
    this.unsubscribeAuthStatusToast = undefined;
    hideAuthStatusToast("search_unload");
  },

  ensureShareMenu() {
    if (this.shareMenuReady) {
      return;
    }

    this.shareMenuReady = true;
    showShareMenuSafely();
  },

  onShareAppMessage() {
    trackShare("share_click", {
      source: "home",
      page: "home",
      entry: "share_button",
      share_type: "app_message",
    });
    return buildHomeSharePayload("share");
  },

  onShareTimeline() {
    trackShare("share_click", {
      source: "home",
      page: "home",
      entry: "share_button",
      share_type: "timeline",
    });
    return buildHomeTimelinePayload();
  },

  noop() {},

  onWeeklyUpdateSubscribeTap() {
    void promptWeeklyUpdateSubscription({
      source: "home_weekly_entry",
      force: true,
    });
  },

  handleAuthStatusToastRetry() {
    const retried = retryAuthStatusToast();
    if (!retried) {
      hideAuthStatusToast("retry_unavailable");
    }
  },

  handleAuthStatusToastClose() {
    hideAuthStatusToast("manual_close");
  },

  syncAuthStatusToast(state: AuthStatusToastState) {
    this.setData({
      authStatusToastVisible: state.visible,
      authStatusToastType: state.type,
      authStatusToastTitle: state.title,
      authStatusToastMessage: state.message,
      authStatusToastRetryable: state.retryable,
      authStatusToastClosable: state.closable,
    });
  },

  showRefreshCompleteToast(recommendationsReady: boolean) {
    const errorMessage = String(this.data.errorMessage || "").trim();
    if (errorMessage || !recommendationsReady) {
      showAuthStatusToast({
        type: "error",
        title: "刷新失败",
        message: errorMessage || "推荐内容刷新失败，请稍后再试",
        closable: true,
        source: "unknown",
      });
      return;
    }

    const query = String(this.data.query || "").trim();
    showAuthStatusToast({
      type: "success",
      title: "刷新完成",
      message: query ? "当前搜索结果已更新" : "首页推荐已更新",
      source: "unknown",
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

  onConclusionRequestEntryTap() {
    const requestQuery = this.normalizeConclusionRequestText(
      this.data.query,
      CONCLUSION_REQUEST_QUERY_MAX_LENGTH,
    );
    const entry = this.resolveConclusionRequestEntry();
    const shouldFocusQuery = requestQuery.length <= 0;

    this.setData({
      conclusionRequestDialogVisible: true,
      conclusionRequestQuery: requestQuery,
      conclusionRequestNote: "",
      conclusionRequestNoteLength: 0,
      conclusionRequestSubmitting: false,
      conclusionRequestQueryFocus: shouldFocusQuery,
      conclusionRequestNoteFocus: !shouldFocusQuery,
      conclusionRequestEntry: entry,
      suggestions: [],
    });

    trackEvent("conclusion_request_entry_click", {
      source: "home",
      page: "home",
      entry,
      query: requestQuery,
      result_count: this.getCurrentResultCount(),
    });
  },

  onConclusionRequestQueryInput(e: SearchInputEvent) {
    const value = this.normalizeConclusionRequestText(
      e.detail.value,
      CONCLUSION_REQUEST_QUERY_MAX_LENGTH,
    );

    this.setData({
      conclusionRequestQuery: value,
    });
  },

  onConclusionRequestNoteInput(e: SearchInputEvent) {
    const value = this.normalizeConclusionRequestText(
      e.detail.value,
      CONCLUSION_REQUEST_NOTE_MAX_LENGTH,
    );

    this.setData({
      conclusionRequestNote: value,
      conclusionRequestNoteLength: value.length,
    });
  },

  onConclusionRequestCancel() {
    if (this.data.conclusionRequestSubmitting) {
      return;
    }

    if (this.data.conclusionRequestDialogVisible) {
      trackEvent("conclusion_request_cancel", {
        source: "home",
        page: "home",
        entry: this.data.conclusionRequestEntry || this.resolveConclusionRequestEntry(),
      });
    }

    this.setData({
      conclusionRequestDialogVisible: false,
      conclusionRequestQueryFocus: false,
      conclusionRequestNoteFocus: false,
    });
  },

  async onConclusionRequestSubmit() {
    if (this.data.conclusionRequestSubmitting) {
      return;
    }

    const query = this.normalizeConclusionRequestText(
      this.data.conclusionRequestQuery,
      CONCLUSION_REQUEST_QUERY_MAX_LENGTH,
    );
    const note = this.normalizeConclusionRequestText(
      this.data.conclusionRequestNote,
      CONCLUSION_REQUEST_NOTE_MAX_LENGTH,
    );

    if (!query && !note) {
      wx.showToast({
        title: CONCLUSION_REQUEST_COPY.emptyToast,
        icon: "none",
      });
      return;
    }

    const payload = this.buildConclusionRequestPayload(query, note);

    this.setData({
      conclusionRequestSubmitting: true,
      conclusionRequestQuery: query,
      conclusionRequestNote: note,
      conclusionRequestNoteLength: note.length,
    });

    trackEvent(
      "conclusion_request_submit",
      { ...payload },
      {
        dedupeKey: `conclusion_request_submit:${query}:${note}`,
        dedupeMs: 1500,
      },
    );
    searchPageLogger.info("conclusion_request_submit", payload);

    try {
      const result = await submitConclusionRequest(payload);

      trackEvent("conclusion_request_submit_success", {
        source: "home",
        page: "home",
        entry: payload.entry,
        request_id: result.id,
        status: result.status,
      });

      this.setData({
        conclusionRequestDialogVisible: false,
        conclusionRequestNote: "",
        conclusionRequestNoteLength: 0,
        conclusionRequestSubmitting: false,
        conclusionRequestQueryFocus: false,
        conclusionRequestNoteFocus: false,
        conclusionRequestEntry: "",
      });

      wx.showToast({
        title: CONCLUSION_REQUEST_COPY.submitSuccessToast,
        icon: "none",
        duration: 2200,
      });
    } catch (error) {
      searchPageLogger.warn("conclusion_request_submit_failed", {
        payload,
        error,
      });
      trackEvent("conclusion_request_submit_fail", {
        source: "home",
        page: "home",
        entry: payload.entry,
        query: payload.query,
        error,
      });
      this.setData({
        conclusionRequestSubmitting: false,
      });
      wx.showToast({
        title: getErrorMessage(error, CONCLUSION_REQUEST_COPY.submitFailedToast),
        icon: "none",
      });
    }
  },

  onSuggestionTap(e: SearchTextTapEvent) {
    const text = String(e.currentTarget.dataset.text || "");
    if (!text.trim()) {
      return;
    }

    trackSearch("home_suggest_click", {
      source: "home",
      page: "home",
      entry: "suggest_list",
      query: this.data.query,
      suggest_text: text,
      item_id: String(e.currentTarget.dataset.id || ""),
      module: String(e.currentTarget.dataset.module || ""),
    });

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

    void this.executeSearch(text, {
      trackSubmit: true,
      entry: "suggest_item",
    });
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
    void this.executeSearch(this.data.query, {
      trackSubmit: true,
      entry: "search_box",
    });
  },

  onClear() {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }

    this.createSearchTaskId();
    this.createSuggestTaskId();

    this.allResultsCache = [];
    const recommendState = this.buildHomeRecommendationStateFromSeeds(
      this.homeRecommendSeeds,
      TAB_ALL,
    );

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
      isModuleExpanded: false,
      primaryQuickFilters: buildPrimaryQuickFilters(TAB_ALL, false),
      homeRecommendSections: recommendState.sections,
      noResultRecommendItems: recommendState.noResultItems,
    });
  },

  onTabTap(e: SearchTabTapEvent) {
    const tab = String(e.currentTarget.dataset.tab || TAB_ALL);

    if (tab === TAB_MODULE_TOGGLE) {
      this.toggleModuleFilters();
      return;
    }

    const tabConfig = this.resolveQuickFilter(tab);
    trackEvent("home_quick_filter_click", {
      source: "home",
      page: "home",
      entry: "quick_filter",
      filter_key: tab,
      filter_label: tabConfig?.label || tab,
    });

    const isModuleExpanded = false;
    const filteredResults = this.filterResults(
      this.allResultsCache,
      tab,
    );
    const recommendState = this.buildHomeRecommendationStateFromSeeds(
      this.homeRecommendSeeds,
      tab,
    );

    this.setDataWithTrace("search_tab_switch", {
      activeTab: tab,
      results: filteredResults,
      isModuleExpanded,
      primaryQuickFilters: buildPrimaryQuickFilters(tab, isModuleExpanded),
      homeRecommendSections: recommendState.sections,
      noResultRecommendItems: recommendState.noResultItems,
    });
  },

  toggleModuleFilters() {
    const isModuleExpanded = !this.data.isModuleExpanded;

    this.setData({
      isModuleExpanded,
      primaryQuickFilters: buildPrimaryQuickFilters(
        this.data.activeTab,
        isModuleExpanded,
      ),
    });
  },

  onDetailTap(e: SearchDetailTapEvent) {
    const detail = e.detail || {};
    const dataset = e.currentTarget?.dataset || {};
    const id = String(detail.id || dataset.id || "");
    if (!id) {
      wx.showToast({
        title: HOME_RECOMMEND_COPY.unavailableToast,
        icon: "none",
      });
      return;
    }

    const entry = String(detail.entry || dataset.entry || "search_result");
    const section = String(detail.section || dataset.section || "");
    const title = String(detail.title || dataset.title || "");
    const module = String(detail.module || dataset.module || "");
    const hasPdfRaw = detail.hasPdf ?? dataset.hasPdf;
    const hasPdf = hasPdfRaw === true || hasPdfRaw === "true";

    if (entry === "recommend_card" || entry === "no_result_recommend_card") {
      trackEvent("home_recommend_click", {
        source: "home",
        page: "home",
        entry,
        section: section || "unknown",
        item_id: id,
        title,
        module,
        has_pdf: hasPdf,
      });
    }

    const source = entry === "recommend_card" || entry === "no_result_recommend_card"
      ? "recommend"
      : "search";

    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}&source=${encodeURIComponent(source)}&entry=${encodeURIComponent(entry)}`,
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

  async executeSearch(query: string, options: ExecuteSearchOptions = {}) {
    const rawQuery = String(query || "");
    const trimmedQuery = rawQuery.trim();
    const searchTaskId = this.createSearchTaskId();
    const trackSubmit = Boolean(options.trackSubmit);
    const submitEntry = String(options.entry || "search_box");
    const searchStartedAt = Date.now();

    if (!trimmedQuery) {
      this.applyEmptySearchState(rawQuery);
      return;
    }

    if (trackSubmit) {
      this.recordSearchHistoryIfEnabled(rawQuery);
      trackSearch("home_search_submit", {
        source: "home",
        page: "home",
        entry: submitEntry,
        query: rawQuery,
      });
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

      if (trackSubmit) {
        const durationMs = Date.now() - searchStartedAt;
        if (allResults.length > 0) {
          trackSearch("home_search_result", {
            source: "home",
            page: "home",
            entry: submitEntry,
            query: rawQuery,
            result_count: allResults.length,
            duration_ms: durationMs,
          });
        } else {
          trackSearch("home_search_no_result", {
            source: "home",
            page: "home",
            entry: submitEntry,
            query: rawQuery,
            duration_ms: durationMs,
          });
        }
      }
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

  recordSearchHistoryIfEnabled(query: string) {
    let shouldSave = true;

    try {
      shouldSave = getSettings().saveSearchHistory;
    } catch (error) {
      searchPageLogger.warn("search_history_settings_read_failed", {
        error,
      });
      shouldSave = true;
    }

    if (!shouldSave) {
      return;
    }

    try {
      addSearchHistory(query);
    } catch (error) {
      searchPageLogger.warn("search_history_write_failed", {
        queryLength: String(query || "").trim().length,
        error,
      });
    }
  },

  applySearchState(
    rawQuery: string,
    allResults: SearchCardItem[],
    debugInfo: SearchDebugInfo,
  ) {
    this.allResultsCache = allResults;

    const quickFilters = this.extendQuickFiltersWithResultCategories(allResults);
    const nextActiveTab = this.isKnownFilterKey(this.data.activeTab, quickFilters)
      ? this.data.activeTab
      : TAB_ALL;
    const filteredResults = this.filterResults(allResults, nextActiveTab);
    const recommendState = this.buildHomeRecommendationStateFromSeeds(
      this.homeRecommendSeeds,
      nextActiveTab,
    );

    this.setDataWithTrace("search_state_success", {
      query: rawQuery,
      loading: false,
      errorMessage: "",
      showClear: rawQuery.length > 0,
      results: filteredResults,
      debugInfo,
      quickFilters,
      activeTab: nextActiveTab,
      primaryQuickFilters: buildPrimaryQuickFilters(
        nextActiveTab,
        this.data.isModuleExpanded,
      ),
      homeRecommendSections: recommendState.sections,
      noResultRecommendItems: recommendState.noResultItems,
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
      isModuleExpanded: false,
      primaryQuickFilters: buildPrimaryQuickFilters(TAB_ALL, false),
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
      isModuleExpanded: false,
      primaryQuickFilters: buildPrimaryQuickFilters(TAB_ALL, false),
      homeRecommendSections: this.buildHomeRecommendationStateFromSeeds(
        this.homeRecommendSeeds,
        TAB_ALL,
      ).sections,
    });
  },

  normalizeConclusionRequestText(value: unknown, maxLength: number): string {
    const text = String(value || "").trim();
    if (text.length <= maxLength) {
      return text;
    }

    return text.slice(0, maxLength);
  },

  getCurrentResultCount(): number {
    return Math.max(this.allResultsCache.length, this.data.results.length);
  },

  resolveConclusionRequestEntry(): string {
    const query = String(this.data.query || "").trim();
    const hasNoResult = query
      && !this.data.loading
      && !this.data.errorMessage
      && this.getCurrentResultCount() <= 0;

    return hasNoResult ? "search_no_result" : "search_hint";
  },

  buildConclusionRequestPayload(
    query: string,
    note: string,
  ): SubmitConclusionRequestPayload {
    const resultCount = this.getCurrentResultCount();

    return {
      source: "home",
      page: "home",
      entry: this.data.conclusionRequestEntry || this.resolveConclusionRequestEntry(),
      query,
      note,
      result_count: resultCount,
      has_result: resultCount > 0,
      active_tab: this.data.activeTab,
    };
  },

  async loadHomeRecommendations(): Promise<boolean> {
    try {
      const response = await homeRecommendWithFacade(80);
      this.homeRecommendSeeds = this.buildHomeRecommendationSeeds(response.items);
      const recommendState = this.buildHomeRecommendationStateFromSeeds(
        this.homeRecommendSeeds,
        this.data.activeTab,
      );

      this.setData({
        homeCopy: buildHomeCopyWithMeta(response.total, response.generatedAt),
        homeRecommendSections: recommendState.sections,
        noResultRecommendItems: recommendState.noResultItems,
      });
      return true;
    } catch (error) {
      searchPageLogger.warn("home_recommend_load_failed", { error });
      this.homeRecommendSeeds = [];
      this.setData({
        homeRecommendSections: [],
        noResultRecommendItems: [],
      });
      return false;
    }
  },

  buildHomeRecommendationState(items: SearchViewItem[]): HomeRecommendState {
    return this.buildHomeRecommendationStateFromSeeds(
      this.buildHomeRecommendationSeeds(items),
      TAB_ALL,
    );
  },

  buildHomeRecommendationStateFromSeeds(
    seeds: HomeRecommendSeed[],
    activeTab: string = TAB_ALL,
  ): HomeRecommendState {
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
    const noResultItems = hotSeeds
      .slice(0, NO_RESULT_RECOMMEND_LIMIT)
      .map((seed) => this.toHomeRecommendItem(seed));

    if (activeTab !== TAB_ALL) {
      const filteredSeeds = this.filterHomeRecommendSeeds(seeds, activeTab);
      const sortedSeeds = filteredSeeds
        .slice()
        .sort((left, right) => this.compareFilteredRecommendSeeds(left, right, activeTab));
      const selectedSeeds = this.pickHomeRecommendSeeds(sortedSeeds, HOME_RECOMMEND_LIMIT);
      const sectionMeta = this.resolveFilteredRecommendSectionMeta(activeTab);

      return {
        sections: selectedSeeds.length > 0
          ? [{
            key: activeTab,
            title: sectionMeta.title,
            subtitle: sectionMeta.subtitle,
            items: selectedSeeds.map((seed) => this.toHomeRecommendItem(seed)),
          }]
          : [],
        noResultItems,
      };
    }

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

    const recentCandidateSeeds = seeds.filter((seed) =>
      seed.updatedAtTs > 0 || seed.createdAtTs > 0
    );

    if (recentCandidateSeeds.length > 0) {
      const recentSeeds = this.pickHomeRecommendSeeds(
        recentCandidateSeeds
          .slice()
          .sort((left, right) => this.compareRecentRecommendSeeds(left, right)),
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

    return {
      sections,
      noResultItems,
    };
  },

  filterHomeRecommendSeeds(
    seeds: HomeRecommendSeed[],
    activeTab: string,
  ): HomeRecommendSeed[] {
    if (activeTab === TAB_ALL) {
      return seeds;
    }

    if (activeTab === TAB_HOT) {
      return seeds.filter((seed) => this.isHotRecommendSeed(seed));
    }

    if (activeTab === TAB_COMMON) {
      return seeds.filter((seed) => this.isCommonRecommendSeed(seed));
    }

    if (activeTab === "inequality") {
      return seeds.filter((seed) => this.matchesRecommendSeedKeywords(seed, FILTER_KEYWORDS.inequality));
    }

    if (activeTab === "function") {
      return seeds.filter((seed) => this.matchesRecommendSeedKeywords(seed, FILTER_KEYWORDS.function));
    }

    if (activeTab === "conic") {
      return seeds.filter((seed) => this.matchesRecommendSeedKeywords(seed, FILTER_KEYWORDS.conic));
    }

    if (activeTab === "derivative") {
      return seeds.filter((seed) => this.matchesRecommendSeedKeywords(seed, FILTER_KEYWORDS.derivative));
    }

    const moduleFilter = findModuleFilterByKey(activeTab);
    if (moduleFilter) {
      return seeds.filter((seed) => this.matchesRecommendSeedKeywords(seed, moduleFilter.keywords));
    }

    if (activeTab.startsWith("category:")) {
      const category = activeTab.slice("category:".length).trim();
      if (!category) {
        return [];
      }

      return seeds.filter((seed) => this.matchesRecommendSeedKeywords(seed, [category]));
    }

    return seeds.filter((seed) => this.matchesRecommendSeedKeywords(seed, [activeTab]));
  },

  compareFilteredRecommendSeeds(
    left: HomeRecommendSeed,
    right: HomeRecommendSeed,
    activeTab: string,
  ): number {
    if (activeTab === TAB_COMMON) {
      return this.compareCommonRecommendSeeds(left, right);
    }

    return this.compareHotRecommendSeeds(left, right);
  },

  resolveFilteredRecommendSectionMeta(
    activeTab: string,
  ): Pick<HomeRecommendSection, "title" | "subtitle"> {
    if (activeTab === TAB_HOT) {
      return {
        title: "高频结论",
        subtitle: "考试与练习中更常出现的结论",
      };
    }

    if (activeTab === TAB_COMMON) {
      return {
        title: HOME_RECOMMEND_COPY.commonTitle,
        subtitle: HOME_RECOMMEND_COPY.commonSubtitle,
      };
    }

    const moduleFilter = findModuleFilterByKey(activeTab);
    if (moduleFilter) {
      return {
        title: `${moduleFilter.label}精选`,
        subtitle: "按模块整理的常用结论与模型",
      };
    }

    return {
      title: "筛选结果",
      subtitle: "按当前分类整理的结论与模型",
    };
  },

  isHotRecommendSeed(seed: HomeRecommendSeed): boolean {
    if (seed.hotFlag || seed.hotScore >= 80) {
      return true;
    }

    return this.matchesRecommendSeedKeywords(seed, ["高频", "热门", "hot"]);
  },

  isCommonRecommendSeed(seed: HomeRecommendSeed): boolean {
    if (seed.commonFlag) {
      return true;
    }

    return this.matchesRecommendSeedKeywords(seed, ["常用", "基础", "common"]);
  },

  matchesRecommendSeedKeywords(seed: HomeRecommendSeed, keywords: string[]): boolean {
    const text = this.buildRecommendSeedSearchText(seed);
    const normalizedKeywords = keywords.map((keyword) => keyword.toLowerCase());

    return this.hasAnyKeyword(text, normalizedKeywords);
  },

  buildRecommendSeedSearchText(seed: HomeRecommendSeed): string {
    const rawTags = seed.rawTags.join(" ");
    const tags = seed.tags.join(" ");

    return [
      seed.title,
      seed.module,
      seed.moduleKey,
      rawTags,
      tags,
      seed.summary,
      seed.coreFormula,
    ]
      .map((part) => String(part || "").toLowerCase())
      .join(" ");
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
      const moduleKey = String(item.module || item.moduleDir || "").trim();
      const coreFormula = String(item.coreFormula || "").trim();
      const preview = buildConclusionCardPreview({
        source: coreFormula,
        preferred: item,
        fallbackText: summary,
      });
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
        ...preview,
        updatedAt: updatedAtTs > 0
          ? updatedAtTs
          : (createdAtTs > 0 ? createdAtTs : undefined),
        favoriteCount: this.normalizeCount(item.favoriteCount),
        viewCount: this.normalizeCount(item.viewCount),
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
        coreFormula,
        moduleKey,
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
      previewType: seed.previewType,
      previewHtml: seed.previewHtml,
      previewText: seed.previewText,
      previewImage: seed.previewImage,
      previewImageWidth: seed.previewImageWidth,
      previewImageHeight: seed.previewImageHeight,
      previewFallbackText: seed.previewFallbackText,
      updatedAt: seed.updatedAt,
      favoriteCount: seed.favoriteCount,
      viewCount: seed.viewCount,
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

    return left.sourceOrder - right.sourceOrder;
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

  normalizeCount(value: unknown): number {
    const parsed = this.normalizeOptionalNumber(value);
    if (parsed === null) {
      return 0;
    }

    return Math.max(0, Math.round(parsed));
  },

  buildSearchCards(
    items: SearchViewItem[],
    highlightQuery: string,
  ): SearchCardItem[] {
    return items.map((item) => {
      const title = item.title || item.id;
      const summary = this.resolveSummaryText(item);
      const formulaSource = item.coreFormula || title;
      const preview = buildConclusionCardPreview({
        source: formulaSource,
        preferred: item,
        fallbackText: summary,
      });
      const formulaText = preview.previewFallbackText
        || preview.previewText
        || formulaSource;
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
        formula: formulaText,
        ...preview,
        formulaHtml: preview.previewHtml,
        formulaText,
        module: item.moduleDir || item.module || category,
        category,
        tags: Array.isArray(item.tags) ? item.tags : [],
        displayTags: this.buildSearchResultTags(category, level),
        level,
        freq: frequency,
        score,
        searchScore: score,
        recentScore: Math.round(item.examScore || 0),
        weight: item.searchBoost,
        usage: summary,
        updatedAt: item.updatedAt || item.createdAt,
        createdAt: item.createdAt,
        favoriteCount: this.normalizeCount(item.favoriteCount),
        viewCount: this.normalizeCount(item.viewCount),
      };
    });
  },

  buildSearchResultTags(category: string, level: string): string[] {
    const tags: string[] = [];
    const normalizedCategory = String(category || "").trim();
    const normalizedLevel = String(level || "").trim();

    if (normalizedCategory) {
      tags.push(normalizedCategory);
    }

    if (normalizedLevel && normalizedLevel !== "-") {
      tags.push(`难度 ${normalizedLevel}`);
    }

    return tags;
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

    MODULE_FILTERS.forEach((item) => {
      if (seenKeys[item.key]) {
        return;
      }

      seenKeys[item.key] = true;
      filters.push({
        key: item.key,
        label: item.label,
      });
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

  resolveQuickFilter(key: string): QuickFilter | null {
    const moduleFilter = findModuleFilterByKey(key);
    if (moduleFilter) {
      return moduleFilter;
    }

    const quickFilter = this.data.quickFilters.find((item) => item.key === key);
    if (quickFilter) {
      return quickFilter;
    }

    if (key === TAB_MODULE_TOGGLE) {
      return {
        key: TAB_MODULE_TOGGLE,
        label: this.data.isModuleExpanded ? "收起 ∧" : "更多 ∨",
        action: "toggle",
      };
    }

    return null;
  },

  isKnownFilterKey(key: string, filters: QuickFilter[]): boolean {
    if (!key) {
      return false;
    }

    if (filters.some((filter) => filter.key === key)) {
      return true;
    }

    if (findModuleFilterByKey(key)) {
      return true;
    }

    return key === "inequality"
      || key === "function"
      || key === "conic"
      || key === "derivative";
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

    if (MODULE_FILTERS.some((filter) => this.hasAnyKeyword(normalized, filter.keywords))) {
      return true;
    }

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

    if (activeTab === TAB_HOT) {
      return results.filter((item) => this.isHotItem(item));
    }

    if (activeTab === TAB_COMMON) {
      return results.filter((item) => this.isCommonItem(item));
    }

    const moduleFilter = findModuleFilterByKey(activeTab);
    if (moduleFilter) {
      return results.filter((item) => this.matchesKeywordFilter(item, moduleFilter.keywords));
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
    if (module === "set" || module === "sets") {
      return "集合";
    }

    if (module === "solid_geometry" || module === "solid-geometry" || module === "geometry-solid") {
      return "立体几何";
    }

    if (module === "vector" || module === "vectors") {
      return "向量";
    }

    if (module === "sequence" || module === "sequences") {
      return "数列";
    }

    if (module === "function") {
      return "导数与函数";
    }

    if (module === "derivative" || module === "calculus") {
      return "导数与函数";
    }

    if (module === "conic" || module === "conics") {
      return "圆锥曲线";
    }

    if (module === "plane_geometry" || module === "plane-geometry" || module === "geometry-plane") {
      return "平面几何";
    }

    if (module === "probability" || module === "probability-stat") {
      return "概率";
    }

    if (module === "trigonometry") {
      return "三角函数";
    }

    if (module === "inequality") {
      return "不等式";
    }

    return "数学";
  },
});
