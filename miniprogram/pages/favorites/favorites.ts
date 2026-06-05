import {
  createFavoriteHandout,
  downloadFavoriteHandoutPdf,
  getFavoritesList,
  removeFavorite,
  type FavoriteRecord,
} from "../../services/api/favorites-api";
import { authService } from "../../services/auth/auth-service";
import {
  resolveConclusionCards,
  type ConclusionCardCacheItem,
} from "../../services/conclusion-card-cache";
import { prefetchConclusionBundlesByIds } from "../../services/conclusion-prefetch";
import {
  setCachedFavoriteState,
  syncCachedFavoriteStates,
} from "../../services/favorite-state-cache";
import { RequestError, getErrorMessage } from "../../utils/request";
import { requireAuthAndRun } from "../../utils/guards/require-auth-and-run";
import {
  buildConclusionCardPreview,
  type ConclusionCardPreviewFields,
} from "../../utils/conclusion-card-preview";
import { createLogger } from "../../utils/logger/logger";

type FavoritesPageStatus = "loading" | "ready" | "empty" | "error" | "guest";
type FavoriteHandoutStatusType = "idle" | "loading" | "warning" | "error" | "success";

type FavoriteHandoutFeedback = {
  type: FavoriteHandoutStatusType;
  message: string;
};

type CardPreviewFields = ConclusionCardPreviewFields;

type FavoriteConclusionItem = {
  id: string;
  detailId: string;
  title: string;
  summary: string;
  tags: string[];
  module: string;
} & CardPreviewFields;

type FavoritesPageData = {
  pageStatus: FavoritesPageStatus;
  favoriteCount: number;
  favoriteItems: FavoriteConclusionItem[];
  favoriteHandoutMaxCount: number;
  handoutLimitActionText: string;
  handoutStatusType: FavoriteHandoutStatusType;
  handoutStatusMessage: string;
  isGeneratingHandout: boolean;
  isRemovingFavorite: boolean;
};

type FavoriteCardEvent = {
  detail?: {
    id?: string;
  };
};

type RefreshFavoritesReason =
  | "initial"
  | "retry"
  | "login_success"
  | "show_refresh";

type RefreshFavoritesOptions = {
  reason: RefreshFavoritesReason;
  showLoading: boolean;
  silentOnError: boolean;
};

const favoritesPageLogger = createLogger("favorites-page");
const FAVORITES_PAGE_SIZE = 50;
const FAVORITES_MAX_PAGE = 20;
const CARD_TAG_LIMIT = 3;
const FAVORITES_PREFETCH_MAX_COUNT = 20;
const FAVORITE_HANDOUT_MAX_COUNT = 10;
const DEFAULT_TITLE = "未命名结论";
const DEFAULT_SUMMARY = "点击查看详情";
const FAVORITE_CARD_UNAVAILABLE_MESSAGE = "收藏项暂不可用";
const FAVORITE_REMOVE_ACTION_TEXT = "取消收藏";
const FAVORITE_REMOVE_CONFIRM_TITLE = "取消收藏";
const FAVORITE_REMOVE_CONFIRM_FALLBACK_CONTENT = "取消后该条目将从收藏列表移除";
const FAVORITE_REMOVE_SUCCESS_MESSAGE = "已取消收藏";
const FAVORITE_REMOVE_FAILED_MESSAGE = "取消收藏失败，请稍后重试";
const SEARCH_PAGE_URL = "/pages/search/search";
const HANDOUT_GENERATING_STATUS_MESSAGE = "正在生成讲义，请稍候...";
const HANDOUT_DOWNLOADING_STATUS_MESSAGE = "讲义已生成，正在打开 PDF...";
const HANDOUT_OPEN_SUCCESS_MESSAGE = "讲义已打开，可在右上角分享或保存";
const HANDOUT_NO_FAVORITES_MESSAGE = "收藏内容后即可生成讲义";
const HANDOUT_MAX_FAVORITES_MESSAGE = `最多支持 ${FAVORITE_HANDOUT_MAX_COUNT} 条收藏生成讲义`;
const HANDOUT_LIMIT_ACTION_TEXT = `超过 ${FAVORITE_HANDOUT_MAX_COUNT} 条不可生成`;
const HANDOUT_STATUS_PROCESSING_MESSAGE = "讲义正在生成，请稍后重试";
const HANDOUT_STATUS_EXPIRED_MESSAGE = "讲义已过期，请重新生成";
const HANDOUT_STATUS_FAILED_MESSAGE = "生成失败，请检查网络后重试";
const HANDOUT_NO_DATA_MESSAGE = "当前没有可生成讲义的收藏内容";
const HANDOUT_SOURCE_PDF_MISSING_MESSAGE = "部分收藏内容暂无 PDF，暂时无法生成讲义";
const HANDOUT_TOO_FREQUENT_MESSAGE = "操作过于频繁，请稍后再试";
const HANDOUT_UNKNOWN_ERROR_MESSAGE = "生成失败，请检查网络后重试";
const HANDOUT_ERROR_CODE_MAP: Record<string, string> = {
  NO_FAVORITES: HANDOUT_NO_DATA_MESSAGE,
  HANDOUT_SOURCE_PDF_MISSING: HANDOUT_SOURCE_PDF_MISSING_MESSAGE,
  HANDOUT_REQUEST_TOO_FREQUENT: HANDOUT_TOO_FREQUENT_MESSAGE,
  HANDOUT_EXPIRED: HANDOUT_STATUS_EXPIRED_MESSAGE,
};
const HANDOUT_LIMIT_EXCEEDED_ERROR_CODES: Record<string, true> = {
  FAVORITES_LIMIT_EXCEEDED: true,
  FAVORITE_HANDOUT_LIMIT_EXCEEDED: true,
  HANDOUT_LIMIT_EXCEEDED: true,
  HANDOUT_FAVORITE_LIMIT_EXCEEDED: true,
  HANDOUT_MAX_FAVORITES_EXCEEDED: true,
  HANDOUT_TOO_MANY_FAVORITES: true,
  MAX_FAVORITES_EXCEEDED: true,
  TOO_MANY_FAVORITES: true,
};
const HANDOUT_WARNING_ERROR_CODES: Record<string, true> = {
  HANDOUT_REQUEST_TOO_FREQUENT: true,
  HANDOUT_EXPIRED: true,
};
const MODULE_LABEL_MAP: Record<string, string> = {
  function: "函数",
  trigonometry: "三角函数",
  inequality: "不等式",
  conic: "圆锥曲线",
  derivative: "导数",
};

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildFavoriteRemoveConfirmContent(title: string): string {
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) {
    return FAVORITE_REMOVE_CONFIRM_FALLBACK_CONTENT;
  }

  return `确认取消收藏「${normalizedTitle}」吗？`;
}

function normalizeDisplayTag(value: unknown): string {
  const text = normalizeText(value);
  if (!text) {
    return "";
  }

  return MODULE_LABEL_MAP[text.toLowerCase()] || text;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeErrorCode(value: unknown): string {
  return String(value || "").trim().toUpperCase();
}

function getFavoriteHandoutErrorCode(error: unknown): string {
  if (error instanceof RequestError) {
    const requestCode = normalizeErrorCode(error.code);
    if (requestCode) {
      return requestCode;
    }

    if (isPlainObject(error.data)) {
      const payloadCode = normalizeErrorCode((error.data as Record<string, unknown>).code);
      if (payloadCode) {
        return payloadCode;
      }

      const nestedError = (error.data as Record<string, unknown>).error;
      if (isPlainObject(nestedError)) {
        return normalizeErrorCode((nestedError as Record<string, unknown>).code);
      }
    }
  }

  return "";
}

function getFavoriteHandoutErrorMessageByCode(code: string): string {
  if (!code) {
    return "";
  }

  if (HANDOUT_LIMIT_EXCEEDED_ERROR_CODES[code]) {
    return HANDOUT_MAX_FAVORITES_MESSAGE;
  }

  return HANDOUT_ERROR_CODE_MAP[code] || "";
}

function isFavoriteHandoutLimitExceeded(favoriteCount: number): boolean {
  return favoriteCount > FAVORITE_HANDOUT_MAX_COUNT;
}

function isFavoriteHandoutLimitErrorCode(code: string): boolean {
  return Boolean(HANDOUT_LIMIT_EXCEEDED_ERROR_CODES[code]);
}

function isFavoriteHandoutWarningErrorCode(code: string): boolean {
  return Boolean(HANDOUT_WARNING_ERROR_CODES[code]);
}

function buildFavoriteHandoutLimitMessage(favoriteCount: number): string {
  if (!isFavoriteHandoutLimitExceeded(favoriteCount)) {
    return "";
  }

  return `${HANDOUT_MAX_FAVORITES_MESSAGE}，当前已收藏 ${favoriteCount} 条`;
}

function buildFavoriteHandoutStatusByCount(favoriteCount: number): FavoriteHandoutFeedback {
  const limitMessage = buildFavoriteHandoutLimitMessage(favoriteCount);
  if (limitMessage) {
    return {
      type: "warning",
      message: limitMessage,
    };
  }

  return {
    type: "idle",
    message: "",
  };
}

function resolveFavoriteHandoutErrorFeedback(
  code: string,
  fallbackMessage: string,
  favoriteCount: number,
): FavoriteHandoutFeedback {
  const isLimitError = isFavoriteHandoutLimitErrorCode(code);
  const limitMessage = isLimitError ? buildFavoriteHandoutLimitMessage(favoriteCount) : "";
  const mappedMessage = getFavoriteHandoutErrorMessageByCode(code);

  return {
    type: isLimitError || isFavoriteHandoutWarningErrorCode(code) ? "warning" : "error",
    message: limitMessage || mappedMessage || fallbackMessage || HANDOUT_STATUS_FAILED_MESSAGE,
  };
}

function appendTag(
  tags: string[],
  seen: Record<string, true>,
  rawTag: unknown,
  limit = CARD_TAG_LIMIT,
) {
  const tag = normalizeDisplayTag(rawTag);
  if (!tag || tags.length >= limit || seen[tag]) {
    return;
  }

  seen[tag] = true;
  tags.push(tag);
}

function resolveModuleLabel(module: unknown, moduleLabel: unknown): string {
  const normalizedLabel = normalizeDisplayTag(moduleLabel);
  const normalizedModule = normalizeText(module).toLowerCase();

  if (normalizedLabel && !MODULE_LABEL_MAP[normalizedLabel.toLowerCase()]) {
    return normalizedLabel;
  }

  if (normalizedModule && MODULE_LABEL_MAP[normalizedModule]) {
    return MODULE_LABEL_MAP[normalizedModule];
  }

  if (normalizedLabel) {
    return normalizedLabel;
  }

  return normalizeDisplayTag(module) || "数学";
}

function isLowInformationSummary(summary: string, module: string, tags: string[]): boolean {
  const normalizedSummary = normalizeText(summary);
  if (!normalizedSummary) {
    return true;
  }

  const summaryLower = normalizedSummary.toLowerCase();
  const normalizedModule = normalizeText(module).toLowerCase();
  if (normalizedModule && summaryLower === normalizedModule) {
    return true;
  }

  if (tags.some((tag) => normalizeText(tag).toLowerCase() === summaryLower)) {
    return true;
  }

  return normalizedSummary.length <= 6 && !/[，。；：,.!?]/.test(normalizedSummary);
}

function pickBestSummary(summaryCandidates: string[], module: string, tags: string[]): string {
  for (let index = 0; index < summaryCandidates.length; index += 1) {
    const summary = normalizeText(summaryCandidates[index]);
    if (!summary) {
      continue;
    }

    if (!isLowInformationSummary(summary, module, tags)) {
      return summary;
    }
  }

  for (let index = 0; index < summaryCandidates.length; index += 1) {
    const summary = normalizeText(summaryCandidates[index]);
    if (summary) {
      return summary;
    }
  }

  return "";
}

function buildFavoriteTagsFromCache(
  card: ConclusionCardCacheItem | null | undefined,
  record: FavoriteRecord,
  module: string,
): string[] {
  const tags: string[] = [];
  const seenTags: Record<string, true> = {};

  appendTag(tags, seenTags, module);
  appendTag(tags, seenTags, card?.category);
  if (Array.isArray(card?.tags)) {
    card.tags.forEach((tag) => {
      appendTag(tags, seenTags, tag);
    });
  }
  if (Array.isArray(record.tags) && tags.length <= 1) {
    record.tags.forEach((tag) => {
      appendTag(tags, seenTags, tag);
    });
  }

  return tags;
}

function mapFavoriteRecordToCard(
  record: FavoriteRecord,
  card: ConclusionCardCacheItem | null | undefined,
): FavoriteConclusionItem {
  const detailId = normalizeText(record.id);
  const module = resolveModuleLabel(
    card?.module || record.module,
    card?.category || record.moduleLabel,
  );
  const title = normalizeText(card?.title)
    || normalizeText(record.title)
    || DEFAULT_TITLE;
  const tags = buildFavoriteTagsFromCache(card, record, module);
  const summary = pickBestSummary(
    [
      normalizeText(card?.summary),
      normalizeText(record.summary),
    ],
    module,
    tags,
  ) || (tags.length > 0 ? tags.join(" / ") : DEFAULT_SUMMARY);
  const preview = buildConclusionCardPreview({
    source: card?.coreFormulaLatex,
    preferred: card,
    fallbackText: summary,
  });

  return {
    id: detailId,
    detailId,
    title,
    summary,
    tags,
    module,
    ...preview,
  };
}

function dedupeFavoriteRecords(records: FavoriteRecord[]): FavoriteRecord[] {
  const byId: Record<string, FavoriteRecord> = {};
  const order: string[] = [];

  records.forEach((record) => {
    const id = normalizeText(record.id);
    if (!id) {
      return;
    }

    if (!byId[id]) {
      order.push(id);
    }

    byId[id] = record;
  });

  return order.map((id) => byId[id]);
}

Page<FavoritesPageData, WechatMiniprogram.IAnyObject>({
  data: {
    pageStatus: "loading",
    favoriteCount: 0,
    favoriteItems: [],
    favoriteHandoutMaxCount: FAVORITE_HANDOUT_MAX_COUNT,
    handoutLimitActionText: HANDOUT_LIMIT_ACTION_TEXT,
    handoutStatusType: "idle",
    handoutStatusMessage: "",
    isGeneratingHandout: false,
    isRemovingFavorite: false,
  },

  favoritesRequestId: 0,
  hasLoadedOnce: false,

  onLoad() {
    authService.init();
    void this.refreshFavorites({
      reason: "initial",
      showLoading: true,
      silentOnError: false,
    });
  },

  onShow() {
    if (!this.hasLoadedOnce) {
      return;
    }

    void this.refreshFavorites({
      reason: "show_refresh",
      showLoading: false,
      silentOnError: true,
    });
  },

  async handleGenerateFavoriteHandoutTap() {
    if (this.data.isGeneratingHandout) {
      return;
    }

    if (this.data.pageStatus === "loading" || this.data.pageStatus === "guest") {
      return;
    }

    if (this.data.favoriteCount <= 0) {
      this.showFavoriteHandoutFeedback("warning", HANDOUT_NO_FAVORITES_MESSAGE);
      return;
    }

    if (isFavoriteHandoutLimitExceeded(this.data.favoriteCount)) {
      this.showFavoriteHandoutFeedback(
        "warning",
        buildFavoriteHandoutLimitMessage(this.data.favoriteCount),
      );
      return;
    }

    this.setData({
      isGeneratingHandout: true,
      handoutStatusType: "loading",
      handoutStatusMessage: HANDOUT_GENERATING_STATUS_MESSAGE,
    });

    try {
      const handout = await createFavoriteHandout();
      const status = handout.status;
      const responseErrorCode = normalizeErrorCode(handout.error?.code);
      const responseErrorMessage = normalizeText(handout.error?.message);

      if (responseErrorCode || responseErrorMessage) {
        const feedback = resolveFavoriteHandoutErrorFeedback(
          responseErrorCode,
          responseErrorMessage || HANDOUT_STATUS_FAILED_MESSAGE,
          this.data.favoriteCount,
        );
        this.showFavoriteHandoutFeedback(feedback.type, feedback.message);
        return;
      }

      if (status === "processing") {
        this.showFavoriteHandoutFeedback("warning", HANDOUT_STATUS_PROCESSING_MESSAGE);
        return;
      }

      if (status === "expired") {
        this.showFavoriteHandoutFeedback("warning", HANDOUT_STATUS_EXPIRED_MESSAGE);
        return;
      }

      if (status === "failed") {
        this.showFavoriteHandoutFeedback("error", HANDOUT_STATUS_FAILED_MESSAGE);
        return;
      }

      const pdfUrl = normalizeText(handout.pdfUrl);
      if (!pdfUrl) {
        this.showFavoriteHandoutFeedback("error", HANDOUT_STATUS_FAILED_MESSAGE);
        return;
      }

      this.setFavoriteHandoutStatus("loading", HANDOUT_DOWNLOADING_STATUS_MESSAGE);
      await downloadFavoriteHandoutPdf(pdfUrl, handout.filename || undefined);
      this.setFavoriteHandoutStatus("success", HANDOUT_OPEN_SUCCESS_MESSAGE);
    } catch (error) {
      if (this.isAuthRequiredError(error)) {
        this.clearFavoriteHandoutStatus();
        return;
      }

      const errorCode = getFavoriteHandoutErrorCode(error);
      const feedback = resolveFavoriteHandoutErrorFeedback(
        errorCode,
        HANDOUT_UNKNOWN_ERROR_MESSAGE,
        this.data.favoriteCount,
      );

      this.showFavoriteHandoutFeedback(feedback.type, feedback.message);

      favoritesPageLogger.warn("favorite_handout_generate_failed", {
        code: errorCode,
        message: getErrorMessage(error, HANDOUT_UNKNOWN_ERROR_MESSAGE),
        statusCode: error instanceof RequestError ? error.statusCode : undefined,
      });
    } finally {
      this.setData({
        isGeneratingHandout: false,
      });
    }
  },

  setFavoriteHandoutStatus(type: FavoriteHandoutStatusType, message: string) {
    this.setData({
      handoutStatusType: type,
      handoutStatusMessage: message,
    });
  },

  clearFavoriteHandoutStatus() {
    this.setFavoriteHandoutStatus("idle", "");
  },

  showFavoriteHandoutFeedback(type: FavoriteHandoutStatusType, message: string) {
    this.setFavoriteHandoutStatus(type, message);
    wx.showToast({
      title: message,
      icon: "none",
    });
  },

  handleRetryTap() {
    void this.refreshFavorites({
      reason: "retry",
      showLoading: true,
      silentOnError: false,
    });
  },

  handleGoSearchTap() {
    wx.switchTab({
      url: SEARCH_PAGE_URL,
      fail: () => {
        wx.reLaunch({
          url: SEARCH_PAGE_URL,
        });
      },
    });
  },

  async handleLoginTap() {
    await requireAuthAndRun(
      async () => {
        await this.refreshFavorites({
          reason: "login_success",
          showLoading: true,
          silentOnError: false,
        });
      },
      {
        title: "请先登录",
        content: "收藏的结论会保存在你的账号中",
        loginSource: "favorites",
      },
    );
  },

  handleFavoriteCardTap(event: FavoriteCardEvent) {
    const target = this.resolveFavoriteCardTarget(event);
    if (!target) {
      this.showFavoriteUnavailableToast();
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(target.detailId)}&source=${encodeURIComponent("favorites")}&entry=${encodeURIComponent("favorites_card")}`,
      fail: () => {
        wx.showToast({
          title: "详情页打开失败",
          icon: "none",
        });
      },
    });
  },

  async handleFavoriteCardLongPress(event: FavoriteCardEvent) {
    if (this.data.isRemovingFavorite) {
      return;
    }

    const target = this.resolveFavoriteCardTarget(event);
    if (!target) {
      this.showFavoriteUnavailableToast();
      return;
    }

    const shouldRemove = await this.showFavoriteRemoveActionSheet();
    if (!shouldRemove) {
      return;
    }

    const confirmed = await this.showFavoriteRemoveConfirm(target);
    if (!confirmed) {
      return;
    }

    await this.commitFavoriteRemove(target);
  },

  resolveFavoriteCardTarget(event: FavoriteCardEvent): FavoriteConclusionItem | null {
    const cardId = normalizeText(event.detail?.id);
    if (!cardId) {
      return null;
    }

    const target = this.data.favoriteItems.find((item) => item.id === cardId);
    if (!target || !target.detailId) {
      return null;
    }

    return target;
  },

  showFavoriteUnavailableToast() {
    wx.showToast({
      title: FAVORITE_CARD_UNAVAILABLE_MESSAGE,
      icon: "none",
    });
  },

  showFavoriteRemoveActionSheet(): Promise<boolean> {
    return new Promise((resolve) => {
      wx.showActionSheet({
        itemList: [FAVORITE_REMOVE_ACTION_TEXT],
        itemColor: "#d14343",
        success: (result) => {
          resolve(result.tapIndex === 0);
        },
        fail: (error) => {
          const errorMessage = normalizeText((error as { errMsg?: string })?.errMsg).toLowerCase();
          if (errorMessage.includes("cancel")) {
            resolve(false);
            return;
          }

          favoritesPageLogger.warn("favorite_remove_action_sheet_failed", {
            error,
          });
          resolve(false);
        },
      });
    });
  },

  showFavoriteRemoveConfirm(item: FavoriteConclusionItem): Promise<boolean> {
    return new Promise((resolve) => {
      wx.showModal({
        title: FAVORITE_REMOVE_CONFIRM_TITLE,
        content: buildFavoriteRemoveConfirmContent(item.title),
        confirmText: FAVORITE_REMOVE_ACTION_TEXT,
        confirmColor: "#d14343",
        success: (result) => {
          resolve(Boolean(result.confirm));
        },
        fail: (error) => {
          favoritesPageLogger.warn("favorite_remove_confirm_failed", {
            itemId: item.id,
            error,
          });
          resolve(false);
        },
      });
    });
  },

  async commitFavoriteRemove(target: FavoriteConclusionItem) {
    this.setData({
      isRemovingFavorite: true,
    });

    try {
      await removeFavorite(target.detailId);
      setCachedFavoriteState(target.detailId, false);

      const nextItems = this.data.favoriteItems.filter((item) => item.id !== target.id);
      const nextCount = nextItems.length;
      const nextStatus: FavoritesPageStatus = nextCount > 0 ? "ready" : "empty";
      const handoutStatus = buildFavoriteHandoutStatusByCount(nextCount);

      this.setData({
        favoriteItems: nextItems,
        favoriteCount: nextCount,
        pageStatus: nextStatus,
        handoutStatusType: handoutStatus.type,
        handoutStatusMessage: handoutStatus.message,
      });

      wx.showToast({
        title: FAVORITE_REMOVE_SUCCESS_MESSAGE,
        icon: "none",
      });
    } catch (error) {
      if (this.isAuthRequiredError(error)) {
        void this.refreshFavorites({
          reason: "show_refresh",
          showLoading: false,
          silentOnError: false,
        });
        return;
      }

      favoritesPageLogger.warn("favorite_remove_failed", {
        itemId: target.id,
        detailId: target.detailId,
        message: getErrorMessage(error, FAVORITE_REMOVE_FAILED_MESSAGE),
        statusCode: error instanceof RequestError ? error.statusCode : undefined,
        code: error instanceof RequestError ? error.code : undefined,
      });
      wx.showToast({
        title: FAVORITE_REMOVE_FAILED_MESSAGE,
        icon: "none",
      });
    } finally {
      this.setData({
        isRemovingFavorite: false,
      });
    }
  },

  async refreshFavorites(options: RefreshFavoritesOptions) {
    const requestId = this.createFavoritesRequestId();

    if (!authService.isAuthenticated()) {
      this.hasLoadedOnce = true;
      this.setData({
        pageStatus: "guest",
        favoriteCount: 0,
        favoriteItems: [],
        handoutStatusType: "idle",
        handoutStatusMessage: "",
      });
      return;
    }

    if (options.showLoading) {
      this.setData({
        pageStatus: "loading",
        favoriteCount: 0,
        favoriteItems: [],
        handoutStatusType: "idle",
        handoutStatusMessage: "",
      });
    }

    try {
      const records = await this.fetchAllFavoriteRecords();
      if (!this.isLatestFavoritesRequest(requestId)) {
        return;
      }

      const uniqueRecords = dedupeFavoriteRecords(records);
      syncCachedFavoriteStates(uniqueRecords.map((record) => record.id));
      const favoriteIds = uniqueRecords.map((record) => record.id);
      const resolvedCards = await resolveConclusionCards(favoriteIds);
      if (!this.isLatestFavoritesRequest(requestId)) {
        return;
      }

      const cardMap: Record<string, ConclusionCardCacheItem> = {};
      resolvedCards.items.forEach((item) => {
        cardMap[item.id] = item;
      });

      const favoriteItems = uniqueRecords.map((record) =>
        mapFavoriteRecordToCard(record, cardMap[record.id])
      );
      const favoriteCount = favoriteItems.length;
      const pageStatus: FavoritesPageStatus = favoriteCount > 0 ? "ready" : "empty";
      const handoutStatus = buildFavoriteHandoutStatusByCount(favoriteCount);

      this.hasLoadedOnce = true;
      this.setData({
        pageStatus,
        favoriteCount,
        favoriteItems,
        handoutStatusType: handoutStatus.type,
        handoutStatusMessage: handoutStatus.message,
      });

      if (pageStatus === "ready") {
        void this.prefetchFavoriteBundles(uniqueRecords);
      }
    } catch (error) {
      if (!this.isLatestFavoritesRequest(requestId)) {
        return;
      }

      const authRequired = this.isAuthRequiredError(error);
      const shouldKeepCurrentView = (
        options.silentOnError
        && !authRequired
        && (this.data.pageStatus === "ready" || this.data.pageStatus === "empty")
      );

      if (shouldKeepCurrentView) {
        favoritesPageLogger.warn("favorites_silent_refresh_failed", {
          reason: options.reason,
          message: getErrorMessage(error, "收藏刷新失败"),
          statusCode: error instanceof RequestError ? error.statusCode : undefined,
          code: error instanceof RequestError ? error.code : undefined,
        });
        return;
      }

      const nextStatus = authRequired ? "guest" : "error";
      this.hasLoadedOnce = true;
      this.setData({
        pageStatus: nextStatus,
        favoriteCount: 0,
        favoriteItems: [],
        handoutStatusType: "idle",
        handoutStatusMessage: "",
      });

      if (nextStatus === "error") {
        favoritesPageLogger.warn("favorites_load_failed", {
          reason: options.reason,
          message: getErrorMessage(error, "收藏加载失败"),
          statusCode: error instanceof RequestError ? error.statusCode : undefined,
          code: error instanceof RequestError ? error.code : undefined,
        });

        if (!options.silentOnError) {
          wx.showToast({
            title: "收藏加载失败",
            icon: "none",
          });
        }
      }
    }
  },

  async fetchAllFavoriteRecords(): Promise<FavoriteRecord[]> {
    const allRecords: FavoriteRecord[] = [];
    const seenIds: Record<string, true> = {};
    let expectedTotal: number | null = null;

    for (let page = 1; page <= FAVORITES_MAX_PAGE; page += 1) {
      const response = await getFavoritesList({
        page,
        pageSize: FAVORITES_PAGE_SIZE,
        sort: "recent",
      });

      const pageList = Array.isArray(response.list) ? response.list : [];
      const total = Number(response.total);
      if (Number.isFinite(total) && total >= 0) {
        expectedTotal = total;
      }

      let addedCount = 0;
      pageList.forEach((record) => {
        const id = normalizeText(record.id);
        if (!id || seenIds[id]) {
          return;
        }

        seenIds[id] = true;
        allRecords.push(record);
        addedCount += 1;
      });

      if (pageList.length < FAVORITES_PAGE_SIZE) {
        break;
      }

      if (expectedTotal !== null && allRecords.length >= expectedTotal) {
        break;
      }

      if (addedCount === 0) {
        break;
      }
    }

    return allRecords;
  },

  async prefetchFavoriteBundles(records: FavoriteRecord[]): Promise<void> {
    if (!Array.isArray(records) || records.length <= 0) {
      return;
    }

    const detailIds = records
      .map((record) => normalizeText(record.id))
      .filter((detailId) => Boolean(detailId))
      .slice(0, FAVORITES_PREFETCH_MAX_COUNT);

    if (detailIds.length <= 0) {
      return;
    }

    try {
      await prefetchConclusionBundlesByIds(detailIds, {
        reason: "favorites_ready",
        maxCount: FAVORITES_PREFETCH_MAX_COUNT,
      });
    } catch (error) {
      favoritesPageLogger.warn("prefetch_favorite_bundles_failed", {
        error,
      });
    }
  },

  isAuthRequiredError(error: unknown): boolean {
    if (!(error instanceof RequestError)) {
      return false;
    }

    if (error.statusCode === 401) {
      return true;
    }

    if (error.code === 401 || error.code === "401") {
      return true;
    }

    return error.code === "AUTH_REQUIRED_NO_TOKEN";
  },

  createFavoritesRequestId(): number {
    this.favoritesRequestId += 1;
    return this.favoritesRequestId;
  },

  isLatestFavoritesRequest(requestId: number): boolean {
    return requestId === this.favoritesRequestId;
  },
});
