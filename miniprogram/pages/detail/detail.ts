
import type {
  DetailDocumentView,
  DetailSectionView,
} from "../../utils/detail-content";
import {
  buildAbsoluteApiUrl,
  extractFilenameFromUrl,
} from "../../utils/api-url";
import { addFavorite, removeFavorite } from "../../services/api/favorites-api";
import { requireAuthAndRun } from "../../utils/guards/require-auth-and-run";
import { getDetailDocumentById } from "../../utils/detail-content";
import { createLogger } from "../../utils/logger/logger";
import { getErrorMessage } from "../../utils/request";

type TouchPoint = {
  pageX: number;
  pageY: number;
};

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

class PdfOperationError extends Error {
  stage: PdfOperationStage;
  originalError: unknown;

  constructor(stage: PdfOperationStage, message: string, originalError: unknown = null) {
    super(message);
    this.name = "PdfOperationError";
    this.stage = stage;
    this.originalError = originalError;
  }
}

const DEFAULT_PDF_FILENAME = "hd-pdf.pdf";
const PDF_CACHE_STORAGE_KEY = "conclusion_pdf_cache_map_v1";
const PDF_STATUS_AUTO_HIDE_MS = 900;
const detailPageLogger = createLogger("detail-page");

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
    sections: [] as DetailSectionView[],
    pdfUrl: "",
    pdfFilename: "",
    pdfAvailable: false,
    pdfActionBusy: false,
    pdfActionLabel: "",
    pdfStatus: createIdlePdfStatus() as PdfStatusView,
    sourceType: "meta",
    viewState: "idle" as "idle" | "loading" | "content" | "empty" | "error",
    viewMessage: "",
    articleScrollTop: 0,
    transformStyle: "transform: translate3d(0px, 0px, 0) scale(1);",
    zoomActive: false,
    scaleLabel: "100%",
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
  pdfDownloadTask: null as WechatMiniprogram.DownloadTask | null,
  currentDetailId: "",

  
  raf(callback: Function) {
    return setTimeout(() => callback(), 16);
  },

  
  async loadDetail(options: Record<string, string | undefined>) {
    const id = String(options.id || "").trim();
    this.currentDetailId = id;

    if (!id) {
      this.applyErrorState("缺少结论 ID");
      return;
    }

    this.setData({
      id,
      viewState: "loading",
      viewMessage: "正在加载详情...",
    });

    try {
      const detail = await this.resolveDetailDocument(id);

      if (!detail) {
        this.applyEmptyState("未找到对应内容");
        return;
      }

      const hasContent = Boolean(
        detail.title ||
        detail.summary ||
        detail.coreFormulaHtml ||
        (Array.isArray(detail.sections) && detail.sections.length > 0),
      );

      if (!hasContent) {
        this.applyEmptyState("当前结论暂无可展示内容");
        return;
      }

      this.applyDetailDocument(detail);
    } catch (error) {
      this.applyErrorState(getErrorMessage(error, "详情加载失败"));
    }
  },

  
  async resolveDetailDocument(id: string): Promise<DetailDocumentView | null> {
    return getDetailDocumentById(id);
  },

  
  applyDetailDocument(detail: DetailDocumentView) {
    this.resetTransform(false);
    this.clearPdfStatusTimer();
    this.abortPdfDownloadTask();
    this.articleScrollTop = 0;

    this.setData(
      {
        id: detail.id,
        title: detail.title,
        category: detail.category,
        summary: detail.summary,
        summaryHtml: detail.summaryHtml,
        aliases: detail.aliases,
        aliasesDisplay: detail.aliases.join(" / "),
        tags: detail.tags,
        hasDifficulty: detail.hasDifficulty,
        difficultyLabel: detail.difficultyLabel,
        isFavorited: detail.isFavorited,
        favoriteActionBusy: false,
        showFavoriteStatus: detail.showFavoriteStatus,
        favoriteStatusText: detail.favoriteStatusText,
        coreFormulaHtml: detail.coreFormulaHtml,
        sections: detail.sections,
        pdfUrl: detail.pdfUrl,
        pdfFilename: detail.pdfFilename,
        pdfAvailable: detail.pdfAvailable,
        pdfActionBusy: false,
        pdfActionLabel: "",
        pdfStatus: createIdlePdfStatus(),
        sourceType: detail.sourceType,
        viewState: "content",
        viewMessage: "",
        articleScrollTop: 0,
        transformStyle: this.buildTransformStyle(),
        zoomActive: false,
        scaleLabel: "100%",
      },
      () => {
        this.scheduleMeasure();
      },
    );
  },

  applyEmptyState(message: string) {
    this.resetTransform(false);
    this.clearPdfStatusTimer();
    this.abortPdfDownloadTask();
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
      sections: [],
      pdfUrl: "",
      pdfFilename: "",
      pdfAvailable: false,
      pdfActionBusy: false,
      pdfActionLabel: "",
      pdfStatus: createIdlePdfStatus(),
      sourceType: "meta",
      viewState: "empty",
      viewMessage: message,
      articleScrollTop: 0,
      transformStyle: this.buildTransformStyle(),
      zoomActive: false,
      scaleLabel: "100%",
    });
  },

  applyErrorState(message: string) {
    this.resetTransform(false);
    this.clearPdfStatusTimer();
    this.abortPdfDownloadTask();
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
      sections: [],
      pdfUrl: "",
      pdfFilename: "",
      pdfAvailable: false,
      pdfActionBusy: false,
      pdfActionLabel: "",
      pdfStatus: createIdlePdfStatus(),
      sourceType: "meta",
      viewState: "error",
      viewMessage: message,
      articleScrollTop: 0,
      transformStyle: this.buildTransformStyle(),
      zoomActive: false,
      scaleLabel: "100%",
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

  async handleFavoriteToggleTap() {
    if (this.data.favoriteActionBusy) {
      return;
    }

    const conclusionId = String(this.data.id || "").trim();
    if (!conclusionId) {
      wx.showToast({
        title: "结论 ID 无效",
        icon: "none",
      });
      return;
    }

    const nextFavoriteState = !this.data.isFavorited;

    await requireAuthAndRun(
      async () => {
        await this.commitFavoriteToggle(conclusionId, nextFavoriteState);
      },
      {
        title: "请先登录",
        content: "登录后可同步收藏状态",
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

      wx.showToast({
        title: nextFavoriteState ? "已收藏" : "已取消收藏",
        icon: "success",
      });
    } catch (error) {
      wx.showToast({
        title: getErrorMessage(error, "收藏操作失败"),
        icon: "none",
      });
    } finally {
      this.setData({
        favoriteActionBusy: false,
      });
    }
  },

  
  onLoad(options: Record<string, string | undefined>) {
    void this.loadDetail(options);
  },

  
  onUnload() {
    clearTimeout(this.inertiaId);
    clearTimeout(this.measureTimer);
    this.clearPdfStatusTimer();
    this.abortPdfDownloadTask();
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

  onPdfStatusMaskTap() {
    this.dismissPdfStatus();
  },

  onRetryOpenPdf() {
    this.dismissPdfStatus();
    void this.openPdf();
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
        nextStatus.message = nextStatus.message || "你可以在阅读器中继续查看或分享。";
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
    const conclusionId = String(this.data.id || this.currentDetailId || "").trim();
    const normalizedPdfUrl = String(rawPdfUrl || "").trim();
    if (!conclusionId || !normalizedPdfUrl) {
      return "";
    }

    return `${conclusionId}::${normalizedPdfUrl}`;
  },

  resolvePdfOpenContext(): PdfOpenContext {
    if (!this.data.pdfAvailable) {
      throw new PdfOperationError("validate", "当前条目暂未提供高清 PDF。");
    }

    const rawPdfUrl = String(this.data.pdfUrl || "").trim();
    if (!rawPdfUrl) {
      throw new PdfOperationError("validate", "当前条目缺少 PDF 下载地址。");
    }

    const fullPdfUrl = this.buildFullPdfUrl(rawPdfUrl);
    if (!fullPdfUrl) {
      throw new PdfOperationError("validate", "PDF 地址无效，请稍后重试。");
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
      if (!rawCache || typeof rawCache !== "object" || Array.isArray(rawCache)) {
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

  isSavedFilePathAvailable(savedFilePath: string): Promise<boolean> {
    return new Promise((resolve) => {
      if (!savedFilePath) {
        resolve(false);
        return;
      }

      wx.getFileInfo({
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

  savePdfFromTempFile(tempFilePath: string, pdfFilename: string): Promise<string> {
    return new Promise((resolve, reject) => {
      wx.saveFile({
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
      if (normalizedMessage.includes("no such file") || normalizedMessage.includes("not found")) {
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
        title: "网络连接较慢",
        message: "请检查网络后重试。",
      };
    }

    return {
      stageLabel: "下载失败",
      title: "下载高清 PDF 失败",
      message: "请稍后重试，或切换网络后再试。",
    };
  },

  
  async openPdf() {
    if (this.data.pdfActionBusy) {
      return;
    }

    this.clearPdfStatusTimer();

    let context: PdfOpenContext | null = null;
    let activeCacheKey = "";

    try {
      this.setPdfStatusStage("preparing", {
        message: "正在检查文档资源...",
      });

      context = this.resolvePdfOpenContext();
      activeCacheKey = context.cacheKey;

      const cachedFilePath = await this.resolveValidCachedPdfPath(context.cacheKey);
      if (cachedFilePath) {
        this.setPdfStatusStage("cacheHit");
        this.setPdfStatusStage("opening", {
          message: "正在打开已缓存的 PDF...",
        });

        await this.openPdfFile(cachedFilePath, context.pdfFilename);

        this.setPdfStatusStage("success", {
          title: "PDF 已打开",
          message: "已从本地缓存打开，体验更顺滑。",
        });
        this.schedulePdfStatusDismiss();
        return;
      }

      this.setPdfStatusStage("downloading", {
        progress: 0,
        progressText: "0%",
      });

      const tempFilePath = await this.downloadPdfWithProgress(
        context.fullPdfUrl,
        context.pdfFilename,
        (progress) => {
          this.updatePdfDownloadProgress(progress);
        },
      );

      this.setPdfStatusStage("saving", {
        message: "下载完成，正在保存到本地...",
      });

      const savedFilePath = await this.savePdfFromTempFile(
        tempFilePath,
        context.pdfFilename,
      );

      if (context.cacheKey) {
        this.setCachedPdfFilePath(context.cacheKey, savedFilePath);
      }

      this.setPdfStatusStage("opening", {
        message: "正在调用系统阅读器...",
      });

      await this.openPdfFile(savedFilePath, context.pdfFilename);

      this.setPdfStatusStage("success", {
        title: "PDF 已打开",
        message: "下载并缓存完成，下次会更快。",
      });
      this.schedulePdfStatusDismiss();
    } catch (error) {
      const stage = error instanceof PdfOperationError ? error.stage : "download";

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
    } finally {
      this.abortPdfDownloadTask();
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


