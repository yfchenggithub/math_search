/**
 * 璇︽儏椤甸〉闈㈡帶鍒跺櫒銆?
 *
 * 杩欎釜鏂囦欢涓昏瑙ｅ喅涓や欢浜嬶細
 * 1. 鎺ヤ綇 `detail-content.ts` 浜у嚭鐨勮鎯?view model锛屽苟鎶婂畠鏀惧埌椤甸潰 data 涓€?
 * 2. 绠＄悊璇︽儏椤电殑闃呰浜や簰锛屽挨鍏舵槸婊氬姩銆佸弻鍑绘斁澶с€佸弻鎸囩缉鏀俱€佹嫋鎷藉拰骞虫粦鍥炲脊銆?
 *
 * 鍦ㄦ暣涓鎯呴摼璺腑鐨勪綅缃細
 * - `detail-content.ts` 璐熻矗鈥滄暟鎹€傞厤鈥濓紝鎶婂師濮?record 杞垚椤甸潰鍙秷璐圭粨鏋勩€?
 * - 鏈枃浠惰礋璐ｂ€滈〉闈㈢姸鎬佷笌浜や簰鎺у埗鈥濓紝涓嶅叧蹇冨師濮?schema 鐨勭粏鑺傘€?
 * - `detail.wxml / detail.scss` 璐熻矗鏈€缁堣鍥惧憟鐜般€?
 *
 * 鎺ㄨ崘闃呰椤哄簭锛?
 * 1. `onLoad`锛氳鎯呮暟鎹浣曡繘鍏ラ〉闈€?
 * 2. `scheduleMeasure / measureContent`锛氶〉闈负浠€涔堣娴嬮噺瀹瑰櫒涓庡唴瀹瑰昂瀵搞€?
 * 3. `onToggleZoom / zoomTo / rebound`锛氭斁澶х缉灏忔槸濡備綍宸ヤ綔鐨勩€?
 * 4. `onTouchStart / onTouchMove / onTouchEnd`锛氭墜鍔块摼璺浣曟帴绠℃暣椤甸槄璇汇€?
 */
import type {
  DetailDocumentView,
  DetailSectionView,
} from "../../utils/detail-content";
import {
  buildAbsoluteApiUrl,
  extractFilenameFromUrl,
} from "../../utils/api-url";
import { getDetailDocumentById } from "../../utils/detail-content";
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

/**
 * 璇︽儏椤电殑鏁翠綋鎵ц娴佺▼锛?
 * 1. `onLoad` 鏍规嵁璺敱鍙傛暟璇诲彇璇︽儏鏁版嵁锛屽苟鎶婂熀纭€鍐呭鏀惧叆椤甸潰 data銆?
 * 2. 椤甸潰娓叉煋瀹屾垚鍚庯紝璋冪敤 `scheduleMeasure` / `measureContent` 鑾峰彇瀹瑰櫒鍜屾鏂囧昂瀵搞€?
 * 3. 姝ｅ父鐘舵€佷笅鐢?`scroll-view` 璐熻矗绾靛悜闃呰婊氬姩銆?
 * 4. 涓€鏃﹁繘鍏ョ缉鏀炬€侊紝椤甸潰浼氭敼涓虹敱 transform + 鎵嬪娍鎺у埗瑙嗗彛浣嶇疆銆?
 * 5. 缂╂斁缁撴潫鍚庯紝閫氳繃 `resetTransform` / `getRestoreScrollTop` 灏介噺淇濇寔闃呰浣嶇疆杩炵画銆?
 */
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

  // 褰撳墠缂╂斁姣斾緥鍙婁笂涓€娆＄ǔ瀹氱缉鏀炬瘮渚嬨€?
  scale: 1,
  lastScale: 1,

  // 褰撳墠骞崇Щ閲忓強涓婁竴娆＄ǔ瀹氬钩绉婚噺銆?
  translateX: 0,
  translateY: 0,
  lastTranslateX: 0,
  lastTranslateY: 0,

  // 鍏佽鐨勭缉鏀捐寖鍥淬€傛渶灏忓€间繚鎸?1锛屼唬琛ㄩ粯璁ら槄璇绘€併€?
  minScale: 1,
  maxScale: 4,

  // 鎵嬪娍涓棿鎬併€傝繖閲屼繚瀛樹竴娆¤Е鎺ц繃绋嬪紑濮嬫椂鐨勫叧閿暟鎹紝鏂逛究 move 闃舵璁＄畻澧為噺銆?
  gesture: {
    startDistance: 0,
    startScale: 1,
    startX: 0,
    startY: 0,
  },

  lastTapTime: 0,
  ticking: false,

  // 瑙嗗彛涓庢鏂囧昂瀵镐俊鎭€?
  // 杩欎簺鏁版嵁鏄悗缁绠楃缉鏀捐竟鐣屻€佹嫋鎷借寖鍥村拰鍥炲脊鐩爣鐨勫熀纭€銆?
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

  /**
   * 涓€涓瀬绠€鐨?raf 鏇夸唬鍝併€?
   *
   * 灏忕▼搴忕幆澧冮噷骞朵笉鏄瘡澶勯兘鏂逛究鐩存帴浣跨敤娴忚鍣ㄥ師鐢?`requestAnimationFrame`锛?
   * 杩欓噷缁熶竴鐢?16ms 瀹氭椂鍣ㄦā鎷熶竴甯э紝鏈嶅姟鍥炲脊鍜屾儻鎬у姩鐢汇€?
   */
  raf(callback: Function) {
    return setTimeout(() => callback(), 16);
  },

  /**
   * 璇︽儏椤电殑鏁版嵁鍔犺浇鍏ュ彛銆?
   *
   * 褰撳墠閲囩敤鈥滃悗绔紭鍏堬紝鏈湴闄嶇骇鈥濈殑绛栫暐锛?
   * 1. 鍏堣姹傚悗绔?`/conclusion/{id}`锛?
   * 2. 濡傛灉鎺ュ彛涓嶅彲鐢紝鍒欒嚜鍔ㄥ洖閫€鍒版湰鍦伴潤鎬佸唴瀹癸紱
   * 3. 椤甸潰浜や簰灞傜户缁彧娑堣垂缁熶竴鐨?`DetailDocumentView`銆?
   */
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

  /**
   * 浼樺厛璇诲彇鍚庣璇︽儏锛屽け璐ュ悗鍥為€€鏈湴鍐呭銆?
   */
  async resolveDetailDocument(id: string): Promise<DetailDocumentView | null> {
    return getDetailDocumentById(id);
  },

  /**
   * 灏嗙粺涓€鐨勮鎯?view model 搴旂敤鍒伴〉闈€?
   *
   * 杩欓噷椤烘墜閲嶇疆缂╂斁鍜屾粴鍔ㄧ姸鎬侊紝閬垮厤浠庝笂涓€涓潯鐩畫鐣欎氦浜掔姸鎬併€?
   */
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

  /**
   * 璇︽儏椤靛叆鍙ｃ€?
   *
   * 杈撳叆锛?
   * - 璺敱鍙傛暟涓殑 `id`銆?
   *
   * 杈撳嚭锛?
   * - 璋冪敤璇︽儏閫傞厤灞傛嬁鍒扮粺涓€ view model銆?
   * - 鍒濆鍖栭〉闈?data銆?
   * - 閲嶇疆鎵€鏈夌缉鏀?鎷栨嫿鐘舵€侊紝纭繚浠庝笂涓€涓鎯呴〉鍒囪繃鏉ユ椂涓嶄細娈嬬暀浜や簰鐘舵€併€?
   */
  onLoad(options: Record<string, string | undefined>) {
    void this.loadDetail(options);
  },

  /**
   * 椤甸潰绂诲紑鏃舵竻鐞嗗畾鏃跺櫒锛岄伩鍏嶅姩鐢绘垨灏哄娴嬮噺鍦ㄩ〉闈㈤攢姣佸悗缁х画杩愯銆?
   */
  onUnload() {
    clearTimeout(this.inertiaId);
    clearTimeout(this.measureTimer);
    this.clearPdfStatusTimer();
    this.abortPdfDownloadTask();
  },

  /**
   * 椤甸潰 ready 鍚庡仛涓€娆″昂瀵告祴閲忋€?
   * 杩欐槸瀵归灞忔覆鏌撳悗鐨勫厹搴曪紝淇濊瘉瀹瑰櫒鍜屾鏂囧昂瀵稿敖蹇繘鍏ヨ绠楅摼璺€?
   */
  onReady() {
    this.scheduleMeasure();
  },

  /**
   * 椤甸潰灞€閮ㄥ唴瀹归噸鏂版覆鏌撳畬鎴愬悗鐨勫洖璋冦€?
   * 渚嬪 structured sections 娓叉煋瀹屾垚鍚庯紝姝ｆ枃楂樺害鍙兘鍙樺寲锛屽洜姝ら渶瑕侀噸鏂版祴閲忋€?
   */
  onRenderReady() {
    this.scheduleMeasure();
  },

  /**
   * 璋冨害姝ｆ枃灏哄娴嬮噺銆?
   *
   * 杩欓噷鏁呮剰鍋氫簡涓€涓緢鐭殑寤惰繜锛?
   * - 閬垮厤杩炵画 setData / 澶氭灞€閮ㄦ覆鏌撴椂棰戠箒瑙﹀彂娴嬮噺锛?
   * - 缁欏皬绋嬪簭甯冨眬涓€鐐圭ǔ瀹氭椂闂达紝鍑忓皯鎷垮埌涓棿鎬佸昂瀵哥殑姒傜巼銆?
   */
  scheduleMeasure() {
    clearTimeout(this.measureTimer);

    this.measureTimer = setTimeout(() => {
      this.measureContent();
    }, 80) as unknown as number;
  },

  /**
   * 瀹為檯璇诲彇瑙嗗彛涓庢鏂囧昂瀵搞€?
   *
   * 璇诲彇鍐呭锛?
   * - `.viewer`锛氬彲瑙嗗尯鍩熺殑瀹介珮鍜岄〉闈綅缃€?
   * - `#articleWrapper`锛氭鏂囧寘瑁瑰眰鐨勭湡瀹炲楂樸€?
   *
   * 杩欎簺灏哄鍐冲畾浜嗭細
   * - 缂╂斁鏃剁殑杈圭晫璁＄畻锛?
   * - 灞呬腑閫昏緫锛?
   * - 鍥炲脊鐩爣浣嶇疆锛?
   * - 鏄惁闇€瑕佸厑璁告煇涓柟鍚戠户缁嫋鎷姐€?
   */
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
      console.warn("Abort PDF download task failed", error);
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

  /**
   * Build full PDF URL from API baseURL + pdf_url.
   */
  buildFullPdfUrl(pdfUrl: string): string {
    return buildAbsoluteApiUrl(pdfUrl);
  },

  /**
   * Resolve filename from field first, then url, then default.
   */
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

  /**
   * Build stable cache key by `conclusion_id + pdf_url`.
   */
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
      console.warn("Read PDF cache map failed", error);
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
      console.warn("Write PDF cache map failed", error);
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
      console.warn("Remove PDF cache entry failed", error);
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

  /**
   * 鎵撳紑 PDF銆?   *
   * 浣跨敤鍦烘櫙锛?   * - 鍛戒腑缂撳瓨锛氱洿鎺ユ墦寮€鏈湴 savedFilePath銆?   * - 缂撳瓨鏈懡涓細涓嬭浇 -> 淇濆瓨 -> 鍐欏叆缂撳瓨 -> 鎵撳紑銆?   *
   * 杩欐閫昏緫涓嶅弬涓庨〉闈㈡覆鏌擄紝鍙礋璐ｉ槄璇绘墿灞曞叆鍙ｃ€?   */
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

      console.error("Open PDF failed", {
        stage,
        error,
        context,
      });
    } finally {
      this.abortPdfDownloadTask();
    }
  },

  /**
   * 鐐瑰嚮缁熶竴鐨勨€滅缉鏀鹃槄璇烩€濇寜閽€?
   *
   * 璁捐鎰忓浘锛?
   * - 鏈斁澶ф椂锛氫互瑙嗗彛涓績涓洪敋鐐硅繘鍏ユ斁澶ч槄璇绘€併€?
   * - 宸叉斁澶ф椂锛氭仮澶嶉粯璁ら槄璇绘€併€?
   */
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

  /**
   * 璇诲彇瑙︽懜鐐规暟缁勩€?
   * 鍗曠嫭灏佽鍑烘潵锛屾槸涓轰簡鎶婂皬绋嬪簭鐨勮Е鎽哥被鍨嬪拰椤甸潰鍐呴儴浣跨敤鐨勭畝鍖栧潗鏍囩粨鏋勯殧绂诲紑銆?
   */
  getTouches(e: WechatMiniprogram.TouchEvent): TouchPoint[] {
    return e.touches as unknown as TouchPoint[];
  },

  /**
   * 璁＄畻鍙屾寚璺濈锛岀敤浜?pinch 缂╂斁銆?
   */
  getDistance(touches: TouchPoint[]) {
    const dx = touches[0].pageX - touches[1].pageX;
    const dy = touches[0].pageY - touches[1].pageY;
    return Math.sqrt(dx * dx + dy * dy);
  },

  /**
   * 璁＄畻鍙屾寚涓績鐐广€?
   *
   * 缂╂斁鏃惰鍥寸粫鎵嬫寚涓績鍋氬彉鎹紝鍚﹀垯浼氫骇鐢熲€滃叕寮忔斁澶т絾鐒︾偣婕傜Щ鈥濈殑闃呰鍓茶鎰熴€?
   */
  getCenter(touches: TouchPoint[]) {
    const first = this.getViewerPoint(touches[0]);
    const second = this.getViewerPoint(touches[1]);

    return {
      x: (first.x + second.x) / 2,
      y: (first.y + second.y) / 2,
    };
  },

  /**
   * 鎶婇〉闈㈠潗鏍囪浆鎹㈡垚 viewer 鍐呴儴鍧愭爣銆?
   *
   * 璇︽儏椤电殑缂╂斁鍜屽钩绉婚兘鏄浉瀵逛簬 `.viewer` 瑙嗗彛璁＄畻鐨勶紝
   * 鍥犳鎵€鏈夎Е鐐归兘闇€瑕佸厛杞崲鍒板悓涓€鍧愭爣绯讳腑銆?
   */
  getViewerPoint(point: TouchPoint) {
    return {
      x: point.pageX - this.viewerLeft,
      y: point.pageY - this.viewerTop,
    };
  },

  /**
   * 榛樿闃呰鎬佷笅鍏佽鐨勬渶澶х旱鍚戞粴鍔ㄥ€笺€?
   */
  getMaxScrollTop() {
    return Math.max(0, this.contentHeight - this.containerHeight);
  },

  /**
   * 浠庣缉鏀炬€佸洖鍒版櫘閫氶槄璇绘€佹椂锛屾帹绠楀簲璇ヨ繕鍘熷埌鍝釜 scrollTop銆?
   *
   * 鏍稿績鐩殑鏄繚鎸佲€滅敤鎴锋鍦ㄧ湅鐨勯偅涓€鍧楀唴瀹光€濆敖閲忎笉璺宠蛋锛?
   * 涔熷氨鏄缉鏀惧墠鍚庣淮鎸侀槄璇讳綅缃繛缁€?
   */
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

  /**
   * 鍦ㄨ繘鍏ョ缉鏀炬€佷箣鍓嶏紝鎶婃櫘閫?scroll-view 鐨勬粴鍔ㄩ噺鎶樼畻鎴?transform 骞崇Щ閲忋€?
   *
   * 涓轰粈涔堥渶瑕佽繖涓€姝ワ細
   * - 榛樿闃呰鎬佺敱 scroll-view 鎺у埗绾靛悜婊氬姩銆?
   * - 缂╂斁鎬佹敼鐢?transform 鎺у埗鏁撮〉浣嶇疆銆?
   * - 濡傛灉涓嶅厛鍋氬潗鏍囩郴鍒囨崲锛岀敤鎴蜂竴鏀惧ぇ椤甸潰灏变細鈥滆烦浣嶇疆鈥濄€?
   */
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

  /**
   * 鎶婂綋鍓嶇缉鏀惧拰骞崇Щ鐘舵€佺粍瑁呮垚 style 瀛楃涓诧紝渚?WXML 鐩存帴缁戝畾銆?
   */
  buildTransformStyle() {
    return `transform: translate3d(${this.translateX}px, ${this.translateY}px, 0) scale(${this.scale});`;
  },

  /**
   * 鍚屾 transform 鐩稿叧鐨勯〉闈?data銆?
   *
   * 杩欓噷缁熶竴鏇存柊锛?
   * - transformStyle锛氬疄闄呰瑙夊彉鎹€?
   * - zoomActive锛氭槸鍚﹀浜庣缉鏀炬€併€?
   * - scaleLabel锛氬彸涓婅鏄剧ず鐨勭櫨鍒嗘瘮銆?
   */
  syncTransformState() {
    this.setData({
      transformStyle: this.buildTransformStyle(),
      zoomActive: this.scale > 1.01,
      scaleLabel: `${Math.round(this.scale * 100)}%`,
    });
  },

  /**
   * 鏍规嵁褰撳墠鍐呭灏哄鍜岀缉鏀炬瘮渚嬶紝璁＄畻鍙嫋鎷借竟鐣屻€?
   *
   * 瑙勫垯锛?
   * - 濡傛灉缂╂斁鍚庡唴瀹规瘮瑙嗗彛瀹?楂橈紝鍒欏厑璁稿湪杈圭晫鍐呮嫋鍔ㄣ€?
   * - 濡傛灉缂╂斁鍚庡唴瀹逛粛灏忎簬瑙嗗彛锛屽垯淇濇寔灞呬腑锛屼笉鍏佽鏌愪竴鏂瑰悜鑷敱婕傜Щ銆?
   */
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

  /**
   * 瓒婄晫闃诲凹銆?
   *
   * 褰撶敤鎴风户缁悜杈圭晫澶栨嫋鎷芥椂锛屼笉鏄珛鍒荤‖鎬ф埅鏂紝鑰屾槸缁欎竴涓“鍑忓悗鐨勪綅绉汇€?
   * 杩欐牱鎵嬫劅浼氭洿鏌斿拰锛岀粨鏉熷悗鍐嶄氦缁?`rebound` 鍋氭寮忓洖寮广€?
   */
  applyResistance(value: number, min: number, max: number) {
    if (value >= min && value <= max) {
      return value;
    }

    if (value < min) {
      return min + (value - min) * 0.35;
    }

    return max + (value - max) * 0.35;
  },

  /**
   * 鍥炲脊鍒板悎娉曡竟鐣屽唴銆?
   *
   * 浣跨敤鍦烘櫙锛?
   * - 鎵嬪姩鎷栨嫿缁撴潫浣嗕綅缃秺鐣屻€?
   * - 缂╂斁鍚庡唴瀹硅秴鍑鸿竟鐣屻€?
   * - 鎯€ф粦鍔ㄦ挒鍒拌竟鐣屻€?
   */
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

  /**
   * 浠ョ粰瀹氫腑蹇冪偣涓洪敋鎵ц缂╂斁銆?
   *
   * 杈撳叆锛?
   * - `targetScale`锛氱洰鏍囩缉鏀炬瘮渚嬨€?
   * - `centerX / centerY`锛氱缉鏀鹃敋鐐癸紝閫氬父鏄弻鎸囦腑蹇冩垨鍙屽嚮鐐广€?
   */
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

  /**
   * 鍋滄鎯€у姩鐢汇€?
   */
  stopInertia() {
    clearTimeout(this.inertiaId);
  },

  /**
   * 鏅€氶槄璇绘€佷笅璁板綍 scroll-view 鐨勭旱鍚戞粴鍔ㄥ€笺€?
   *
   * 娉ㄦ剰锛?
   * - 鍙湁鏈斁澶ф椂锛岃繖涓?scrollTop 鎵嶆槸鏈夋晥鐨勪富婊氬姩鏉ユ簮銆?
   * - 杩涘叆缂╂斁鎬佸悗锛岄〉闈綅缃敼鐢?transform 鎺у埗锛屽洜姝よ繖閲岀洿鎺ュ拷鐣ャ€?
   */
  onArticleScroll(e: WechatMiniprogram.ScrollViewScroll) {
    if (this.scale > 1.01) {
      return;
    }

    this.articleScrollTop = Number(e.detail.scrollTop || 0);
  },

  /**
   * 鍚姩鎯€ф粦鍔ㄣ€?
   *
   * 杩欎竴姝ュ彧鍦ㄧ缉鏀炬€佷笅宸ヤ綔锛岀敤浜庤鎷栨嫿缁撴潫鍚庣殑闃呰鎵嬫劅鏇存帴杩戝師鐢熼槄璇诲櫒銆?
   * 涓€鏃﹂€熷害琛板噺杩囧皬锛屾垨鎾炲埌杈圭晫锛屽氨鍋滄鎯€у苟鍥炲脊銆?
   */
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

  /**
   * 澶勭悊鍙屽嚮缂╂斁銆?
   *
   * 浜や簰瑙勫垯锛?
   * - 褰撳墠宸叉斁澶э細鍙屽嚮鎭㈠榛樿鎬併€?
   * - 褰撳墠鏈斁澶э細鍙屽嚮浠ョ偣鍑荤偣涓轰腑蹇冩斁澶с€?
   */
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

  /**
   * 瑙︽懜寮€濮嬨€?
   *
   * 涓昏鑱岃矗锛?
   * - 鍋滄帀褰撳墠鎯€э紝閬垮厤鍜屾柊鐨勬墜鍔垮啿绐併€?
   * - 璇嗗埆鍙屽嚮銆?
   * - 鍒濆鍖栧弻鎸囩缉鏀炬墍闇€鐨勮捣濮嬭窛绂诲拰璧峰姣斾緥銆?
   * - 鍒濆鍖栧崟鎸囨嫋鎷芥墍闇€鐨勮捣濮嬪亸绉讳笌閫熷害閲囨牱淇℃伅銆?
   */
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

  /**
   * 瑙︽懜绉诲姩銆?
   *
   * 涓ゆ潯涓昏鍒嗘敮锛?
   * - 鍙屾寚锛氭洿鏂扮缉鏀炬瘮渚嬶紝骞跺洿缁曞弻鎸囦腑蹇冨悓姝ヤ慨姝ｅ钩绉婚噺銆?
   * - 鍗曟寚锛氬湪缂╂斁鎬佷笅鎷栧姩鐢诲竷锛屽苟鎸佺画璁板綍閫熷害鐢ㄤ簬鍚庣画鎯€ф粦鍔ㄣ€?
   */
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

  /**
   * 瑙︽懜缁撴潫銆?
   *
   * 缁撴潫鏃朵細鎶婂綋鍓?transform 鍥哄寲涓衡€滅ǔ瀹氱姸鎬佲€濓紝鐒跺悗鏍规嵁閫熷害鍐冲畾锛?
   * - 杩涘叆鎯€ф粦鍔紱
   * - 鎴栫洿鎺ュ仛杈圭晫鍥炲脊锛?
   * - 濡傛灉宸茬粡鎺ヨ繎榛樿姣斾緥锛屽垯鎭㈠鏅€氶槄璇绘€併€?
   */
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

  /**
   * 閲嶇疆鍒伴粯璁ら槄璇绘€併€?
   *
   * 杈撳叆锛?
   * - `syncData`锛?
   *   - `true`锛氬悓姝ユ洿鏂伴〉闈?data锛岀湡姝ｅ洖鍒版櫘閫氶槄璇绘€併€?
   *   - `false`锛氬彧閲嶇疆鍐呴儴鐘舵€侊紝閫氬父鐢ㄤ簬椤甸潰鍒濆鍖栭樁娈点€?
   *
   * 杩欎釜鍑芥暟鏄鎯呴〉闃呰浜や簰鐨勨€滄€诲厹搴曗€濓紝寰堝寮傚父鎴栭€€鍑虹缉鏀剧殑璺緞閮戒細鍥炲埌杩欓噷銆?
   */
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

