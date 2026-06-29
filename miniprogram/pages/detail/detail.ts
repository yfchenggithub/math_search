import { FEATURE_FLAGS } from "../../config/feature-flags";
import {
  submitCorrectionReport,
  type CorrectionReportLocation,
  type CorrectionReportType,
} from "../../services/api/correction-reports-api";
import { addFavorite, removeFavorite } from "../../services/api/favorites-api";
import { authService } from "../../services/auth/auth-service";
import type { AuthStatusToastType } from "../../services/auth/auth-types";
import { prefetchConclusionBundlesByIds } from "../../services/conclusion-prefetch";
import {
  getCachedFavoriteState,
  setCachedFavoriteState,
} from "../../services/favorite-state-cache";
import { recordRecentBrowse } from "../../services/history";
import { promptWeeklyUpdateSubscription } from "../../services/weekly-update-subscription";
import { getSettings } from "../../services/settings";
import {
  trackDetailView,
  trackEvent,
  trackFavorite,
  trackPdfDownloadClick,
  trackPdfUnlockFlow,
  trackShare,
} from "../../utils/analytics";
import {
  buildAbsoluteApiUrl,
  extractFilenameFromUrl,
} from "../../utils/api-url";
import type { AuthStatusToastState } from "../../utils/auth/auth-status-feedback";
import {
  hideAuthStatusToast,
  retryAuthStatusToast,
  showAuthStatusToast,
  subscribeAuthStatusToast,
} from "../../utils/auth/auth-status-feedback";
import type {
  DetailDocumentView,
  DetailSectionView,
  MathImageNode,
} from "../../utils/detail-content";
import {
  getDetailDocumentById,
  refreshDetailDocumentById,
  resolveMathImageDisplayWidthRpx,
} from "../../utils/detail-content";
import { requireAuthAndRun } from "../../utils/guards/require-auth-and-run";
import { createLogger } from "../../utils/logger/logger";
import {
  getPdfEntitlement,
  isPdfEntitlementActive,
} from "../../utils/pdf-entitlement";
import {
  resolvePdfUnlockProvider,
  unlockPdfEntitlement,
} from "../../utils/pdf-entitlement-unlock";
import { getErrorMessage } from "../../utils/request";
import {
  SHARE_COPY,
  buildDetailSharePayload,
  buildDetailTimelinePayload,
  showShareMenuSafely,
} from "../../utils/share";
import { STORAGE_KEYS } from "../../utils/storage/storage-keys";

type TouchPoint = {
  pageX: number;
  pageY: number;
};

type DetailNavigationDirection = "prev" | "next";
type DetailTocKey =
  | "explanation"
  | "proof"
  | "examples"
  | "traps"
  | "summary";
type PdfOperationStage = "validate" | "cache" | "download" | "save" | "open";
type PdfStatusStage =
  | "idle"
  | "preparing"
  | "cacheHit"
  | "downloading"
  | "saving"
  | "opening"
  | "success"
  | "error";
type PdfStatusTone = "neutral" | "success" | "error";

type PdfStatusView = {
  visible: boolean;
  stage: PdfStatusStage;
  tone: PdfStatusTone;
  stageLabel: string;
  title: string;
  message: string;
  showProgress: boolean;
  progress: number;
  progressText: string;
  canRetry: boolean;
};

type PdfOpenContext = {
  rawPdfUrl: string;
  fullPdfUrl: string;
  pdfFilename: string;
  cacheKey: string;
};

type PdfErrorPresentation = {
  title: string;
  message: string;
  stageLabel: string;
};

type CorrectionOption<T extends string> = {
  value: T;
  label: string;
};

type CorrectionOptionTapEvent = {
  currentTarget: {
    dataset: {
      value?: string;
    };
  };
};

type DetailTocItem = {
  key: DetailTocKey;
  label: string;
  anchorId: string;
};
type DetailAnchorMeasurement = {
  offsetTop: number;
  targetScrollTop: number;
};

type PdfUnlockStatus = "locked" | "unlocked" | "expired";

class PdfOperationError extends Error {
  stage: PdfOperationStage;
  originalError: unknown;

  constructor(
    stage: PdfOperationStage,
    message: string,
    originalError: unknown = null,
  ) {
    super(message);
    this.name = "PdfOperationError";
    this.stage = stage;
    this.originalError = originalError;
  }
}

const DEFAULT_PDF_FILENAME = "hd-pdf.pdf";
const PDF_CACHE_STORAGE_KEY = "conclusion_pdf_cache_map_v1";
const MATH_IMAGE_CACHE_STORAGE_KEY = "conclusion_math_image_cache_map_v1";
const PDF_STATUS_AUTO_HIDE_MS = 900;
const COPY_FEEDBACK_AUTO_HIDE_MS = 1600;
const DETAIL_PULL_REFRESH_TOP_THRESHOLD = 2;
const DETAIL_ID_PATTERN = /^([A-Za-z])(\d{3})$/;
const DETAIL_ID_NUMBER_WIDTH = 3;
const CORRECTION_DESCRIPTION_MAX_LENGTH = 200;
const CORRECTION_LOCATION_OPTIONS: CorrectionOption<CorrectionReportLocation>[] = [
  { value: "title", label: "标题" },
  { value: "summary", label: "简介" },
  { value: "core_formula", label: "核心公式" },
  { value: "body", label: "正文内容" },
  { value: "pdf", label: "高清 PDF" },
  { value: "other", label: "其他" },
];
const CORRECTION_TYPE_OPTIONS: CorrectionOption<CorrectionReportType>[] = [
  { value: "formula", label: "公式错误" },
  { value: "text", label: "文字错误" },
  { value: "layout", label: "排版问题" },
  { value: "other", label: "其他" },
];
const DETAIL_TOC_LABELS: Record<DetailTocKey, string> = {
  explanation: "理解",
  proof: "证明",
  examples: "例题",
  traps: "易错",
  summary: "总结",
};
const DETAIL_TOC_KEYS = Object.keys(DETAIL_TOC_LABELS) as DetailTocKey[];
const DETAIL_TOC_TITLE_KEY_MAP: Record<string, DetailTocKey> = {
  "理解与直觉": "explanation",
  "证明过程": "proof",
  "例题应用": "examples",
  "易错提醒": "traps",
  "复盘总结": "summary",
};
const DETAIL_TOC_SCROLL_CORRECTION_THRESHOLD_PX = 2;
const DETAIL_TOC_SCROLL_CORRECTION_DELAYS_MS = [
  80,
  160,
  260,
  420,
  680,
  1000,
] as const;
const ENABLE_PDF_ENTITLEMENT_FLOW = FEATURE_FLAGS.ENABLE_PDF_ENTITLEMENT_FLOW;
const detailPageLogger = createLogger("detail-page");
const PDF_UNLOCK_COPY = {
  unlockSuccessToast: "下载权益已开启，2 小时内可下载 PDF",
  unlockAndContinueToast: "下载权益已开启，正在准备 PDF",
  unlockUnavailableToast: "暂时无法开启下载权益，请稍后再试",
  unlockNeedFullWatchToast: "需要完整观看后才能开启下载权益",
} as const;

function createIdlePdfStatus(): PdfStatusView {
  return {
    visible: false,
    stage: "idle",
    tone: "neutral",
    stageLabel: "",
    title: "",
    message: "",
    showProgress: false,
    progress: 0,
    progressText: "",
    canRetry: false,
  };
}

function normalizeString(value: unknown): string {
  return String(value || "").trim();
}

function getCorrectionLocationLabel(location: CorrectionReportLocation): string {
  const matched = CORRECTION_LOCATION_OPTIONS.find((option) => option.value === location);
  return matched?.label || "正文内容";
}

function isCorrectionReportType(value: string): value is CorrectionReportType {
  return CORRECTION_TYPE_OPTIONS.some((option) => option.value === value);
}

function stripCopyHtml(value: string): string {
  return String(value || "")
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

function normalizeCopyPlainText(value: unknown): string {
  return stripCopyHtml(String(value || ""));
}

function isDetailTocKey(value: string): value is DetailTocKey {
  return DETAIL_TOC_KEYS.includes(value as DetailTocKey);
}

function resolveDetailTocKey(section: DetailSectionView): DetailTocKey | null {
  const sectionKey = normalizeString(section.key);
  if (isDetailTocKey(sectionKey)) {
    return sectionKey;
  }

  const sectionTitle = normalizeString(section.title);
  return DETAIL_TOC_TITLE_KEY_MAP[sectionTitle] || null;
}

function buildDetailTocItems(sections: DetailSectionView[]): DetailTocItem[] {
  if (!Array.isArray(sections) || sections.length === 0) {
    return [];
  }

  const usedKeys = new Set<DetailTocKey>();
  const items: DetailTocItem[] = [];

  sections.forEach((section, index) => {
    const key = resolveDetailTocKey(section);
    if (!key || usedKeys.has(key)) {
      return;
    }

    usedKeys.add(key);
    items.push({
      key,
      label: DETAIL_TOC_LABELS[key],
      anchorId: `detail-section-${index}`,
    });
  });

  return items;
}

function isRemoteUrl(value: string): boolean {
  return /^https?:\/\//i.test(value);
}

function isCancelError(error: unknown): boolean {
  return normalizeString((error as { errMsg?: string })?.errMsg)
    .toLowerCase()
    .includes("cancel");
}

function hasRenderableDetailContent(detail: DetailDocumentView | null): detail is DetailDocumentView {
  return Boolean(
    detail
      && (
        detail.title
        || detail.summary
        || detail.coreFormulaImage
        || detail.coreFormulaHtml
        || (Array.isArray(detail.sections) && detail.sections.length > 0)
      ),
  );
}

function resolveAdjacentDetailId(
  currentId: string,
  direction: DetailNavigationDirection,
): string {
  const matched = String(currentId || "").trim().match(DETAIL_ID_PATTERN);
  if (!matched) {
    return "";
  }

  const prefix = matched[1];
  const currentNumber = Number(matched[2]);
  const targetNumber = direction === "prev"
    ? currentNumber - 1
    : currentNumber + 1;

  if (targetNumber < 1 || targetNumber > 999) {
    return "";
  }

  return `${prefix}${String(targetNumber).padStart(DETAIL_ID_NUMBER_WIDTH, "0")}`;
}

Page({
  data: {
    id: "",
    title: "",
    category: "",
    summary: "",
    summaryHtml: "",
    aliases: [] as string[],
    aliasesDisplay: "",
    tags: [] as string[],
    hasDifficulty: false,
    difficultyLabel: "",
    isFavorited: false,
    favoriteActionBusy: false,
    showFavoriteStatus: false,
    favoriteStatusText: "",
    coreFormulaHtml: "",
    coreFormulaImage: null as MathImageNode | null,
    sections: [] as DetailSectionView[],
    detailTocItems: [] as DetailTocItem[],
    activeDetailTocKey: "" as "" | DetailTocKey,
    pdfUrl: "",
    pdfFilename: "",
    pdfAvailable: false,
    pdfActionBusy: false,
    pdfActionLabel: "",
    pdfStatus: createIdlePdfStatus() as PdfStatusView,
    enablePdfEntitlementFlow: ENABLE_PDF_ENTITLEMENT_FLOW,
    isUnlockModalVisible: false,
    isUnlockingPdfEntitlement: false,
    isDownloadingPdf: false,
    sourceType: "meta",
    viewState: "idle" as "idle" | "loading" | "content" | "empty" | "error",
    viewMessage: "",
    loadDurationMs: 0,
    loadDurationLabel: "",
    articleScrollTop: 0,
    articleScrollWithAnimation: false,
    transformStyle: "transform: translate3d(0px, 0px, 0) scale(1);",
    zoomActive: false,
    scaleLabel: "100%",
    authStatusToastVisible: false,
    authStatusToastType: "idle" as AuthStatusToastType,
    authStatusToastTitle: "",
    authStatusToastMessage: "",
    authStatusToastRetryable: false,
    authStatusToastClosable: false,
    showBackButton: true,
    showHomeButton: false,
    copyToastVisible: false,
    copyToastTitle: "已复制",
    copyToastText: "",
    textCopyPanelVisible: false,
    textCopyOriginalText: "",
    textCopyDraftText: "",
    longPressHintVisible: false,
    correctionPanelVisible: false,
    correctionLocation: "body" as CorrectionReportLocation,
    correctionLocationLabel: getCorrectionLocationLabel("body"),
    correctionType: "text" as CorrectionReportType,
    correctionTypeOptions: CORRECTION_TYPE_OPTIONS,
    correctionDescription: "",
    correctionDescriptionLength: 0,
    correctionDescriptionMaxLength: CORRECTION_DESCRIPTION_MAX_LENGTH,
    correctionSubmitting: false,
    detailNavigationBusy: false,
    detailNavigationDirection: "" as "" | DetailNavigationDirection,
  },
  scale: 1,
  lastScale: 1,
  translateX: 0,
  translateY: 0,
  lastTranslateX: 0,
  lastTranslateY: 0,
  minScale: 1,
  maxScale: 4,
  gesture: {
    startDistance: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
  },

  lastTapTime: 0,
  ticking: false,
  containerWidth: 0,
  containerHeight: 0,
  contentWidth: 0,
  contentHeight: 0,
  viewerLeft: 0,
  viewerTop: 0,
  articleScrollTop: 0,

  velocityX: 0,
  velocityY: 0,
  lastMoveTime: 0,
  lastMoveX: 0,
  lastMoveY: 0,
  inertiaId: 0,
  measureTimer: 0,
  pdfStatusTimer: 0,
  copyFeedbackTimer: 0,
  pdfDownloadTask: null as WechatMiniprogram.DownloadTask | null,
  currentDetailId: "",
  unsubscribeAuthStatusToast: undefined as undefined | (() => void),
  pendingPdfDownloadAfterUnlock: false,
  isResolvingPdfDownloadEntry: false,
  shareMenuReady: false,
  routeSource: "detail",
  routeEntry: "unknown",
  detailViewTracked: false,
  detailTocScrollCorrectionToken: 0,
  mathImageCacheDownloadTasks: {} as Record<string, Promise<void>>,

  raf(callback: Function) {
    return setTimeout(() => callback(), 16);
  },

  resolveFavoriteTargetId() {
    return String(this.currentDetailId || this.data.id || "").trim();
  },

  syncNavigationButtons() {
    const showBackButton = getCurrentPages().length > 1;

    this.setData({
      showBackButton,
      showHomeButton: !showBackButton,
    });
  },

  resolveFavoriteStateFromCache(detailId: string): boolean | null {
    if (!authService.isAuthenticated()) {
      return null;
    }

    const candidates = [
      String(this.currentDetailId || "").trim(),
      String(detailId || "").trim(),
    ];

    for (let index = 0; index < candidates.length; index += 1) {
      const state = getCachedFavoriteState(candidates[index]);
      if (state !== null) {
        return state;
      }
    }

    return null;
  },

  applyFavoriteStateOverride(detail: DetailDocumentView): DetailDocumentView {
    const cachedFavoriteState = this.resolveFavoriteStateFromCache(detail.id);
    if (cachedFavoriteState === null) {
      return detail;
    }

    return {
      ...detail,
      isFavorited: cachedFavoriteState,
      showFavoriteStatus: true,
      favoriteStatusText: cachedFavoriteState ? "已收藏" : "未收藏",
    };
  },

  syncFavoriteStateCache(isFavorited: boolean) {
    const idCandidates = [
      String(this.currentDetailId || "").trim(),
      String(this.data.id || "").trim(),
    ].filter((id) => Boolean(id));

    idCandidates.forEach((id) => {
      setCachedFavoriteState(id, isFavorited);
    });
  },

  async loadDetail(options: Record<string, string | undefined>) {
    const id = String(options.id || "").trim();
    this.currentDetailId = id;
    const detailLoadStartedAt = Date.now();

    if (!id) {
      this.applyErrorState("缺少结论 ID");
      return;
    }

    this.setData({
      id,
      viewState: "loading",
      viewMessage: "正在加载详情...",
      loadDurationMs: 0,
      loadDurationLabel: "",
    });

    try {
      const detail = await this.resolveDetailDocument(id);

      if (!detail) {
        this.applyEmptyState("未找到对应内容");
        return;
      }

      if (!hasRenderableDetailContent(detail)) {
        this.applyEmptyState("当前结论暂无可展示内容");
        return;
      }

      const loadDurationMs = Math.max(0, Date.now() - detailLoadStartedAt);
      await this.applyDetailDocument(detail, loadDurationMs);
    } catch (error) {
      this.applyErrorState(getErrorMessage(error, "详情加载失败"));
    }
  },

  async resolveDetailDocument(id: string): Promise<DetailDocumentView | null> {
    return getDetailDocumentById(id);
  },

  showAdjacentDetailBoundaryToast(direction: DetailNavigationDirection, missingTarget = false) {
    const title = missingTarget
      ? (direction === "prev" ? "已经没有上一篇了" : "已经没有下一篇了")
      : (direction === "prev" ? "已经到了本模块第一条" : "已经到了本模块最后一条");

    wx.showToast({
      title,
      icon: "none",
    });
  },

  async resolveAdjacentDetailDocument(
    targetId: string,
    direction: DetailNavigationDirection,
  ): Promise<DetailDocumentView | null> {
    try {
      const detail = await this.resolveDetailDocument(targetId);
      return hasRenderableDetailContent(detail) ? detail : null;
    } catch (error) {
      detailPageLogger.warn("detail_navigation_target_unavailable", {
        id: targetId,
        direction,
        error,
      });
      return null;
    }
  },

  async navigateAdjacentDetail(direction: DetailNavigationDirection) {
    if (this.data.detailNavigationBusy || this.data.viewState === "loading") {
      return;
    }

    const currentId = String(this.currentDetailId || this.data.id || "").trim();
    const matched = currentId.match(DETAIL_ID_PATTERN);

    if (!matched) {
      wx.showToast({
        title: "当前 ID 格式暂不支持切换",
        icon: "none",
      });
      return;
    }

    const currentNumber = Number(matched[2]);
    if (direction === "prev" && currentNumber <= 1) {
      this.showAdjacentDetailBoundaryToast(direction);
      return;
    }

    const targetId = resolveAdjacentDetailId(currentId, direction);
    if (!targetId) {
      this.showAdjacentDetailBoundaryToast(direction);
      return;
    }

    const navigationStartedAt = Date.now();
    this.setData({
      detailNavigationBusy: true,
      detailNavigationDirection: direction,
    });

    try {
      const detail = await this.resolveAdjacentDetailDocument(targetId, direction);
      if (!detail) {
        this.showAdjacentDetailBoundaryToast(direction, true);
        return;
      }

      this.currentDetailId = normalizeString(detail.id) || targetId;
      this.routeSource = "detail_navigation";
      this.routeEntry = direction === "prev" ? "previous_detail" : "next_detail";
      this.detailViewTracked = false;

      const loadDurationMs = Math.max(0, Date.now() - navigationStartedAt);
      await this.applyDetailDocument(detail, loadDurationMs);
    } finally {
      this.setData({
        detailNavigationBusy: false,
        detailNavigationDirection: "",
      });
    }
  },

  onPreviousDetailTap() {
    void this.navigateAdjacentDetail("prev");
  },

  onNextDetailTap() {
    void this.navigateAdjacentDetail("next");
  },

  canRefreshDetailFromPullDown(): boolean {
    if (this.data.viewState === "loading") {
      return false;
    }

    if (this.data.detailNavigationBusy) {
      return false;
    }

    if (this.data.zoomActive || this.scale > 1.01) {
      return false;
    }

    if (this.data.viewState !== "content") {
      return true;
    }

    const scrollTop = Math.max(
      Number(this.articleScrollTop || 0),
      Number(this.data.articleScrollTop || 0),
    );
    return scrollTop <= DETAIL_PULL_REFRESH_TOP_THRESHOLD;
  },

  onPullDownRefresh() {
    if (!this.canRefreshDetailFromPullDown()) {
      wx.stopPullDownRefresh();
      return;
    }

    void this.refreshCurrentDetail().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async refreshCurrentDetail() {
    const detailId = String(this.currentDetailId || this.data.id || "").trim();
    if (!detailId) {
      showAuthStatusToast({
        type: "error",
        title: "刷新失败",
        message: "缺少结论 ID，请返回列表后重试",
        closable: true,
        source: "unknown",
      });
      return;
    }

    const refreshStartedAt = Date.now();

    try {
      const detail = await refreshDetailDocumentById(detailId);
      if (!detail) {
        this.applyEmptyState("未找到对应内容");
        showAuthStatusToast({
          type: "error",
          title: "刷新失败",
          message: "未找到对应内容",
          closable: true,
          source: "unknown",
        });
        return;
      }

      await this.invalidatePdfCacheForDetailRefresh(detailId, detail);

      const loadDurationMs = Math.max(0, Date.now() - refreshStartedAt);
      await this.applyDetailDocument(detail, loadDurationMs);
      showAuthStatusToast({
        type: "success",
        title: "已经获取到最新",
        message: "详情缓存已更新，PDF 缓存已清除",
        source: "unknown",
      });
    } catch (error) {
      detailPageLogger.warn("detail_pull_refresh_failed", {
        id: detailId,
        error,
      });
      showAuthStatusToast({
        type: "error",
        title: "刷新失败",
        message: getErrorMessage(error, "详情刷新失败，请稍后重试"),
        closable: true,
        source: "unknown",
      });
    }
  },

  formatLoadDurationLabel(durationMs: number): string {
    const safeDuration = Math.max(0, Math.round(Number(durationMs) || 0));
    if (safeDuration <= 0) {
      return "<1ms";
    }

    if (safeDuration >= 1000) {
      const seconds = safeDuration / 1000;
      const precision = seconds >= 10 ? 0 : 1;
      return `${seconds.toFixed(precision)}s`;
    }

    return `${safeDuration}ms`;
  },

  async applyDetailDocument(detail: DetailDocumentView, loadDurationMs = 0) {
    this.resetTransform(false);
    this.clearPdfStatusTimer();
    this.abortPdfDownloadTask();
    this.pendingPdfDownloadAfterUnlock = false;
    this.articleScrollTop = 0;
    const hydratedDetail = await this.hydrateMathImageCache(detail);
    const detailWithFavoriteState = this.applyFavoriteStateOverride(hydratedDetail);
    const detailTocItems = buildDetailTocItems(detailWithFavoriteState.sections);
    this.persistRecentBrowse(detailWithFavoriteState);

    this.setData(
      {
        id: detailWithFavoriteState.id,
        title: detailWithFavoriteState.title,
        category: detailWithFavoriteState.category,
        summary: detailWithFavoriteState.summary,
        summaryHtml: detailWithFavoriteState.summaryHtml,
        aliases: detailWithFavoriteState.aliases,
        aliasesDisplay: detailWithFavoriteState.aliases.join(" / "),
        tags: detailWithFavoriteState.tags,
        hasDifficulty: detailWithFavoriteState.hasDifficulty,
        difficultyLabel: detailWithFavoriteState.difficultyLabel,
        isFavorited: detailWithFavoriteState.isFavorited,
        favoriteActionBusy: false,
        showFavoriteStatus: detailWithFavoriteState.showFavoriteStatus,
        favoriteStatusText: detailWithFavoriteState.favoriteStatusText,
        coreFormulaHtml: detailWithFavoriteState.coreFormulaHtml,
        coreFormulaImage: detailWithFavoriteState.coreFormulaImage || null,
        sections: detailWithFavoriteState.sections,
        detailTocItems,
        activeDetailTocKey: detailTocItems[0]?.key || "",
        pdfUrl: detailWithFavoriteState.pdfUrl,
        pdfFilename: detailWithFavoriteState.pdfFilename,
        pdfAvailable: detailWithFavoriteState.pdfAvailable,
        pdfActionBusy: false,
        pdfActionLabel: "",
        pdfStatus: createIdlePdfStatus(),
        isUnlockModalVisible: false,
        isUnlockingPdfEntitlement: false,
        isDownloadingPdf: false,
        sourceType: detailWithFavoriteState.sourceType,
        viewState: "content",
        viewMessage: "",
        loadDurationMs: Math.max(0, Math.round(Number(loadDurationMs) || 0)),
        loadDurationLabel: this.formatLoadDurationLabel(loadDurationMs),
        articleScrollTop: 0,
        articleScrollWithAnimation: false,
        transformStyle: this.buildTransformStyle(),
        zoomActive: false,
        scaleLabel: "100%",
        correctionPanelVisible: false,
        correctionLocation: "body",
        correctionLocationLabel: getCorrectionLocationLabel("body"),
        correctionType: "text",
        correctionDescription: "",
        correctionDescriptionLength: 0,
        correctionSubmitting: false,
      },
      () => {
        this.scheduleMeasure();
        this.maybeShowLongPressHint();
        if (!this.detailViewTracked) {
          this.detailViewTracked = true;
          trackDetailView(
            {
              item_id: detailWithFavoriteState.id,
              title: detailWithFavoriteState.title,
              module: detailWithFavoriteState.category,
              has_pdf: Boolean(detailWithFavoriteState.pdfAvailable),
              source: this.routeSource,
              page: "detail",
              entry: this.routeEntry,
            },
            {
              dedupeKey: `detail_view:${detailWithFavoriteState.id}`,
              dedupeMs: 10 * 60 * 1000,
            },
          );
        }

        void prefetchConclusionBundlesByIds([detailWithFavoriteState.id], {
          reason: "detail_content",
          maxCount: 1,
          detailConcurrency: 1,
          assetConcurrency: 2,
        });
      },
    );
  },

  persistRecentBrowse(detail: DetailDocumentView) {
    const id = String(detail.id || "").trim();
    if (!id) {
      return;
    }

    try {
      recordRecentBrowse({
        id,
        title: String(detail.title || "").trim(),
        module: String(detail.category || "").trim(),
        summary: String(detail.summary || "").trim(),
        tags: Array.isArray(detail.tags)
          ? detail.tags
              .map((tag) => String(tag || "").trim())
              .filter((tag) => Boolean(tag))
          : [],
      });
    } catch (error) {
      detailPageLogger.warn("recent_browse_record_failed", {
        itemId: id,
        error,
      });
    }
  },

  hashText(value: string): string {
    let hash = 2166136261;

    for (let index = 0; index < value.length; index += 1) {
      hash ^= value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }

    return (hash >>> 0).toString(16);
  },

  buildMathImageCacheKey(latex: string, sourceUrl: string): string {
    const normalizedLatex = String(latex || "").trim();
    const normalizedUrl = String(sourceUrl || "").trim();
    if (!normalizedLatex && !normalizedUrl) {
      return "";
    }

    const formulaIdentity = normalizedLatex || normalizedUrl;
    return `math_image::${this.hashText(formulaIdentity)}::${this.hashText(normalizedUrl || formulaIdentity)}`;
  },

  getMathImageCacheMap(): Record<string, string> {
    try {
      const rawCache = wx.getStorageSync(MATH_IMAGE_CACHE_STORAGE_KEY);
      if (
        !rawCache ||
        typeof rawCache !== "object" ||
        Array.isArray(rawCache)
      ) {
        return {};
      }

      const normalized: Record<string, string> = {};
      const entries = rawCache as Record<string, unknown>;
      Object.keys(entries).forEach((key) => {
        const value = entries[key];
        if (typeof value === "string" && value.trim()) {
          normalized[key] = value;
        }
      });

      return normalized;
    } catch (error) {
      detailPageLogger.warn("read_math_image_cache_map_failed", {
        error,
      });
      return {};
    }
  },

  getCachedMathImageFilePath(cacheKey: string): string {
    if (!cacheKey) {
      return "";
    }

    const cacheMap = this.getMathImageCacheMap();
    return typeof cacheMap[cacheKey] === "string" ? cacheMap[cacheKey] : "";
  },

  setCachedMathImageFilePath(cacheKey: string, savedFilePath: string) {
    if (!cacheKey || !savedFilePath) {
      return;
    }

    try {
      const cacheMap = this.getMathImageCacheMap();
      cacheMap[cacheKey] = savedFilePath;
      wx.setStorageSync(MATH_IMAGE_CACHE_STORAGE_KEY, cacheMap);
    } catch (error) {
      detailPageLogger.warn("write_math_image_cache_map_failed", {
        cacheKey,
        error,
      });
    }
  },

  removeCachedMathImageFilePath(cacheKey: string) {
    if (!cacheKey) {
      return;
    }

    try {
      const cacheMap = this.getMathImageCacheMap();
      if (!Object.prototype.hasOwnProperty.call(cacheMap, cacheKey)) {
        return;
      }

      delete cacheMap[cacheKey];
      wx.setStorageSync(MATH_IMAGE_CACHE_STORAGE_KEY, cacheMap);
    } catch (error) {
      detailPageLogger.warn("remove_math_image_cache_entry_failed", {
        cacheKey,
        error,
      });
    }
  },

  async resolveValidCachedMathImagePath(cacheKey: string): Promise<string> {
    const cachedFilePath = this.getCachedMathImageFilePath(cacheKey);
    if (!cachedFilePath) {
      return "";
    }

    const isAvailable = await this.isSavedFilePathAvailable(cachedFilePath);
    if (isAvailable) {
      return cachedFilePath;
    }

    this.removeCachedMathImageFilePath(cacheKey);
    return "";
  },

  saveMathImageFromTempFile(tempFilePath: string): Promise<string> {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().saveFile({
        tempFilePath,
        success: (res) => {
          if (!res.savedFilePath) {
            reject(new Error("math image save failed: empty savedFilePath"));
            return;
          }

          resolve(res.savedFilePath);
        },
        fail: (error) => {
          reject(error);
        },
      });
    });
  },

  downloadAndSaveMathImage(sourceUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: sourceUrl,
        success: (res) => {
          if (res.statusCode !== 200 || !res.tempFilePath) {
            reject(
              new Error(`math image download failed (HTTP ${res.statusCode})`),
            );
            return;
          }

          this.saveMathImageFromTempFile(res.tempFilePath)
            .then(resolve)
            .catch(reject);
        },
        fail: (error) => {
          reject(error);
        },
      });
    });
  },

  queueMathImageCacheDownload(cacheKey: string, sourceUrl: string) {
    if (!cacheKey || !sourceUrl) {
      return;
    }

    if (this.mathImageCacheDownloadTasks[cacheKey]) {
      return;
    }

    const downloadTask = this.downloadAndSaveMathImage(sourceUrl)
      .then((savedFilePath: string) => {
        this.setCachedMathImageFilePath(cacheKey, savedFilePath);
      })
      .catch((error: unknown) => {
        detailPageLogger.warn("math_image_cache_download_failed", {
          cacheKey,
          sourceUrl,
          error,
        });
      })
      .finally(() => {
        delete this.mathImageCacheDownloadTasks[cacheKey];
      });

    this.mathImageCacheDownloadTasks[cacheKey] = downloadTask;
  },

  async resolveMathImageNodeWithCache(
    node: MathImageNode | null,
  ): Promise<MathImageNode | null> {
    if (!node) {
      return null;
    }

    const sourceUrl = String(node.imageUrl || "").trim();
    const normalizedLatex = String(node.latex || "").trim();
    const cacheKey = this.buildMathImageCacheKey(normalizedLatex, sourceUrl);
    const normalizedNode: MathImageNode = {
      ...node,
      displayWidthRpx: resolveMathImageDisplayWidthRpx(node),
    };

    if (!sourceUrl || !cacheKey) {
      return normalizedNode;
    }

    const cachedFilePath = await this.resolveValidCachedMathImagePath(cacheKey);
    if (cachedFilePath) {
      console.info("[detail] math_image cache hit", {
        cacheKey,
        latex: normalizedLatex || undefined,
        sourceUrl,
      });

      return {
        ...normalizedNode,
        imageUrl: cachedFilePath,
        imageLoadFailed: false,
      };
    }

    console.info("[detail] math_image cache miss", {
      cacheKey,
      latex: normalizedLatex || undefined,
      sourceUrl,
    });

    this.queueMathImageCacheDownload(cacheKey, sourceUrl);
    return normalizedNode;
  },

  async hydrateMathImageSections(
    sections: DetailSectionView[],
  ): Promise<DetailSectionView[]> {
    if (!Array.isArray(sections) || sections.length === 0) {
      return [];
    }

    return Promise.all(
      sections.map(async (section) => {
        const blocks = Array.isArray(section.blocks)
          ? await Promise.all(
              section.blocks.map(async (block) => {
                if (block.kind === "math_image") {
                  const resolvedNode = await this.resolveMathImageNodeWithCache(
                    {
                      type: "math_image",
                      latex: block.latex,
                      alt: block.alt,
                      asset: block.asset,
                      imageUrl: block.imageUrl,
                      displayWidth: block.displayWidth,
                      imageLoadFailed: block.imageLoadFailed,
                      __path: block.__path,
                    },
                  );

                  return {
                    ...block,
                    ...(resolvedNode || {}),
                  };
                }

                if (block.kind !== "theorem") {
                  return block;
                }

                let descParts = block.descParts;
                if (Array.isArray(descParts)) {
                  descParts = await Promise.all(
                    descParts.map(async (part) => {
                      if (part.kind !== "math_image" || !part.image) {
                        return part;
                      }

                      const resolvedImage =
                        await this.resolveMathImageNodeWithCache(part.image);
                      if (!resolvedImage) {
                        return part;
                      }

                      return {
                        ...part,
                        image: resolvedImage,
                      };
                    }),
                  );
                }

                let formulaImages = block.formulaImages;
                if (Array.isArray(formulaImages)) {
                  const resolvedFormulaImages = await Promise.all(
                    formulaImages.map(async (formulaImage) =>
                      this.resolveMathImageNodeWithCache(formulaImage),
                    ),
                  );

                  formulaImages = resolvedFormulaImages.filter(
                    (formulaImage): formulaImage is MathImageNode =>
                      Boolean(formulaImage),
                  );
                }

                return {
                  ...block,
                  descParts,
                  formulaImages,
                };
              }),
            )
          : [];

        return {
          ...section,
          blocks,
        };
      }),
    );
  },

  async hydrateMathImageCache(
    detail: DetailDocumentView,
  ): Promise<DetailDocumentView> {
    const coreFormulaImage = detail.coreFormulaImage
      ? await this.resolveMathImageNodeWithCache(detail.coreFormulaImage)
      : null;

    const sections = await this.hydrateMathImageSections(detail.sections || []);

    return {
      ...detail,
      coreFormulaImage: coreFormulaImage || undefined,
      sections,
    };
  },

  refreshMathImageNodeDisplayScale(node: MathImageNode | null): MathImageNode | null {
    if (!node) {
      return null;
    }

    return {
      ...node,
      displayWidthRpx: resolveMathImageDisplayWidthRpx(node),
    };
  },

  refreshSectionMathImageDisplayScale(
    sections: DetailSectionView[],
  ): DetailSectionView[] {
    if (!Array.isArray(sections) || sections.length === 0) {
      return [];
    }

    return sections.map((section) => ({
      ...section,
      blocks: Array.isArray(section.blocks)
        ? section.blocks.map((block) => {
            if (block.kind === "math_image") {
              return {
                ...block,
                displayWidthRpx: resolveMathImageDisplayWidthRpx(block),
              };
            }

            if (block.kind !== "theorem") {
              return block;
            }

            const descParts = Array.isArray(block.descParts)
              ? block.descParts.map((part) => {
                  if (part.kind !== "math_image" || !part.image) {
                    return part;
                  }

                  return {
                    ...part,
                    image: this.refreshMathImageNodeDisplayScale(part.image) || part.image,
                  };
                })
              : block.descParts;

            const formulaImages = Array.isArray(block.formulaImages)
              ? block.formulaImages.map((node) =>
                  this.refreshMathImageNodeDisplayScale(node) || node
                )
              : block.formulaImages;

            return {
              ...block,
              descParts,
              formulaImages,
            };
          })
        : [],
    }));
  },

  refreshMathImageDisplayScale() {
    if (this.data.viewState !== "content") {
      return;
    }

    this.setData({
      coreFormulaImage: this.refreshMathImageNodeDisplayScale(this.data.coreFormulaImage),
      sections: this.refreshSectionMathImageDisplayScale(this.data.sections || []),
    });
  },

  applyEmptyState(message: string) {
    this.resetTransform(false);
    this.clearPdfStatusTimer();
    this.abortPdfDownloadTask();
    this.pendingPdfDownloadAfterUnlock = false;
    this.setData({
      title: "",
      category: "",
      summary: "",
      summaryHtml: "",
      aliases: [],
      aliasesDisplay: "",
      tags: [],
      hasDifficulty: false,
      difficultyLabel: "",
      isFavorited: false,
      favoriteActionBusy: false,
      showFavoriteStatus: false,
      favoriteStatusText: "",
      coreFormulaHtml: "",
      coreFormulaImage: null,
      sections: [],
      detailTocItems: [],
      activeDetailTocKey: "",
      pdfUrl: "",
      pdfFilename: "",
      pdfAvailable: false,
      pdfActionBusy: false,
      pdfActionLabel: "",
      pdfStatus: createIdlePdfStatus(),
      isUnlockModalVisible: false,
      isUnlockingPdfEntitlement: false,
      isDownloadingPdf: false,
      sourceType: "meta",
      viewState: "empty",
      viewMessage: message,
      loadDurationMs: 0,
      loadDurationLabel: "",
      articleScrollTop: 0,
      articleScrollWithAnimation: false,
      transformStyle: this.buildTransformStyle(),
      zoomActive: false,
      scaleLabel: "100%",
      correctionPanelVisible: false,
      correctionLocation: "body",
      correctionLocationLabel: getCorrectionLocationLabel("body"),
      correctionType: "text",
      correctionDescription: "",
      correctionDescriptionLength: 0,
      correctionSubmitting: false,
    });
  },

  applyErrorState(message: string) {
    this.resetTransform(false);
    this.clearPdfStatusTimer();
    this.abortPdfDownloadTask();
    this.pendingPdfDownloadAfterUnlock = false;
    this.setData({
      title: "",
      category: "",
      summary: "",
      summaryHtml: "",
      aliases: [],
      aliasesDisplay: "",
      tags: [],
      hasDifficulty: false,
      difficultyLabel: "",
      isFavorited: false,
      favoriteActionBusy: false,
      showFavoriteStatus: false,
      favoriteStatusText: "",
      coreFormulaHtml: "",
      coreFormulaImage: null,
      sections: [],
      detailTocItems: [],
      activeDetailTocKey: "",
      pdfUrl: "",
      pdfFilename: "",
      pdfAvailable: false,
      pdfActionBusy: false,
      pdfActionLabel: "",
      pdfStatus: createIdlePdfStatus(),
      isUnlockModalVisible: false,
      isUnlockingPdfEntitlement: false,
      isDownloadingPdf: false,
      sourceType: "meta",
      viewState: "error",
      viewMessage: message,
      loadDurationMs: 0,
      loadDurationLabel: "",
      articleScrollTop: 0,
      articleScrollWithAnimation: false,
      transformStyle: this.buildTransformStyle(),
      zoomActive: false,
      scaleLabel: "100%",
      correctionPanelVisible: false,
      correctionLocation: "body",
      correctionLocationLabel: getCorrectionLocationLabel("body"),
      correctionType: "text",
      correctionDescription: "",
      correctionDescriptionLength: 0,
      correctionSubmitting: false,
    });
  },

  onRetryLoad() {
    if (!this.currentDetailId) {
      this.applyErrorState("缺少结论 ID");
      return;
    }

    void this.loadDetail({
      id: this.currentDetailId,
    });
  },

  onCoreFormulaImageError(e: WechatMiniprogram.BaseEvent) {
    const imageUrl = String(e.currentTarget.dataset.url || "").trim();

    console.warn("[detail] core formula image load unavailable", {
      url: imageUrl,
    });

    this.setData({
      "coreFormulaImage.imageLoadFailed": true,
    });
  },

  async handleFavoriteToggleTap() {
    if (this.data.favoriteActionBusy) {
      return;
    }

    const conclusionId = this.resolveFavoriteTargetId();
    if (!conclusionId) {
      detailPageLogger.warn("favorite_toggle_invalid_id", {
        id: this.data.id,
      });
      showAuthStatusToast({
        type: "error",
        title: "收藏未完成",
        message: "结论 ID 无效，请返回列表后重试",
        closable: true,
        source: "unknown",
      });
      return;
    }

    const nextFavoriteState = !this.data.isFavorited;
    trackFavorite("favorite_click", {
      item_id: conclusionId,
      module: String(this.data.category || ""),
      source: "detail",
      page: "detail",
      entry: "favorite_button",
    });

    await requireAuthAndRun(
      async () => {
        await this.commitFavoriteToggle(conclusionId, nextFavoriteState);
      },
      {
        title: "请先登录",
        content: "登录后可同步收藏状态",
        loginSource: "favorites",
      },
    );
  },

  async commitFavoriteToggle(conclusionId: string, nextFavoriteState: boolean) {
    try {
      this.setData({
        favoriteActionBusy: true,
      });

      if (nextFavoriteState) {
        await addFavorite({
          conclusion_id: conclusionId,
        });
      } else {
        await removeFavorite(conclusionId);
      }

      this.setData({
        isFavorited: nextFavoriteState,
        showFavoriteStatus: true,
        favoriteStatusText: nextFavoriteState ? "已收藏" : "未收藏",
      });
      this.syncFavoriteStateCache(nextFavoriteState);

      trackFavorite(
        nextFavoriteState ? "favorite_success" : "favorite_cancel",
        {
          item_id: conclusionId,
          module: String(this.data.category || ""),
          source: "detail",
          page: "detail",
          entry: "favorite_button",
        },
      );

      detailPageLogger.info("favorite_toggle_success", {
        conclusionId,
        isFavorited: nextFavoriteState,
      });
      showAuthStatusToast({
        type: "success",
        title: nextFavoriteState ? "已收藏" : "已取消收藏",
        message: nextFavoriteState ? "收藏状态已同步" : "该条目已从收藏中移除",
        source: "unknown",
      });

      if (nextFavoriteState) {
        setTimeout(() => {
          void promptWeeklyUpdateSubscription({
            source: "favorite_success",
          });
        }, 500);
      }
    } catch (error) {
      const errorMessage = getErrorMessage(error, "收藏操作失败，请稍后重试");
      detailPageLogger.warn("favorite_toggle_failed", {
        conclusionId,
        targetState: nextFavoriteState,
        error,
      });
      trackFavorite("favorite_fail", {
        item_id: conclusionId,
        module: String(this.data.category || ""),
        source: "detail",
        page: "detail",
        entry: "favorite_button",
        error_type: "request_failed",
      });
      showAuthStatusToast({
        type: "error",
        title: nextFavoriteState ? "收藏失败" : "取消收藏失败",
        message: errorMessage,
        retryable: true,
        closable: true,
        source: "unknown",
        onRetry: () => {
          void this.commitFavoriteToggle(conclusionId, nextFavoriteState);
        },
      });
    } finally {
      this.setData({
        favoriteActionBusy: false,
      });
    }
  },

  onLoad(options: Record<string, string | undefined>) {
    authService.init();
    this.ensureShareMenu();
    this.syncNavigationButtons();
    this.routeSource = String(options.source || "detail").trim() || "detail";
    this.routeEntry = String(options.entry || "unknown").trim() || "unknown";
    this.detailViewTracked = false;
    this.unsubscribeAuthStatusToast = subscribeAuthStatusToast((state) => {
      this.syncAuthStatusToast(state);
    });
    void this.loadDetail(options);
  },

  onShow() {
    this.ensureShareMenu();
    this.syncNavigationButtons();
    this.refreshMathImageDisplayScale();
  },

  onUnload() {
    clearTimeout(this.inertiaId);
    clearTimeout(this.measureTimer);
    this.clearCopyFeedbackTimer();
    this.clearPdfStatusTimer();
    this.abortPdfDownloadTask();
    this.pendingPdfDownloadAfterUnlock = false;
    this.unsubscribeAuthStatusToast?.();
    this.unsubscribeAuthStatusToast = undefined;
    hideAuthStatusToast("detail_unload");
  },

  ensureShareMenu() {
    if (this.shareMenuReady) {
      return;
    }

    this.shareMenuReady = true;
    showShareMenuSafely();
  },

  getCurrentShareSource() {
    const id = String(this.data.id || "").trim();
    const title = String(this.data.title || "").trim();

    const keywords = [
      ...(Array.isArray(this.data.tags) ? this.data.tags : []),
      ...(Array.isArray(this.data.aliases) ? this.data.aliases : []),
    ]
      .map((value) => String(value || "").trim())
      .filter((value) => Boolean(value));

    return {
      id,
      title,
      keywords,
    };
  },

  copyPlainText(text: string): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.setClipboardData({
        data: text,
        success: () => {
          resolve();
        },
        fail: (error) => {
          reject(error);
        },
      });
    });
  },

  clearCopyFeedbackTimer() {
    clearTimeout(this.copyFeedbackTimer);
    this.copyFeedbackTimer = 0;
  },

  hasShownLongPressHint(): boolean {
    try {
      return Boolean(wx.getStorageSync(STORAGE_KEYS.DETAIL_LONG_PRESS_HINT_SHOWN));
    } catch (error) {
      detailPageLogger.warn("read_long_press_hint_state_failed", {
        error,
      });
      return true;
    }
  },

  markLongPressHintShown() {
    try {
      wx.setStorageSync(STORAGE_KEYS.DETAIL_LONG_PRESS_HINT_SHOWN, true);
    } catch (error) {
      detailPageLogger.warn("write_long_press_hint_state_failed", {
        error,
      });
    }
  },

  maybeShowLongPressHint() {
    if (this.hasShownLongPressHint()) {
      return;
    }

    this.setData({
      longPressHintVisible: true,
    });
  },

  dismissLongPressHint() {
    this.markLongPressHintShown();
    if (!this.data.longPressHintVisible) {
      return;
    }

    this.setData({
      longPressHintVisible: false,
    });
  },

  showCopyFeedback(text: string, title = "已复制") {
    this.clearCopyFeedbackTimer();
    this.setData({
      copyToastVisible: true,
      copyToastTitle: title,
      copyToastText: text,
    });

    this.copyFeedbackTimer = setTimeout(() => {
      this.setData({
        copyToastVisible: false,
        copyToastTitle: "已复制",
        copyToastText: "",
      });
      this.copyFeedbackTimer = 0;
    }, COPY_FEEDBACK_AUTO_HIDE_MS);
  },

  showClipboardCopiedFeedback() {
    this.showCopyFeedback("", "已复制到剪贴板");
  },

  getLongPressCopyText(e: WechatMiniprogram.BaseEvent): string {
    const detailText = (e as WechatMiniprogram.CustomEvent<{ text?: string }>).detail?.text;
    const datasetText = e.currentTarget?.dataset?.copyText;
    return normalizeCopyPlainText(detailText || datasetText);
  },

  openTextCopyPanel(text: string) {
    this.setData({
      textCopyPanelVisible: true,
      textCopyOriginalText: text,
      textCopyDraftText: text,
    });
  },

  closeTextCopyPanel() {
    this.setData({
      textCopyPanelVisible: false,
      textCopyOriginalText: "",
      textCopyDraftText: "",
    });
  },

  async onTextLongPress(e: WechatMiniprogram.BaseEvent) {
    const text = this.getLongPressCopyText(e);

    if (!text) {
      wx.showToast({
        title: "无可复制内容",
        icon: "none",
      });
      return;
    }

    this.dismissLongPressHint();
    this.openTextCopyPanel(text);
  },

  onTextCopyDraftInput(e: WechatMiniprogram.Input) {
    this.setData({
      textCopyDraftText: String(e.detail.value || ""),
    });
  },

  onTextCopyResetTap() {
    this.setData({
      textCopyDraftText: this.data.textCopyOriginalText || "",
    });
  },

  onTextCopyClearTap() {
    this.setData({
      textCopyDraftText: "",
    });
  },

  onTextCopyReselectTap() {
    this.closeTextCopyPanel();
  },

  onTextSelectionSelectAllTap() {
    this.setData({
      textCopyDraftText: this.data.textCopyOriginalText || "",
    });
  },

  async onTextSelectionCopyTap() {
    await this.copyTextCopyDraft();
  },

  async onTextCopyPanelCopyTap() {
    await this.copyTextCopyDraft();
  },

  async copyTextCopyDraft() {
    const text = normalizeCopyPlainText(this.data.textCopyDraftText);

    if (!text) {
      wx.showToast({
        title: "无可复制内容",
        icon: "none",
      });
      return;
    }

    try {
      await this.copyPlainText(text);
      this.showClipboardCopiedFeedback();
      this.closeTextCopyPanel();
    } catch (error) {
      detailPageLogger.warn("copy_text_panel_failed", {
        itemId: normalizeString(this.data.id || this.currentDetailId),
        error,
      });
      wx.showToast({
        title: SHARE_COPY.copyFailedToast,
        icon: "none",
      });
    }
  },

  resetCorrectionForm() {
    this.setData({
      correctionLocation: "body",
      correctionLocationLabel: getCorrectionLocationLabel("body"),
      correctionType: "text",
      correctionDescription: "",
      correctionDescriptionLength: 0,
      correctionSubmitting: false,
    });
  },

  openCorrectionPanel() {
    const conclusionId = normalizeString(this.data.id || this.currentDetailId);
    const conclusionTitle = normalizeString(this.data.title);

    if (this.data.viewState !== "content" || !conclusionId || !conclusionTitle) {
      wx.showToast({
        title: "当前内容不可纠错",
        icon: "none",
      });
      return;
    }

    this.closeTextCopyPanel();
    this.setData({
      correctionPanelVisible: true,
      correctionLocation: "body",
      correctionLocationLabel: getCorrectionLocationLabel("body"),
      correctionType: "text",
      correctionDescription: "",
      correctionDescriptionLength: 0,
      correctionSubmitting: false,
    });

    trackEvent("correction_report_entry_click", {
      item_id: conclusionId,
      module: String(this.data.category || ""),
      source: "detail",
      page: "detail",
      entry: "title_button",
    });
  },

  closeCorrectionPanel() {
    if (this.data.correctionSubmitting) {
      return;
    }

    this.setData({
      correctionPanelVisible: false,
    });
    this.resetCorrectionForm();
  },

  onCorrectionEntryTap() {
    this.openCorrectionPanel();
  },

  onCorrectionCancelTap() {
    this.closeCorrectionPanel();
  },

  onCorrectionLocationSelectorTap() {
    if (this.data.correctionSubmitting) {
      return;
    }

    wx.showActionSheet({
      itemList: CORRECTION_LOCATION_OPTIONS.map((option) => option.label),
      success: (res) => {
        const option = CORRECTION_LOCATION_OPTIONS[Number(res.tapIndex || 0)];
        if (!option) {
          return;
        }

        this.setData({
          correctionLocation: option.value,
          correctionLocationLabel: option.label,
        });
      },
    });
  },

  onCorrectionTypeTap(event: CorrectionOptionTapEvent) {
    if (this.data.correctionSubmitting) {
      return;
    }

    const value = normalizeString(event.currentTarget.dataset.value);
    if (!isCorrectionReportType(value)) {
      return;
    }

    this.setData({
      correctionType: value,
    });
  },

  onCorrectionDescriptionInput(e: WechatMiniprogram.Input) {
    const description = String(e.detail.value || "").slice(
      0,
      CORRECTION_DESCRIPTION_MAX_LENGTH,
    );

    this.setData({
      correctionDescription: description,
      correctionDescriptionLength: description.length,
    });
  },

  async onCorrectionSubmitTap() {
    if (this.data.correctionSubmitting) {
      return;
    }

    const conclusionId = normalizeString(this.data.id || this.currentDetailId);
    const conclusionTitle = normalizeString(this.data.title);
    const description = normalizeString(this.data.correctionDescription);

    if (!description) {
      wx.showToast({
        title: "请填写问题描述",
        icon: "none",
      });
      return;
    }

    if (!conclusionId || !conclusionTitle) {
      wx.showToast({
        title: "当前内容不可纠错",
        icon: "none",
      });
      return;
    }

    this.setData({
      correctionSubmitting: true,
    });

    try {
      await submitCorrectionReport({
        conclusion_id: conclusionId,
        conclusion_title: conclusionTitle,
        error_location: this.data.correctionLocation,
        error_type: this.data.correctionType,
        description,
      });

      trackEvent("correction_report_submit_success", {
        item_id: conclusionId,
        module: String(this.data.category || ""),
        source: "detail",
        page: "detail",
        error_location: this.data.correctionLocation,
        error_type: this.data.correctionType,
      });

      this.setData({
        correctionSubmitting: false,
      });
      this.closeCorrectionPanel();
      wx.showToast({
        title: "已提交纠错",
        icon: "success",
      });
    } catch (error) {
      detailPageLogger.warn("correction_report_submit_failed", {
        itemId: conclusionId,
        error,
      });
      trackEvent("correction_report_submit_fail", {
        item_id: conclusionId,
        module: String(this.data.category || ""),
        source: "detail",
        page: "detail",
        error_type: "request_failed",
      });
      wx.showToast({
        title: getErrorMessage(error, "提交失败，请稍后再试"),
        icon: "none",
      });
      this.setData({
        correctionSubmitting: false,
      });
    }
  },

  onCoreFormulaImageLongPress(e: WechatMiniprogram.BaseEvent) {
    void this.openDetailImageMenu(e.currentTarget.dataset.url);
  },

  onSectionMathImageLongPress(
    e: WechatMiniprogram.CustomEvent<{ imageUrl?: string }>,
  ) {
    void this.openDetailImageMenu(e.detail?.imageUrl);
  },

  async openDetailImageMenu(rawImageUrl: unknown) {
    const imageUrl = normalizeString(rawImageUrl);

    if (!imageUrl) {
      wx.showToast({
        title: "图片暂时不可用",
        icon: "none",
      });
      return;
    }

    this.dismissLongPressHint();
    await this.shareDetailImageToFriend(imageUrl);
  },

  resolveLocalImagePath(imageUrl: string): Promise<string> {
    if (!isRemoteUrl(imageUrl)) {
      return Promise.resolve(imageUrl);
    }

    return this.downloadImageToTempFile(imageUrl);
  },

  downloadImageToTempFile(imageUrl: string): Promise<string> {
    return new Promise((resolve, reject) => {
      wx.downloadFile({
        url: imageUrl,
        success: (res) => {
          if (res.statusCode !== 200 || !res.tempFilePath) {
            reject(new Error(`image download failed (HTTP ${res.statusCode})`));
            return;
          }

          resolve(res.tempFilePath);
        },
        fail: (error) => {
          reject(error);
        },
      });
    });
  },

  showShareImageMenuForPath(imagePath: string): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.showShareImageMenu({
        path: imagePath,
        success: () => {
          resolve();
        },
        fail: (error) => {
          if (isCancelError(error)) {
            resolve();
            return;
          }

          reject(error);
        },
      });
    });
  },

  async shareDetailImageToFriend(imageUrl: string) {
    if (!wx.canIUse || !wx.canIUse("showShareImageMenu")) {
      wx.showToast({
        title: "当前版本暂不支持图片分享",
        icon: "none",
      });
      return;
    }

    try {
      const localPath = await this.resolveLocalImagePath(imageUrl);
      await this.showShareImageMenuForPath(localPath);
    } catch (error) {
      detailPageLogger.warn("share_detail_image_failed", {
        itemId: normalizeString(this.data.id || this.currentDetailId),
        imageUrl,
        error,
      });
      wx.showToast({
        title: "图片分享失败",
        icon: "none",
      });
    }
  },

  onShareAppMessage() {
    trackShare("share_click", {
      item_id: String(this.data.id || ""),
      source: this.routeSource,
      page: "detail",
      entry: "share_button",
      share_type: "app_message",
    });
    return buildDetailSharePayload(this.getCurrentShareSource());
  },

  onShareTimeline() {
    trackShare("share_click", {
      item_id: String(this.data.id || ""),
      source: this.routeSource,
      page: "detail",
      entry: "share_button",
      share_type: "timeline",
    });
    return buildDetailTimelinePayload(this.getCurrentShareSource());
  },

  onReady() {
    this.scheduleMeasure();
  },

  onRenderReady() {
    this.scheduleMeasure();
  },

  scheduleMeasure() {
    clearTimeout(this.measureTimer);

    this.measureTimer = setTimeout(() => {
      this.measureContent();
    }, 80) as unknown as number;
  },

  measureContent() {
    const query = wx.createSelectorQuery().in(this);
    query.select(".viewer").boundingClientRect();
    query.select("#articleWrapper").boundingClientRect();
    query.exec((res) => {
      const viewer = res[0];
      const content = res[1];

      if (!viewer || !content) {
        return;
      }

      this.containerWidth = viewer.width || 0;
      this.containerHeight = viewer.height || 0;
      this.viewerLeft = viewer.left || 0;
      this.viewerTop = viewer.top || 0;

      if (
        this.scale <= 1.01 ||
        this.contentWidth === 0 ||
        this.contentHeight === 0
      ) {
        this.contentWidth = content.width || this.containerWidth;
        this.contentHeight = content.height || this.containerHeight;
      }

      if (this.scale > 1.01) {
        this.rebound();
      }
    });
  },

  noop() {
    return;
  },

  handleAuthStatusRetryTap() {
    const retried = retryAuthStatusToast();
    if (!retried) {
      detailPageLogger.info("auth_status_retry_without_handler");
    }
  },

  handleAuthStatusCloseTap() {
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

  hasActivePdfEntitlement(): boolean {
    const entitlement = getPdfEntitlement();
    return isPdfEntitlementActive(entitlement);
  },

  resolveUnlockStatus(): PdfUnlockStatus {
    const entitlement = getPdfEntitlement();
    if (entitlement.unlocked && entitlement.remainingSeconds > 0) {
      return "unlocked";
    }

    if (entitlement.expireAt && entitlement.remainingSeconds <= 0) {
      return "expired";
    }

    return "locked";
  },

  getPdfAnalyticsContext() {
    return {
      item_id: String(this.data.id || this.currentDetailId || ""),
      module: String(this.data.category || ""),
      has_pdf: Boolean(this.data.pdfAvailable),
      unlock_status: this.resolveUnlockStatus(),
      unlock_provider: resolvePdfUnlockProvider(),
      source: "detail",
      page: "detail",
      entry: "pdf_button",
    };
  },

  resolveWifiOnlyDownloadSetting(): boolean {
    try {
      return Boolean(getSettings().wifiOnlyDownload);
    } catch (error) {
      detailPageLogger.warn("read_wifi_only_download_setting_failed", {
        error,
      });
      return true;
    }
  },

  getCurrentNetworkType(): Promise<string> {
    return new Promise((resolve, reject) => {
      wx.getNetworkType({
        success: (result) => {
          resolve(
            String(result.networkType || "")
              .trim()
              .toLowerCase(),
          );
        },
        fail: (error) => {
          reject(error);
        },
      });
    });
  },

  showNonWifiDownloadConfirm(): Promise<boolean> {
    return new Promise((resolve) => {
      wx.showModal({
        title: "当前不是 Wi-Fi",
        content:
          "高清文件可能消耗流量。你可以连接 Wi-Fi 后再下载，也可以继续本次下载。",
        cancelText: "取消",
        confirmText: "继续下载",
        success: (result) => {
          resolve(Boolean(result.confirm));
        },
        fail: () => {
          resolve(true);
        },
      });
    });
  },

  async confirmNetworkForHdPdfDownload(): Promise<boolean> {
    const wifiOnlyDownloadEnabled = this.resolveWifiOnlyDownloadSetting();
    detailPageLogger.info("wifi_only_download_enabled", {
      enabled: wifiOnlyDownloadEnabled,
    });

    if (!wifiOnlyDownloadEnabled) {
      return true;
    }

    try {
      const networkType = await this.getCurrentNetworkType();
      detailPageLogger.info("network_type_checked", {
        network_type: networkType || "unknown",
      });

      if (networkType === "wifi") {
        return true;
      }

      detailPageLogger.info("non_wifi_download_confirm_shown", {
        network_type: networkType || "unknown",
      });

      const shouldContinueDownload = await this.showNonWifiDownloadConfirm();
      detailPageLogger.info(
        shouldContinueDownload
          ? "non_wifi_download_continue"
          : "non_wifi_download_cancelled",
        {
          network_type: networkType || "unknown",
        },
      );

      return shouldContinueDownload;
    } catch (error) {
      detailPageLogger.warn("get_network_type_failed", {
        error,
      });
      wx.showToast({
        title: "网络状态获取失败，将继续下载",
        icon: "none",
      });
      return true;
    }
  },

  continuePdfDownloadWithExistingFlow() {
    if (!ENABLE_PDF_ENTITLEMENT_FLOW) {
      this.pendingPdfDownloadAfterUnlock = false;
      void this.openPdf();
      return;
    }

    if (this.hasActivePdfEntitlement()) {
      this.pendingPdfDownloadAfterUnlock = false;
      void this.openPdf();
      return;
    }

    this.pendingPdfDownloadAfterUnlock = true;
    trackPdfUnlockFlow("pdf_unlock_modal_show", this.getPdfAnalyticsContext());
    this.setData({
      isUnlockModalVisible: true,
    });
  },

  async onDownloadPdfTap() {
    if (
      this.isResolvingPdfDownloadEntry ||
      this.data.isDownloadingPdf ||
      this.data.isUnlockingPdfEntitlement ||
      this.data.pdfActionBusy
    ) {
      return;
    }

    this.isResolvingPdfDownloadEntry = true;

    try {
      trackPdfDownloadClick(this.getPdfAnalyticsContext());

      if (!this.data.pdfAvailable) {
        trackEvent("detail_pdf_no_file", {
          item_id: String(this.data.id || this.currentDetailId || ""),
          module: String(this.data.category || ""),
          source: "detail",
          page: "detail",
          entry: "pdf_button",
          reason: "pdf_unavailable",
        });
        wx.showToast({
          title: "当前内容暂未提供 PDF",
          icon: "none",
        });
        return;
      }

      const rawPdfUrl = String(this.data.pdfUrl || "").trim();
      if (!rawPdfUrl) {
        trackEvent("detail_pdf_no_file", {
          item_id: String(this.data.id || this.currentDetailId || ""),
          module: String(this.data.category || ""),
          source: "detail",
          page: "detail",
          entry: "pdf_button",
          reason: "pdf_url_empty",
        });
        wx.showToast({
          title: "暂时无法获取 PDF，请稍后再试",
          icon: "none",
        });
        return;
      }

      const shouldContinueDownload =
        await this.confirmNetworkForHdPdfDownload();
      if (!shouldContinueDownload) {
        return;
      }

      this.continuePdfDownloadWithExistingFlow();
    } finally {
      this.isResolvingPdfDownloadEntry = false;
    }
  },

  onPdfUnlockMaskTap() {
    if (!ENABLE_PDF_ENTITLEMENT_FLOW) {
      this.pendingPdfDownloadAfterUnlock = false;
      this.setData({
        isUnlockModalVisible: false,
      });
      return;
    }

    if (this.data.isUnlockingPdfEntitlement) {
      return;
    }

    this.pendingPdfDownloadAfterUnlock = false;
    this.setData({
      isUnlockModalVisible: false,
    });
  },

  onUnlockPdfLaterTap() {
    if (!ENABLE_PDF_ENTITLEMENT_FLOW) {
      this.pendingPdfDownloadAfterUnlock = false;
      this.setData({
        isUnlockModalVisible: false,
      });
      return;
    }

    if (this.data.isUnlockingPdfEntitlement) {
      return;
    }

    this.pendingPdfDownloadAfterUnlock = false;
    this.setData({
      isUnlockModalVisible: false,
    });
  },

  async onUnlockPdfConfirmTap() {
    if (!ENABLE_PDF_ENTITLEMENT_FLOW) {
      this.pendingPdfDownloadAfterUnlock = false;
      this.setData({
        isUnlockModalVisible: false,
      });
      return;
    }

    if (
      this.data.isUnlockingPdfEntitlement ||
      this.data.isDownloadingPdf ||
      this.data.pdfActionBusy
    ) {
      return;
    }

    this.setData({
      isUnlockingPdfEntitlement: true,
    });
    trackPdfUnlockFlow("pdf_unlock_click", this.getPdfAnalyticsContext());

    try {
      const unlockResult = await unlockPdfEntitlement();
      if (unlockResult.unlocked) {
        const shouldContinueDownload = this.pendingPdfDownloadAfterUnlock;
        this.pendingPdfDownloadAfterUnlock = false;
        trackPdfUnlockFlow("pdf_unlock_success", {
          ...this.getPdfAnalyticsContext(),
          unlock_provider: unlockResult.source || resolvePdfUnlockProvider(),
          duration_seconds: 7200,
        });
        this.setData({
          isUnlockModalVisible: false,
        });
        wx.showToast({
          title: shouldContinueDownload
            ? PDF_UNLOCK_COPY.unlockAndContinueToast
            : PDF_UNLOCK_COPY.unlockSuccessToast,
          icon: "none",
        });

        if (shouldContinueDownload) {
          void this.openPdf();
        }
        return;
      }

      if (unlockResult.reason === "cancelled") {
        trackPdfUnlockFlow("pdf_unlock_fail", {
          ...this.getPdfAnalyticsContext(),
          unlock_provider: unlockResult.source || resolvePdfUnlockProvider(),
          error_type: "cancelled",
        });
        wx.showToast({
          title: PDF_UNLOCK_COPY.unlockNeedFullWatchToast,
          icon: "none",
        });
        return;
      }

      trackPdfUnlockFlow("pdf_unlock_fail", {
        ...this.getPdfAnalyticsContext(),
        unlock_provider: unlockResult.source || resolvePdfUnlockProvider(),
        error_type: "unavailable",
      });
      wx.showToast({
        title: PDF_UNLOCK_COPY.unlockUnavailableToast,
        icon: "none",
      });
    } catch (error) {
      detailPageLogger.warn("unlock_pdf_entitlement_failed", {
        error,
      });
      trackPdfUnlockFlow("pdf_unlock_fail", {
        ...this.getPdfAnalyticsContext(),
        error_type: "exception",
      });
      wx.showToast({
        title: PDF_UNLOCK_COPY.unlockUnavailableToast,
        icon: "none",
      });
    } finally {
      this.setData({
        isUnlockingPdfEntitlement: false,
      });
    }
  },

  onPdfStatusMaskTap() {
    this.dismissPdfStatus();
  },

  onRetryOpenPdf() {
    this.dismissPdfStatus();
    this.onDownloadPdfTap();
  },

  clearPdfStatusTimer() {
    clearTimeout(this.pdfStatusTimer);
    this.pdfStatusTimer = 0;
  },

  schedulePdfStatusDismiss(delay = PDF_STATUS_AUTO_HIDE_MS) {
    this.clearPdfStatusTimer();
    this.pdfStatusTimer = setTimeout(() => {
      this.dismissPdfStatus();
    }, delay) as unknown as number;
  },

  abortPdfDownloadTask() {
    if (!this.pdfDownloadTask) {
      return;
    }

    try {
      this.pdfDownloadTask.abort();
    } catch (error) {
      detailPageLogger.warn("abort_pdf_download_task_failed", {
        error,
      });
    }

    this.pdfDownloadTask = null;
  },

  dismissPdfStatus() {
    if (this.data.pdfActionBusy) {
      return;
    }

    this.clearPdfStatusTimer();

    this.setData({
      pdfStatus: createIdlePdfStatus(),
      pdfActionLabel: "",
    });
  },

  normalizePdfProgress(progress: number): number {
    const numericProgress = Number(progress);
    if (!Number.isFinite(numericProgress)) {
      return 0;
    }

    return Math.max(0, Math.min(100, Math.round(numericProgress)));
  },

  getPdfActionLabel(stage: PdfStatusStage): string {
    switch (stage) {
      case "preparing":
        return "准备中...";
      case "cacheHit":
      case "opening":
        return "打开中...";
      case "downloading":
        return "下载中...";
      case "saving":
        return "保存中...";
      default:
        return "";
    }
  },

  isPdfBusyStage(stage: PdfStatusStage): boolean {
    return (
      stage === "preparing" ||
      stage === "cacheHit" ||
      stage === "downloading" ||
      stage === "saving" ||
      stage === "opening"
    );
  },

  setPdfStatusStage(stage: PdfStatusStage, patch: Partial<PdfStatusView> = {}) {
    const nextStatus: PdfStatusView = {
      ...createIdlePdfStatus(),
      visible: true,
      stage,
      ...patch,
    };

    switch (stage) {
      case "preparing":
        nextStatus.stageLabel = nextStatus.stageLabel || "准备中";
        nextStatus.title = nextStatus.title || "正在准备 PDF";
        nextStatus.message = nextStatus.message || "正在检查文档资源，请稍候。";
        nextStatus.tone = "neutral";
        nextStatus.canRetry = false;
        break;
      case "cacheHit":
        nextStatus.stageLabel = nextStatus.stageLabel || "缓存命中";
        nextStatus.title = nextStatus.title || "发现本地缓存";
        nextStatus.message =
          nextStatus.message || "已找到之前下载的文件，马上为你打开。";
        nextStatus.tone = "neutral";
        nextStatus.canRetry = false;
        break;
      case "downloading":
        nextStatus.stageLabel = nextStatus.stageLabel || "下载中";
        nextStatus.title = nextStatus.title || "正在下载高清 PDF";
        nextStatus.message = nextStatus.message || "下载过程可能受网络影响。";
        nextStatus.tone = "neutral";
        nextStatus.showProgress = true;
        nextStatus.canRetry = false;
        break;
      case "saving":
        nextStatus.stageLabel = nextStatus.stageLabel || "保存中";
        nextStatus.title = nextStatus.title || "正在写入本地";
        nextStatus.message = nextStatus.message || "保存完成后会立即打开。";
        nextStatus.tone = "neutral";
        nextStatus.showProgress = false;
        nextStatus.canRetry = false;
        break;
      case "opening":
        nextStatus.stageLabel = nextStatus.stageLabel || "打开中";
        nextStatus.title = nextStatus.title || "正在打开 PDF";
        nextStatus.message = nextStatus.message || "即将切换到系统阅读器。";
        nextStatus.tone = "neutral";
        nextStatus.showProgress = false;
        nextStatus.canRetry = false;
        break;
      case "success":
        nextStatus.stageLabel = nextStatus.stageLabel || "已完成";
        nextStatus.title = nextStatus.title || "PDF 已打开";
        nextStatus.message =
          nextStatus.message || "你可以在阅读器中继续查看或分享。";
        nextStatus.tone = "success";
        nextStatus.showProgress = false;
        nextStatus.canRetry = false;
        break;
      case "error":
        nextStatus.stageLabel = nextStatus.stageLabel || "失败";
        nextStatus.title = nextStatus.title || "打开失败";
        nextStatus.message = nextStatus.message || "请稍后重试。";
        nextStatus.tone = "error";
        nextStatus.showProgress = false;
        nextStatus.canRetry = true;
        break;
      default:
        nextStatus.visible = false;
        nextStatus.tone = "neutral";
        nextStatus.showProgress = false;
        nextStatus.canRetry = false;
        break;
    }

    if (nextStatus.showProgress) {
      const progress = this.normalizePdfProgress(nextStatus.progress);
      nextStatus.progress = progress;
      nextStatus.progressText = nextStatus.progressText || `${progress}%`;
    } else {
      nextStatus.progress = this.normalizePdfProgress(nextStatus.progress);
      nextStatus.progressText = nextStatus.progressText || "";
    }

    const actionBusy = this.isPdfBusyStage(stage);

    this.setData({
      pdfActionBusy: actionBusy,
      pdfActionLabel: actionBusy ? this.getPdfActionLabel(stage) : "",
      pdfStatus: nextStatus,
    });
  },

  updatePdfDownloadProgress(progress: number) {
    const normalizedProgress = this.normalizePdfProgress(progress);
    const currentStatus = this.data.pdfStatus as PdfStatusView;

    if (currentStatus.stage !== "downloading") {
      return;
    }

    if (
      normalizedProgress <= currentStatus.progress &&
      normalizedProgress !== 100
    ) {
      return;
    }

    this.setPdfStatusStage("downloading", {
      progress: normalizedProgress,
      progressText: `${normalizedProgress}%`,
      message:
        normalizedProgress >= 100
          ? "下载完成，正在写入临时文件..."
          : "正在下载高清 PDF...",
    });
  },

  buildFullPdfUrl(pdfUrl: string): string {
    return buildAbsoluteApiUrl(pdfUrl);
  },

  resolvePdfFilename(): string {
    const explicitFilename = String(this.data.pdfFilename || "").trim();
    if (explicitFilename) {
      return explicitFilename;
    }

    const filenameFromUrl = extractFilenameFromUrl(
      String(this.data.pdfUrl || ""),
    );
    if (filenameFromUrl) {
      return filenameFromUrl;
    }

    return DEFAULT_PDF_FILENAME;
  },

  buildPdfCacheKey(rawPdfUrl: string): string {
    const conclusionId = String(
      this.data.id || this.currentDetailId || "",
    ).trim();
    return this.buildPdfCacheKeyFor(conclusionId, rawPdfUrl);
  },

  buildPdfCacheKeyFor(conclusionId: string, rawPdfUrl: string): string {
    const normalizedId = String(conclusionId || "").trim();
    const normalizedPdfUrl = String(rawPdfUrl || "").trim();
    if (!normalizedId || !normalizedPdfUrl) {
      return "";
    }

    return `${normalizedId}::${normalizedPdfUrl}`;
  },

  resolvePdfOpenContext(): PdfOpenContext {
    if (!this.data.pdfAvailable) {
      throw new PdfOperationError("validate", "当前内容暂未提供 PDF");
    }

    const rawPdfUrl = String(this.data.pdfUrl || "").trim();
    if (!rawPdfUrl) {
      throw new PdfOperationError("validate", "暂时无法获取 PDF，请稍后再试");
    }

    const fullPdfUrl = this.buildFullPdfUrl(rawPdfUrl);
    if (!fullPdfUrl) {
      throw new PdfOperationError("validate", "暂时无法获取 PDF，请稍后再试");
    }

    return {
      rawPdfUrl,
      fullPdfUrl,
      pdfFilename: this.resolvePdfFilename(),
      cacheKey: this.buildPdfCacheKey(rawPdfUrl),
    };
  },

  getPdfCacheMap(): Record<string, string> {
    try {
      const rawCache = wx.getStorageSync(PDF_CACHE_STORAGE_KEY);
      if (
        !rawCache ||
        typeof rawCache !== "object" ||
        Array.isArray(rawCache)
      ) {
        return {};
      }

      const normalized: Record<string, string> = {};
      const entries = rawCache as Record<string, unknown>;
      Object.keys(entries).forEach((key) => {
        const value = entries[key];
        if (typeof value === "string" && value.trim()) {
          normalized[key] = value;
        }
      });

      return normalized;
    } catch (error) {
      detailPageLogger.warn("read_pdf_cache_map_failed", {
        error,
      });
      return {};
    }
  },

  getCachedPdfFilePath(cacheKey: string): string {
    if (!cacheKey) {
      return "";
    }

    const cacheMap = this.getPdfCacheMap();
    return typeof cacheMap[cacheKey] === "string" ? cacheMap[cacheKey] : "";
  },

  setCachedPdfFilePath(cacheKey: string, savedFilePath: string) {
    if (!cacheKey || !savedFilePath) {
      return;
    }

    try {
      const cacheMap = this.getPdfCacheMap();
      cacheMap[cacheKey] = savedFilePath;
      wx.setStorageSync(PDF_CACHE_STORAGE_KEY, cacheMap);
    } catch (error) {
      detailPageLogger.warn("write_pdf_cache_map_failed", {
        cacheKey,
        error,
      });
    }
  },

  removeCachedPdfFilePath(cacheKey: string) {
    if (!cacheKey) {
      return;
    }

    try {
      const cacheMap = this.getPdfCacheMap();
      if (!Object.prototype.hasOwnProperty.call(cacheMap, cacheKey)) {
        return;
      }

      delete cacheMap[cacheKey];
      wx.setStorageSync(PDF_CACHE_STORAGE_KEY, cacheMap);
    } catch (error) {
      detailPageLogger.warn("remove_pdf_cache_entry_failed", {
        cacheKey,
        error,
      });
    }
  },

  isFileNotFoundError(error: unknown): boolean {
    const errMsg = String(
      (error as { errMsg?: string } | undefined)?.errMsg || "",
    ).toLowerCase();

    return (
      errMsg.includes("file not exist") ||
      errMsg.includes("no such file") ||
      errMsg.includes("not found")
    );
  },

  removeSavedPdfFile(savedFilePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      const normalizedPath = String(savedFilePath || "").trim();
      if (!normalizedPath) {
        resolve(true);
        return;
      }

      wx.removeSavedFile({
        filePath: normalizedPath,
        success: () => {
          resolve(true);
        },
        fail: (error) => {
          if (this.isFileNotFoundError(error)) {
            resolve(true);
            return;
          }

          detailPageLogger.warn("remove_saved_pdf_file_failed", {
            filePath: normalizedPath,
            error,
          });
          resolve(false);
        },
      });
    });
  },

  isPdfSavedFileStillReferenced(savedFilePath: string): boolean {
    const normalizedPath = String(savedFilePath || "").trim();
    if (!normalizedPath) {
      return false;
    }

    const cacheMap = this.getPdfCacheMap();
    return Object.keys(cacheMap).some((cacheKey) => {
      return cacheMap[cacheKey] === normalizedPath;
    });
  },

  async invalidateCachedPdfFile(cacheKey: string): Promise<void> {
    if (!cacheKey) {
      return;
    }

    const cachedFilePath = this.getCachedPdfFilePath(cacheKey);
    this.removeCachedPdfFilePath(cacheKey);

    if (!cachedFilePath || this.isPdfSavedFileStillReferenced(cachedFilePath)) {
      return;
    }

    await this.removeSavedPdfFile(cachedFilePath);
  },

  async invalidatePdfCacheForDetailRefresh(
    detailId: string,
    refreshedDetail: DetailDocumentView,
  ): Promise<void> {
    const idCandidates = [
      detailId,
      this.currentDetailId,
      this.data.id,
      refreshedDetail.id,
    ]
      .map((id) => String(id || "").trim())
      .filter((id, index, list) => Boolean(id) && list.indexOf(id) === index);

    const pdfUrlCandidates = [
      this.data.pdfUrl,
      refreshedDetail.pdfUrl,
    ]
      .map((pdfUrl) => String(pdfUrl || "").trim())
      .filter((pdfUrl, index, list) => {
        return Boolean(pdfUrl) && list.indexOf(pdfUrl) === index;
      });

    if (idCandidates.length <= 0 || pdfUrlCandidates.length <= 0) {
      return;
    }

    const cacheKeys: string[] = [];
    idCandidates.forEach((id) => {
      pdfUrlCandidates.forEach((pdfUrl) => {
        const cacheKey = this.buildPdfCacheKeyFor(id, pdfUrl);
        if (cacheKey && cacheKeys.indexOf(cacheKey) < 0) {
          cacheKeys.push(cacheKey);
        }
      });
    });

    await Promise.all(
      cacheKeys.map((cacheKey) => this.invalidateCachedPdfFile(cacheKey)),
    );
  },

  isSavedFilePathAvailable(savedFilePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!savedFilePath) {
        resolve(false);
        return;
      }

      wx.getFileSystemManager().getFileInfo({
        filePath: savedFilePath,
        success: () => {
          resolve(true);
        },
        fail: () => {
          resolve(false);
        },
      });
    });
  },

  async resolveValidCachedPdfPath(cacheKey: string): Promise<string> {
    const cachedFilePath = this.getCachedPdfFilePath(cacheKey);
    if (!cachedFilePath) {
      return "";
    }

    const isAvailable = await this.isSavedFilePathAvailable(cachedFilePath);
    if (isAvailable) {
      return cachedFilePath;
    }

    this.removeCachedPdfFilePath(cacheKey);
    return "";
  },

  downloadPdfWithProgress(
    url: string,
    pdfFilename: string,
    onProgress?: (progress: number) => void,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const downloadTask = wx.downloadFile({
        url,
        success: (res) => {
          this.pdfDownloadTask = null;

          if (res.statusCode !== 200 || !res.tempFilePath) {
            reject(
              new PdfOperationError(
                "download",
                `${pdfFilename} download failed (HTTP ${res.statusCode})`,
                res,
              ),
            );
            return;
          }

          resolve(res.tempFilePath);
        },
        fail: (error) => {
          this.pdfDownloadTask = null;

          reject(
            new PdfOperationError(
              "download",
              `${pdfFilename} download failed: ${error.errMsg || ""}`.trim(),
              error,
            ),
          );
        },
      });

      this.pdfDownloadTask = downloadTask;

      downloadTask.onProgressUpdate((res) => {
        onProgress?.(Number(res.progress || 0));
      });
    });
  },

  savePdfFromTempFile(
    tempFilePath: string,
    pdfFilename: string,
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      wx.getFileSystemManager().saveFile({
        tempFilePath,
        success: (res) => {
          if (!res.savedFilePath) {
            reject(
              new PdfOperationError(
                "save",
                `${pdfFilename} save failed: empty savedFilePath`,
                res,
              ),
            );
            return;
          }

          resolve(res.savedFilePath);
        },
        fail: (error) => {
          reject(
            new PdfOperationError(
              "save",
              `${pdfFilename} save failed: ${error.errMsg || ""}`.trim(),
              error,
            ),
          );
        },
      });
    });
  },

  openPdfFile(filePath: string, pdfFilename: string): Promise<void> {
    return new Promise((resolve, reject) => {
      wx.openDocument({
        filePath,
        fileType: "pdf",
        showMenu: true,
        success: () => {
          resolve();
        },
        fail: (error) => {
          reject(
            new PdfOperationError(
              "open",
              `${pdfFilename} open failed: ${error.errMsg || ""}`.trim(),
              error,
            ),
          );
        },
      });
    });
  },

  mapPdfErrorToStatus(error: unknown): PdfErrorPresentation {
    const stage = error instanceof PdfOperationError ? error.stage : "download";
    const rawMessage = String(getErrorMessage(error, "") || "").trim();
    const normalizedMessage = rawMessage.toLowerCase();

    if (stage === "validate") {
      return {
        stageLabel: "资源不可用",
        title: "暂时无法打开 PDF",
        message: rawMessage || "当前条目暂无可用 PDF。",
      };
    }

    if (stage === "save") {
      if (
        normalizedMessage.includes("the maximum size") ||
        normalizedMessage.includes("file system full") ||
        normalizedMessage.includes("exceed")
      ) {
        return {
          stageLabel: "保存失败",
          title: "本地空间不足",
          message: "请清理手机存储空间后重试。",
        };
      }

      return {
        stageLabel: "保存失败",
        title: "写入本地失败",
        message: "PDF 已下载，但保存失败，请稍后重试。",
      };
    }

    if (stage === "open" || stage === "cache") {
      if (
        normalizedMessage.includes("no such file") ||
        normalizedMessage.includes("not found")
      ) {
        return {
          stageLabel: "打开失败",
          title: "本地文件已失效",
          message: "缓存文件不可用，重新下载后再试。",
        };
      }

      return {
        stageLabel: "打开失败",
        title: "系统未能打开 PDF",
        message: "请稍后重试，或切换网络后再试。",
      };
    }

    if (
      normalizedMessage.includes("url not in domain list") ||
      normalizedMessage.includes("url scheme is invalid")
    ) {
      return {
        stageLabel: "下载失败",
        title: "下载域名未授权",
        message: "请将 PDF 域名加入 downloadFile 合法域名列表。",
      };
    }

    if (normalizedMessage.includes("timeout")) {
      return {
        stageLabel: "下载超时",
        title: "PDF 下载失败",
        message: "PDF 下载失败，请稍后再试",
      };
    }

    return {
      stageLabel: "下载失败",
      title: "PDF 下载失败",
      message: "PDF 下载失败，请稍后再试",
    };
  },

  async openPdf() {
    if (this.data.pdfActionBusy || this.data.isDownloadingPdf) {
      return;
    }

    const downloadStartedAt = Date.now();
    trackEvent("pdf_download_start", {
      item_id: String(this.data.id || this.currentDetailId || ""),
      module: String(this.data.category || ""),
      source: "detail",
      page: "detail",
      entry: "pdf_button",
    });

    this.setData({
      isDownloadingPdf: true,
    });
    this.clearPdfStatusTimer();

    let context: PdfOpenContext | null = null;
    let activeCacheKey = "";

    try {
      this.setPdfStatusStage("preparing", {
        message: "正在检查文档资源...",
      });

      const resolvedContext = this.resolvePdfOpenContext();
      context = resolvedContext;
      activeCacheKey = resolvedContext.cacheKey;

      const cachedFilePath = await this.resolveValidCachedPdfPath(
        resolvedContext.cacheKey,
      );
      if (cachedFilePath) {
        this.setPdfStatusStage("cacheHit");
        this.setPdfStatusStage("opening", {
          message: "正在打开已缓存的 PDF...",
        });

        await this.openPdfFile(cachedFilePath, resolvedContext.pdfFilename);

        this.setPdfStatusStage("success", {
          title: "PDF 已打开",
          message: "已从本地缓存打开，体验更顺滑。",
        });
        trackEvent("pdf_download_success", {
          item_id: String(this.data.id || this.currentDetailId || ""),
          module: String(this.data.category || ""),
          source: "detail",
          page: "detail",
          entry: "pdf_button",
          duration_ms: Date.now() - downloadStartedAt,
        });
        this.schedulePdfStatusDismiss();
        return;
      }

      this.setPdfStatusStage("downloading", {
        progress: 0,
        progressText: "0%",
      });

      const tempFilePath = await this.downloadPdfWithProgress(
        resolvedContext.fullPdfUrl,
        resolvedContext.pdfFilename,
        (progress: number) => {
          this.updatePdfDownloadProgress(progress);
        },
      );

      this.setPdfStatusStage("saving", {
        message: "下载完成，正在保存到本地...",
      });

      const savedFilePath = await this.savePdfFromTempFile(
        tempFilePath,
        resolvedContext.pdfFilename,
      );

      if (resolvedContext.cacheKey) {
        this.setCachedPdfFilePath(resolvedContext.cacheKey, savedFilePath);
      }

      this.setPdfStatusStage("opening", {
        message: "正在调用系统阅读器...",
      });

      await this.openPdfFile(savedFilePath, resolvedContext.pdfFilename);

      this.setPdfStatusStage("success", {
        title: "PDF 已打开",
        message: "下载并缓存完成，下次会更快。",
      });
      trackEvent("pdf_download_success", {
        item_id: String(this.data.id || this.currentDetailId || ""),
        module: String(this.data.category || ""),
        source: "detail",
        page: "detail",
        entry: "pdf_button",
        duration_ms: Date.now() - downloadStartedAt,
      });
      this.schedulePdfStatusDismiss();
    } catch (error) {
      const stage =
        error instanceof PdfOperationError ? error.stage : "download";

      if ((stage === "open" || stage === "cache") && activeCacheKey) {
        this.removeCachedPdfFilePath(activeCacheKey);
      }

      const mappedError = this.mapPdfErrorToStatus(error);
      this.setPdfStatusStage("error", {
        stageLabel: mappedError.stageLabel,
        title: mappedError.title,
        message: mappedError.message,
        canRetry: stage !== "validate",
      });

      detailPageLogger.error("open_pdf_failed", {
        stage,
        error,
        context,
      });
      trackEvent("pdf_download_fail", {
        item_id: String(this.data.id || this.currentDetailId || ""),
        module: String(this.data.category || ""),
        source: "detail",
        page: "detail",
        entry: "pdf_button",
        error_type: stage,
        duration_ms: Date.now() - downloadStartedAt,
      });
    } finally {
      this.abortPdfDownloadTask();
      this.setData({
        isDownloadingPdf: false,
      });
    }
  },

  onToggleZoom() {
    if (this.scale > 1.01) {
      this.resetTransform();
      return;
    }

    this.prepareZoomViewport(() => {
      const centerX = this.containerWidth ? this.containerWidth / 2 : 0;
      const centerY = this.containerHeight ? this.containerHeight / 2 : 0;

      this.zoomTo(1.8, centerX, centerY);
    });
  },

  getTouches(e: WechatMiniprogram.TouchEvent): TouchPoint[] {
    return e.touches as unknown as TouchPoint[];
  },

  getDistance(touches: TouchPoint[]) {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  getCenter(touches: TouchPoint[]) {
    const first = this.getViewerPoint(touches[0]);
    const second = this.getViewerPoint(touches[1]);

    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
  },

  getViewerPoint(point: TouchPoint) {
    return {
      x: point.pageX - this.viewerLeft,
      y: point.pageY - this.viewerTop,
    };
  },

  getMaxScrollTop() {
    return Math.max(0, this.contentHeight - this.containerHeight);
  },

  getRestoreScrollTop() {
    if (this.scale <= 1.01) {
      return Math.min(
        this.getMaxScrollTop(),
        Math.max(0, this.articleScrollTop),
      );
    }

    const visibleTop = -this.translateY / Math.max(this.scale, 1);
    return Math.min(this.getMaxScrollTop(), Math.max(0, visibleTop));
  },

  prepareZoomViewport(callback?: () => void) {
    const currentScrollTop = this.articleScrollTop;

    if (currentScrollTop <= 0.5) {
      callback?.();
      return;
    }

    this.translateX = 0;
    this.lastTranslateX = 0;
    this.translateY = -currentScrollTop;
    this.lastTranslateY = this.translateY;
    this.articleScrollTop = 0;

    this.setData(
      {
        articleScrollTop: 0,
        transformStyle: this.buildTransformStyle(),
      },
      () => {
        callback?.();
      },
    );
  },

  buildTransformStyle() {
    return `transform: translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale});`;
  },

  syncTransformState() {
    this.setData({
      transformStyle: this.buildTransformStyle(),
      zoomActive: this.scale > 1.01,
      scaleLabel: `${Math.round(this.scale * 100)}%`,
    });
  },

  calcBounds() {
    const scaledWidth = this.contentWidth * this.scale;
    const scaledHeight = this.contentHeight * this.scale;

    let minX = 0;
    let maxX = 0;
    let minY = 0;
    let maxY = 0;

    if (scaledWidth > this.containerWidth) {
      minX = this.containerWidth - scaledWidth;
      maxX = 0;
    } else {
      const centeredX = (this.containerWidth - scaledWidth) / 2;
      minX = centeredX;
      maxX = centeredX;
    }

    if (scaledHeight > this.containerHeight) {
      minY = this.containerHeight - scaledHeight;
      maxY = 0;
    } else {
      const centeredY = (this.containerHeight - scaledHeight) / 2;
      minY = centeredY;
      maxY = centeredY;
    }

    return {
      minX,
      maxX,
      minY,
      maxY,
    };
  },

  applyResistance(value: number, min: number, max: number) {
    if (value >= min && value <= max) {
      return value;
    }

    if (value < min) {
      return min + (value - min) * 0.35;
    }

    return max + (value - max) * 0.35;
  },

  rebound() {
    const bounds = this.calcBounds();
    const targetX = Math.min(
      bounds.maxX,
      Math.max(bounds.minX, this.translateX),
    );
    const targetY = Math.min(
      bounds.maxY,
      Math.max(bounds.minY, this.translateY),
    );

    const startX = this.translateX;
    const startY = this.translateY;
    const deltaX = targetX - startX;
    const deltaY = targetY - startY;

    if (Math.abs(deltaX) < 0.5 && Math.abs(deltaY) < 0.5) {
      this.translateX = targetX;
      this.translateY = targetY;
      this.lastTranslateX = targetX;
      this.lastTranslateY = targetY;
      this.syncTransformState();
      return;
    }

    const duration = 220;
    const startTime = Date.now();

    const animate = () => {
      let progress = (Date.now() - startTime) / duration;
      if (progress > 1) {
        progress = 1;
      }

      const ease = 1 - Math.pow(1 - progress, 3);
      this.translateX = startX + deltaX * ease;
      this.translateY = startY + deltaY * ease;
      this.syncTransformState();

      if (progress < 1) {
        this.raf(animate);
        return;
      }

      this.lastTranslateX = this.translateX;
      this.lastTranslateY = this.translateY;
    };

    animate();
  },

  zoomTo(targetScale: number, centerX: number, centerY: number) {
    const clampedScale = Math.max(
      this.minScale,
      Math.min(targetScale, this.maxScale),
    );
    const ratio = clampedScale / this.scale;

    this.translateX = centerX - ratio * (centerX - this.translateX);
    this.translateY = centerY - ratio * (centerY - this.translateY);
    this.scale = clampedScale;
    this.lastScale = clampedScale;
    this.syncTransformState();
    this.rebound();
  },

  stopInertia() {
    clearTimeout(this.inertiaId);
  },

  onArticleScroll(e: WechatMiniprogram.ScrollViewScroll) {
    if (this.scale > 1.01) {
      return;
    }

    this.articleScrollTop = Number(e.detail.scrollTop || 0);
  },

  onDetailTocItemTap(e: WechatMiniprogram.BaseEvent) {
    if (this.data.zoomActive) {
      return;
    }

    const anchorId = normalizeString(e.currentTarget.dataset.anchorId);
    const key = normalizeString(e.currentTarget.dataset.key);
    const matchedItem = (this.data.detailTocItems || []).find(
      (item) => item.anchorId === anchorId && item.key === key,
    );

    if (!matchedItem) {
      return;
    }

    const correctionToken = this.createDetailTocScrollCorrectionToken();
    this.scrollDetailArticleToAnchor(matchedItem, correctionToken);
  },

  createDetailTocScrollCorrectionToken(): number {
    this.detailTocScrollCorrectionToken += 1;
    return this.detailTocScrollCorrectionToken;
  },

  isDetailTocScrollCorrectionActive(token: number): boolean {
    return (
      token === this.detailTocScrollCorrectionToken
      && this.data.viewState === "content"
      && !this.data.zoomActive
      && this.scale <= 1.01
    );
  },

  measureDetailArticleAnchor(
    item: DetailTocItem,
    callback: (
      measurement: DetailAnchorMeasurement | null,
    ) => void,
  ) {
    const query = wx.createSelectorQuery().in(this);
    query.select(".article-scroll").fields({
      rect: true,
      size: true,
      scrollOffset: true,
    });
    query.select(`#${item.anchorId}`).boundingClientRect();
    query.exec((res) => {
      const scrollNode = res[0] as
        | { top?: number; scrollTop?: number }
        | null
        | undefined;
      const anchorRect = res[1] as
        | { top?: number }
        | null
        | undefined;

      if (
        !scrollNode
        || !anchorRect
        || !Number.isFinite(scrollNode.top)
        || !Number.isFinite(scrollNode.scrollTop)
        || !Number.isFinite(anchorRect.top)
      ) {
        callback(null);
        return;
      }

      const offsetTop = Math.round(
        Number(anchorRect.top || 0) - Number(scrollNode.top || 0),
      );
      const targetScrollTop = Math.max(
        0,
        Math.round(
          Number(scrollNode.scrollTop || 0)
            + offsetTop,
        ),
      );

      callback({
        offsetTop,
        targetScrollTop,
      });
    });
  },

  scrollDetailArticleToAnchor(
    item: DetailTocItem,
    correctionToken: number,
    retryCount = 0,
  ) {
    if (!this.isDetailTocScrollCorrectionActive(correctionToken)) {
      return;
    }

    this.measureDetailArticleAnchor(item, (measurement: DetailAnchorMeasurement | null) => {
      if (!this.isDetailTocScrollCorrectionActive(correctionToken)) {
        return;
      }

      if (!measurement) {
        if (retryCount < 2) {
          setTimeout(() => {
            this.scrollDetailArticleToAnchor(
              item,
              correctionToken,
              retryCount + 1,
            );
          }, 80);
        }
        return;
      }

      this.applyDetailArticleScrollTop(
        measurement.targetScrollTop,
        item.key,
        () => {
          this.scheduleDetailTocScrollCorrection(item, correctionToken, 0);
        },
      );
    });
  },

  scheduleDetailTocScrollCorrection(
    item: DetailTocItem,
    correctionToken: number,
    attemptIndex: number,
  ) {
    const delayMs = DETAIL_TOC_SCROLL_CORRECTION_DELAYS_MS[attemptIndex];
    if (typeof delayMs !== "number") {
      return;
    }

    setTimeout(() => {
      if (!this.isDetailTocScrollCorrectionActive(correctionToken)) {
        return;
      }

      this.measureDetailArticleAnchor(item, (measurement: DetailAnchorMeasurement | null) => {
        if (!this.isDetailTocScrollCorrectionActive(correctionToken)) {
          return;
        }

        const scheduleNext = () => {
          this.scheduleDetailTocScrollCorrection(
            item,
            correctionToken,
            attemptIndex + 1,
          );
        };

        if (!measurement) {
          scheduleNext();
          return;
        }

        if (
          Math.abs(measurement.offsetTop)
          <= DETAIL_TOC_SCROLL_CORRECTION_THRESHOLD_PX
        ) {
          scheduleNext();
          return;
        }

        this.applyDetailArticleScrollTop(
          measurement.targetScrollTop,
          item.key,
          scheduleNext,
        );
      });
    }, delayMs);
  },

  applyDetailArticleScrollTop(
    targetScrollTop: number,
    activeKey: DetailTocKey,
    callback?: () => void,
  ) {
    const normalizedTarget = Math.max(0, Math.round(Number(targetScrollTop) || 0));
    const currentBoundTop = Math.max(
      0,
      Math.round(Number(this.data.articleScrollTop) || 0),
    );

    const commitScrollTop = () => {
      this.articleScrollTop = normalizedTarget;
      this.setData({
        activeDetailTocKey: activeKey,
        articleScrollTop: normalizedTarget,
        articleScrollWithAnimation: false,
      }, callback);
    };

    if (currentBoundTop === normalizedTarget) {
      this.setData(
        {
          articleScrollTop: normalizedTarget > 0 ? normalizedTarget - 1 : 1,
          articleScrollWithAnimation: false,
        },
        commitScrollTop,
      );
      return;
    }

    commitScrollTop();
  },

  startInertia() {
    if (this.scale <= 1.01) {
      return;
    }

    const friction = 0.94;

    const step = () => {
      this.velocityX *= friction;
      this.velocityY *= friction;
      this.translateX += this.velocityX;
      this.translateY += this.velocityY;

      const bounds = this.calcBounds();

      if (
        this.translateX < bounds.minX ||
        this.translateX > bounds.maxX ||
        this.translateY < bounds.minY ||
        this.translateY > bounds.maxY
      ) {
        this.stopInertia();
        this.rebound();
        return;
      }

      this.syncTransformState();

      if (Math.abs(this.velocityX) > 0.12 || Math.abs(this.velocityY) > 0.12) {
        this.inertiaId = this.raf(step) as unknown as number;
      }
    };

    step();
  },

  handleDoubleTap(e: WechatMiniprogram.TouchEvent) {
    const now = Date.now();

    if (now - this.lastTapTime < 300 && e.touches.length === 1) {
      const point = this.getViewerPoint(this.getTouches(e)[0]);

      if (this.scale > 1.01) {
        this.resetTransform();
      } else {
        this.prepareZoomViewport(() => {
          this.zoomTo(2, point.x, point.y);
        });
      }
    }

    this.lastTapTime = now;
  },

  onTouchStart(e: WechatMiniprogram.TouchEvent) {
    this.stopInertia();
    this.handleDoubleTap(e);

    const touches = this.getTouches(e);

    if (touches.length === 1 && this.scale <= 1.01) {
      this.createDetailTocScrollCorrectionToken();
    }

    if (touches.length === 2) {
      if (this.scale <= 1.01) {
        this.prepareZoomViewport();
      }

      this.gesture.startDistance = this.getDistance(touches);
      this.gesture.startScale = this.scale;
      this.velocityX = 0;
      this.velocityY = 0;
    }

    if (touches.length === 1 && this.scale > 1.01) {
      const point = this.getViewerPoint(touches[0]);
      this.gesture.startX = point.x - this.lastTranslateX;
      this.gesture.startY = point.y - this.lastTranslateY;
      this.lastMoveTime = Date.now();
      this.lastMoveX = point.x;
      this.lastMoveY = point.y;
    }
  },

  onTouchMove(e: WechatMiniprogram.TouchEvent) {
    const touches = this.getTouches(e);

    if (touches.length === 1 && this.scale <= 1.01) {
      return;
    }

    if (this.ticking) {
      return;
    }

    this.ticking = true;

    this.raf(() => {
      if (touches.length === 2 && this.gesture.startDistance > 0) {
        const distance = this.getDistance(touches);
        let nextScale =
          (distance / this.gesture.startDistance) * this.gesture.startScale;
        nextScale = Math.max(this.minScale, Math.min(nextScale, this.maxScale));

        const center = this.getCenter(touches);
        const ratio = nextScale / this.scale;

        this.translateX = center.x - ratio * (center.x - this.translateX);
        this.translateY = center.y - ratio * (center.y - this.translateY);
        this.scale = nextScale;
      }

      if (touches.length === 1 && this.scale > 1.01) {
        const point = this.getViewerPoint(touches[0]);
        const rawX = point.x - this.gesture.startX;
        const rawY = point.y - this.gesture.startY;
        const bounds = this.calcBounds();

        this.translateX = this.applyResistance(rawX, bounds.minX, bounds.maxX);
        this.translateY = this.applyResistance(rawY, bounds.minY, bounds.maxY);

        const now = Date.now();
        const deltaTime = now - this.lastMoveTime;

        if (deltaTime > 0) {
          this.velocityX = ((point.x - this.lastMoveX) / deltaTime) * 16;
          this.velocityY = ((point.y - this.lastMoveY) / deltaTime) * 16;
          this.lastMoveTime = now;
          this.lastMoveX = point.x;
          this.lastMoveY = point.y;
        }
      }

      this.syncTransformState();
      this.ticking = false;
    });
  },

  onTouchEnd() {
    this.lastScale = this.scale;
    this.lastTranslateX = this.translateX;
    this.lastTranslateY = this.translateY;
    this.gesture.startDistance = 0;

    if (this.scale <= 1.01) {
      this.resetTransform();
      return;
    }

    if (Math.abs(this.velocityX) > 1 || Math.abs(this.velocityY) > 1) {
      this.startInertia();
    } else {
      this.rebound();
    }
  },

  resetTransform(syncData = true) {
    const restoreScrollTop = syncData ? this.getRestoreScrollTop() : 0;

    this.scale = 1;
    this.lastScale = 1;
    this.translateX = 0;
    this.translateY = 0;
    this.lastTranslateX = 0;
    this.lastTranslateY = 0;
    this.velocityX = 0;
    this.velocityY = 0;
    this.articleScrollTop = restoreScrollTop;

    if (syncData) {
      this.setData({
        articleScrollTop: restoreScrollTop,
        transformStyle: this.buildTransformStyle(),
        zoomActive: false,
        scaleLabel: "100%",
      });
    }
  },
});
