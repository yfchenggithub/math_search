import {
  createFavoriteHandout,
  downloadFavoriteHandoutPdf,
  getFavoritesList,
  type FavoriteRecord,
} from "../../services/api/favorites-api";
import { getRecentBrowse, type RecentBrowseItem } from "../../services/history";
import { authService } from "../../services/auth/auth-service";
import { prefetchConclusionBundlesByIds } from "../../services/conclusion-prefetch";
import {
  getDetailDocument,
  getDetailDocumentById,
  type DetailDocumentView,
} from "../../utils/detail-content";
import { getSearchDocument, initSearchEngine } from "../../utils/search-engine";
import { RequestError, getErrorMessage } from "../../utils/request";
import { requireAuthAndRun } from "../../utils/guards/require-auth-and-run";
import { createLogger } from "../../utils/logger/logger";

type FavoritesPageStatus = "loading" | "ready" | "empty" | "error" | "guest";

type FavoriteConclusionItem = {
  id: string;
  detailId: string;
  title: string;
  summary: string;
  tags: string[];
  module: string;
};

type FavoritesPageData = {
  pageStatus: FavoritesPageStatus;
  favoriteCount: number;
  favoriteItems: FavoriteConclusionItem[];
  isGeneratingHandout: boolean;
};

type FavoriteCardTapEvent = {
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
const DETAIL_HYDRATE_MAX_COUNT = 12;
const FAVORITES_PREFETCH_MAX_COUNT = 20;
const DEFAULT_TITLE = "未命名结论";
const DEFAULT_SUMMARY = "点击查看详情";
const SEARCH_PAGE_URL = "/pages/search/search";
const HANDOUT_GENERATING_LOADING_TEXT = "正在整理收藏内容";
const HANDOUT_NO_FAVORITES_MESSAGE = "收藏内容后即可生成讲义";
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

  return HANDOUT_ERROR_CODE_MAP[code] || "";
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

function buildIdCandidates(rawId: unknown): string[] {
  const id = normalizeText(rawId);
  if (!id) {
    return [];
  }

  const list: string[] = [];
  const seen: Record<string, true> = {};
  const push = (value: string) => {
    const normalized = normalizeText(value);
    if (!normalized || seen[normalized]) {
      return;
    }

    seen[normalized] = true;
    list.push(normalized);
  };

  push(id);
  push(id.toUpperCase());
  push(id.toLowerCase());

  const withoutQuery = id.split("?")[0];
  push(withoutQuery);
  push(withoutQuery.toUpperCase());
  push(withoutQuery.toLowerCase());

  const parts = withoutQuery.split(/[/:#]/).map((part) => normalizeText(part));
  const tail = parts.length > 0 ? parts[parts.length - 1] : "";
  push(tail);
  push(tail.toUpperCase());
  push(tail.toLowerCase());

  return list;
}

function resolveSearchDocumentById(rawId: unknown) {
  const idCandidates = buildIdCandidates(rawId);
  for (let index = 0; index < idCandidates.length; index += 1) {
    const doc = getSearchDocument(idCandidates[index]);
    if (doc) {
      return doc;
    }
  }

  return null;
}

function resolveLocalDetailById(rawId: unknown): DetailDocumentView | null {
  const idCandidates = buildIdCandidates(rawId);
  for (let index = 0; index < idCandidates.length; index += 1) {
    const detail = getDetailDocument(idCandidates[index]);
    if (detail) {
      return detail;
    }
  }

  return null;
}

function buildRecentBrowseLookup(list: RecentBrowseItem[]): Record<string, RecentBrowseItem> {
  const lookup: Record<string, RecentBrowseItem> = {};

  list.forEach((item) => {
    const idCandidates = buildIdCandidates(item.id);
    idCandidates.forEach((candidateId) => {
      if (!lookup[candidateId]) {
        lookup[candidateId] = item;
      }
    });
  });

  return lookup;
}

function resolveRecentBrowseById(
  lookup: Record<string, RecentBrowseItem>,
  rawId: unknown,
): RecentBrowseItem | null {
  const idCandidates = buildIdCandidates(rawId);
  for (let index = 0; index < idCandidates.length; index += 1) {
    const hit = lookup[idCandidates[index]];
    if (hit) {
      return hit;
    }
  }

  return null;
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

function mapFavoriteRecordToCard(
  record: FavoriteRecord,
  recentBrowseLookup: Record<string, RecentBrowseItem>,
): FavoriteConclusionItem {
  const detailId = normalizeText(record.id);
  const doc = resolveSearchDocumentById(detailId);
  const detail = resolveLocalDetailById(detailId);
  const recentBrowse = resolveRecentBrowseById(recentBrowseLookup, detailId);
  const module = resolveModuleLabel(record.module, record.moduleLabel);
  const title = normalizeText(recentBrowse?.title)
    || normalizeText(detail?.title)
    || normalizeText(doc?.title)
    || normalizeText(record.title)
    || DEFAULT_TITLE;
  const tags: string[] = [];
  const seenTags: Record<string, true> = {};

  appendTag(tags, seenTags, module);
  if (Array.isArray(recentBrowse?.tags)) {
    recentBrowse.tags.forEach((tag) => {
      appendTag(tags, seenTags, tag);
    });
  }
  if (Array.isArray(detail?.tags)) {
    detail.tags.forEach((tag) => {
      appendTag(tags, seenTags, tag);
    });
  }
  if (Array.isArray(record.tags)) {
    record.tags.forEach((tag) => {
      appendTag(tags, seenTags, tag);
    });
  }
  if (Array.isArray(doc?.tags)) {
    doc.tags.forEach((tag) => {
      appendTag(tags, seenTags, tag);
    });
  }
  appendTag(tags, seenTags, detail?.category);
  appendTag(tags, seenTags, doc?.category);

  const summary = pickBestSummary(
    [
      normalizeText(recentBrowse?.summary),
      normalizeText(detail?.summary),
      normalizeText(doc?.summary),
      normalizeText(record.summary),
    ],
    module,
    tags,
  ) || (tags.length > 0 ? tags.join(" / ") : DEFAULT_SUMMARY);

  return {
    id: detailId,
    detailId,
    title,
    summary,
    tags,
    module,
  };
}

function isThinCardContent(item: FavoriteConclusionItem): boolean {
  return (
    item.tags.length <= 1
    || isLowInformationSummary(item.summary, item.module, item.tags)
  );
}

function mergeCardWithDetail(
  item: FavoriteConclusionItem,
  detail: DetailDocumentView,
): FavoriteConclusionItem {
  const module = normalizeText(item.module) || normalizeDisplayTag(detail.category) || "数学";
  const tags: string[] = [];
  const seenTags: Record<string, true> = {};

  appendTag(tags, seenTags, module);
  item.tags.forEach((tag) => {
    appendTag(tags, seenTags, tag);
  });
  if (Array.isArray(detail.tags)) {
    detail.tags.forEach((tag) => {
      appendTag(tags, seenTags, tag);
    });
  }
  appendTag(tags, seenTags, detail.category);

  const title = normalizeText(detail.title) || normalizeText(item.title) || DEFAULT_TITLE;
  const summary = pickBestSummary(
    [normalizeText(detail.summary), normalizeText(item.summary)],
    module,
    tags,
  ) || (tags.length > 0 ? tags.join(" / ") : DEFAULT_SUMMARY);

  return {
    ...item,
    title,
    summary,
    tags,
    module,
  };
}

function isSameCardContent(left: FavoriteConclusionItem, right: FavoriteConclusionItem): boolean {
  if (left.id !== right.id) {
    return false;
  }

  if (left.detailId !== right.detailId) {
    return false;
  }

  if (left.title !== right.title || left.summary !== right.summary || left.module !== right.module) {
    return false;
  }

  if (left.tags.length !== right.tags.length) {
    return false;
  }

  for (let index = 0; index < left.tags.length; index += 1) {
    if (left.tags[index] !== right.tags[index]) {
      return false;
    }
  }

  return true;
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
    isGeneratingHandout: false,
  },

  favoritesRequestId: 0,
  hasLoadedOnce: false,

  onLoad() {
    authService.init();
    initSearchEngine();
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
      wx.showToast({
        title: HANDOUT_NO_FAVORITES_MESSAGE,
        icon: "none",
      });
      return;
    }

    this.setData({
      isGeneratingHandout: true,
    });
    wx.showLoading({
      title: HANDOUT_GENERATING_LOADING_TEXT,
      mask: true,
    });

    try {
      const handout = await createFavoriteHandout();
      const status = handout.status;
      const responseErrorCode = normalizeErrorCode(handout.error?.code);
      const responseErrorMessage = normalizeText(handout.error?.message);

      if (responseErrorCode || responseErrorMessage) {
        const mappedByCode = getFavoriteHandoutErrorMessageByCode(responseErrorCode);
        wx.showToast({
          title: mappedByCode || responseErrorMessage || HANDOUT_STATUS_FAILED_MESSAGE,
          icon: "none",
        });
        return;
      }

      if (status === "processing") {
        wx.showToast({
          title: HANDOUT_STATUS_PROCESSING_MESSAGE,
          icon: "none",
        });
        return;
      }

      if (status === "expired") {
        wx.showToast({
          title: HANDOUT_STATUS_EXPIRED_MESSAGE,
          icon: "none",
        });
        return;
      }

      if (status === "failed") {
        wx.showToast({
          title: HANDOUT_STATUS_FAILED_MESSAGE,
          icon: "none",
        });
        return;
      }

      const pdfUrl = normalizeText(handout.pdfUrl);
      if (!pdfUrl) {
        wx.showToast({
          title: HANDOUT_STATUS_FAILED_MESSAGE,
          icon: "none",
        });
        return;
      }

      await downloadFavoriteHandoutPdf(pdfUrl, handout.filename || undefined);
    } catch (error) {
      if (this.isAuthRequiredError(error)) {
        return;
      }

      const errorCode = getFavoriteHandoutErrorCode(error);
      const mappedMessage = getFavoriteHandoutErrorMessageByCode(errorCode);

      wx.showToast({
        title: mappedMessage || HANDOUT_UNKNOWN_ERROR_MESSAGE,
        icon: "none",
      });

      favoritesPageLogger.warn("favorite_handout_generate_failed", {
        code: errorCode,
        message: getErrorMessage(error, HANDOUT_UNKNOWN_ERROR_MESSAGE),
        statusCode: error instanceof RequestError ? error.statusCode : undefined,
      });
    } finally {
      wx.hideLoading();
      this.setData({
        isGeneratingHandout: false,
      });
    }
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

  handleFavoriteCardTap(event: FavoriteCardTapEvent) {
    const cardId = normalizeText(event.detail?.id);
    if (!cardId) {
      wx.showToast({
        title: "收藏项暂不可用",
        icon: "none",
      });
      return;
    }

    const target = this.data.favoriteItems.find((item) => item.id === cardId);
    if (!target || !target.detailId) {
      wx.showToast({
        title: "收藏项暂不可用",
        icon: "none",
      });
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

  async refreshFavorites(options: RefreshFavoritesOptions) {
    const requestId = this.createFavoritesRequestId();

    if (!authService.isAuthenticated()) {
      this.hasLoadedOnce = true;
      this.setData({
        pageStatus: "guest",
        favoriteCount: 0,
        favoriteItems: [],
      });
      return;
    }

    if (options.showLoading) {
      this.setData({
        pageStatus: "loading",
        favoriteCount: 0,
        favoriteItems: [],
      });
    }

    try {
      const records = await this.fetchAllFavoriteRecords();
      if (!this.isLatestFavoritesRequest(requestId)) {
        return;
      }

      const uniqueRecords = dedupeFavoriteRecords(records);
      const recentBrowseLookup = buildRecentBrowseLookup(getRecentBrowse());
      const favoriteItems = uniqueRecords.map((record) =>
        mapFavoriteRecordToCard(record, recentBrowseLookup)
      );
      const favoriteCount = favoriteItems.length;
      const pageStatus: FavoritesPageStatus = favoriteCount > 0 ? "ready" : "empty";

      this.hasLoadedOnce = true;
      this.setData({
        pageStatus,
        favoriteCount,
        favoriteItems,
      });

      if (pageStatus === "ready") {
        void this.prefetchFavoriteBundles(uniqueRecords);
        void this.hydrateThinFavoriteCards(requestId);
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

  async hydrateThinFavoriteCards(requestId: number) {
    if (!this.isLatestFavoritesRequest(requestId)) {
      return;
    }

    const sourceItems = this.data.favoriteItems;
    if (!Array.isArray(sourceItems) || sourceItems.length <= 0) {
      return;
    }

    const targets = sourceItems
      .map((item, index) => ({ item, index }))
      .filter(({ item }) => isThinCardContent(item))
      .slice(0, DETAIL_HYDRATE_MAX_COUNT);

    if (targets.length <= 0) {
      return;
    }

    const nextItems = sourceItems.slice();
    let hasChanged = false;

    for (let index = 0; index < targets.length; index += 1) {
      if (!this.isLatestFavoritesRequest(requestId)) {
        return;
      }

      const target = targets[index];
      const detail = await this.resolveDetailForHydration(target.item.detailId);
      if (!detail) {
        continue;
      }

      const mergedItem = mergeCardWithDetail(target.item, detail);
      if (isSameCardContent(target.item, mergedItem)) {
        continue;
      }

      nextItems[target.index] = mergedItem;
      hasChanged = true;
    }

    if (!hasChanged || !this.isLatestFavoritesRequest(requestId)) {
      return;
    }

    this.setData({
      favoriteItems: nextItems,
    });
  },

  async resolveDetailForHydration(detailId: string): Promise<DetailDocumentView | null> {
    const idCandidates = buildIdCandidates(detailId);
    if (idCandidates.length <= 0) {
      return null;
    }

    for (let index = 0; index < idCandidates.length; index += 1) {
      const localDetail = getDetailDocument(idCandidates[index]);
      if (localDetail) {
        return localDetail;
      }
    }

    for (let index = 0; index < idCandidates.length; index += 1) {
      try {
        const remoteDetail = await getDetailDocumentById(idCandidates[index]);
        if (remoteDetail) {
          return remoteDetail;
        }
      } catch (_error) {
        // Ignore single-item detail hydrate failure; keep list stable.
      }
    }

    return null;
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
