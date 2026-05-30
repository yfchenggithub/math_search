import {
  getFavoritesList,
  type FavoriteRecord,
} from "../../services/api/favorites-api";
import { authService } from "../../services/auth/auth-service";
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
const DEFAULT_TITLE = "未命名结论";
const DEFAULT_SUMMARY = "点击查看详情";
const SEARCH_PAGE_URL = "/pages/search/search";

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function appendTag(
  tags: string[],
  seen: Record<string, true>,
  rawTag: unknown,
  limit = CARD_TAG_LIMIT,
) {
  const tag = normalizeText(rawTag);
  if (!tag || tags.length >= limit || seen[tag]) {
    return;
  }

  seen[tag] = true;
  tags.push(tag);
}

function mapFavoriteRecordToCard(record: FavoriteRecord): FavoriteConclusionItem {
  const detailId = normalizeText(record.id);
  const module = normalizeText(record.moduleLabel || record.module) || "数学";
  const title = normalizeText(record.title) || DEFAULT_TITLE;
  const tags: string[] = [];
  const seenTags: Record<string, true> = {};

  appendTag(tags, seenTags, module);
  if (Array.isArray(record.tags)) {
    record.tags.forEach((tag) => {
      appendTag(tags, seenTags, tag);
    });
  }

  const summary = normalizeText(record.summary)
    || (tags.length > 0 ? tags.join(" / ") : DEFAULT_SUMMARY);

  return {
    id: detailId,
    detailId,
    title,
    summary,
    tags,
    module,
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

  handleExportAllPdfTap() {
    wx.showToast({
      title: "功能建设中",
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
      const favoriteItems = uniqueRecords.map((record) =>
        mapFavoriteRecordToCard(record)
      );
      const favoriteCount = favoriteItems.length;
      const pageStatus: FavoritesPageStatus = favoriteCount > 0 ? "ready" : "empty";

      this.hasLoadedOnce = true;
      this.setData({
        pageStatus,
        favoriteCount,
        favoriteItems,
      });
    } catch (error) {
      if (!this.isLatestFavoritesRequest(requestId)) {
        return;
      }

      const nextStatus = this.isAuthRequiredError(error) ? "guest" : "error";
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

