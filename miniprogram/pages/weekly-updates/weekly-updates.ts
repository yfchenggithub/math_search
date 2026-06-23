import {
  homeRecommendWithFacade,
  type SearchViewItem,
} from "../../utils/search-engine";
import { promptWeeklyUpdateSubscription } from "../../services/weekly-update-subscription";
import { createLogger } from "../../utils/logger/logger";
import { getErrorMessage } from "../../utils/request";

type WeeklyUpdatePageStatus = "loading" | "ready" | "empty" | "error";

type WeeklyUpdateItem = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  module: string;
  updatedAt?: string | number;
  previewType: string;
  previewText: string;
  previewImage: string;
  previewImageWidth: number;
  previewImageHeight: number;
  previewFallbackText: string;
  favoriteCount: number;
  viewCount: number;
};

type WeeklyUpdateCardTapEvent = {
  detail?: {
    id?: string;
  };
};

const weeklyUpdatesLogger = createLogger("weekly-updates-page");
const WEEKLY_UPDATE_LIMIT = 12;

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed));
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) {
      return Math.floor(value);
    }

    if (value > 1e9) {
      return Math.floor(value * 1000);
    }

    return 0;
  }

  const text = normalizeText(value);
  if (!text) {
    return 0;
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return parseTimestamp(numeric);
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function compareRecentItems(left: SearchViewItem, right: SearchViewItem): number {
  const rightTime = parseTimestamp(right.updatedAt || right.createdAt);
  const leftTime = parseTimestamp(left.updatedAt || left.createdAt);
  return rightTime - leftTime;
}

function mapWeeklyUpdateItem(item: SearchViewItem): WeeklyUpdateItem | null {
  const id = normalizeText(item.id);
  if (!id) {
    return null;
  }

  const summary = normalizeText(item.summary || item.snippet);
  const moduleLabel = normalizeText(item.category || item.moduleLabel || item.module);

  return {
    id,
    title: normalizeText(item.title) || id,
    summary: summary || "查看本周新增和更新的数学结论",
    tags: Array.isArray(item.tags) ? item.tags.slice(0, 3) : [],
    module: moduleLabel || "数学",
    updatedAt: item.updatedAt || item.createdAt,
    previewType: normalizeText(item.previewType) || "none",
    previewText: normalizeText(item.previewText),
    previewImage: normalizeText(item.previewImage),
    previewImageWidth: normalizeCount(item.previewImageWidth),
    previewImageHeight: normalizeCount(item.previewImageHeight),
    previewFallbackText: normalizeText(item.previewFallbackText || item.coreFormula || summary),
    favoriteCount: normalizeCount(item.favoriteCount),
    viewCount: normalizeCount(item.viewCount),
  };
}

Page({
  data: {
    pageStatus: "loading" as WeeklyUpdatePageStatus,
    updateItems: [] as WeeklyUpdateItem[],
    updateCount: 0,
    errorMessage: "",
    subscribeActionBusy: false,
  },

  onLoad() {
    void this.loadWeeklyUpdates();
  },

  onPullDownRefresh() {
    void this.loadWeeklyUpdates().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async loadWeeklyUpdates() {
    this.setData({
      pageStatus: "loading",
      errorMessage: "",
    });

    try {
      const response = await homeRecommendWithFacade(40);
      const items = response.items
        .slice()
        .sort(compareRecentItems)
        .map((item) => mapWeeklyUpdateItem(item))
        .filter((item): item is WeeklyUpdateItem => Boolean(item))
        .slice(0, WEEKLY_UPDATE_LIMIT);

      this.setData({
        pageStatus: items.length > 0 ? "ready" : "empty",
        updateItems: items,
        updateCount: items.length,
        errorMessage: "",
      });
    } catch (error) {
      weeklyUpdatesLogger.warn("load_weekly_updates_failed", {
        error,
      });
      this.setData({
        pageStatus: "error",
        updateItems: [],
        updateCount: 0,
        errorMessage: getErrorMessage(error, "本周更新加载失败，请稍后重试"),
      });
    }
  },

  async onSubscribeTap() {
    if (this.data.subscribeActionBusy) {
      return;
    }

    this.setData({
      subscribeActionBusy: true,
    });

    try {
      await promptWeeklyUpdateSubscription({
        source: "weekly_updates_page",
        force: true,
      });
    } finally {
      this.setData({
        subscribeActionBusy: false,
      });
    }
  },

  onRetryTap() {
    void this.loadWeeklyUpdates();
  },

  onGoHomeTap() {
    wx.switchTab({
      url: "/pages/search/search",
      fail: (error) => {
        weeklyUpdatesLogger.warn("go_home_switch_tab_failed", {
          error,
        });
        wx.reLaunch({
          url: "/pages/search/search",
        });
      },
    });
  },

  onCardTap(event: WeeklyUpdateCardTapEvent) {
    const id = normalizeText(event.detail?.id);
    if (!id) {
      wx.showToast({
        title: "暂时无法打开详情",
        icon: "none",
      });
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}&source=weekly_updates&entry=weekly_update_card`,
    });
  },
});
