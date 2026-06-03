import {
  clearRecentBrowse,
  getRecentBrowse,
  type RecentBrowseItem,
} from "../../services/history";
import {
  resolveConclusionCards,
  type ConclusionCardCacheItem,
} from "../../services/conclusion-card-cache";
import { createLogger } from "../../utils/logger/logger";

type CardPreviewType = "html" | "text" | "image" | "none";

type CardPreviewFields = {
  previewType: CardPreviewType;
  previewHtml: string;
  previewText: string;
  previewImage: string;
  previewImageWidth: number;
  previewImageHeight: number;
  previewFallbackText: string;
};

type RecentBrowseCardItem = {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  module: string;
  viewedAt: number;
} & CardPreviewFields;

type DetailTapEvent = {
  currentTarget?: {
    dataset?: {
      id?: string;
    };
  };
  detail?: {
    id?: string;
  };
};

interface RecentBrowsePageData {
  copy: typeof RECENT_BROWSE_COPY;
  recentBrowseList: RecentBrowseCardItem[];
  hasData: boolean;
  isLoading: boolean;
}

const RECENT_BROWSE_COPY = {
  title: "最近浏览",
  subtitle: "按浏览时间倒序展示你最近查看的内容",
  emptyTitle: "暂无浏览记录",
  emptySubtitle: "你查看过的内容会出现在这里",
  fallbackSummary: "点击查看完整内容",
  clearConfirmTitle: "清空最近浏览？",
  clearConfirmContent: "清空后将无法恢复。",
  clearConfirmButton: "清空",
  clearCancelButton: "取消",
  clearSuccessToast: "已清空浏览记录",
  clearFailedToast: "清空失败，请稍后重试",
  openDetailFailedToast: "详情页打开失败",
};
const recentBrowsePageLogger = createLogger("recent-browse-page");

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function toTimestamp(value: unknown, fallback: number): number {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    return Math.floor(value);
  }

  if (typeof value === "string") {
    const parsed = Number(value.trim());
    if (Number.isFinite(parsed) && parsed > 0) {
      return Math.floor(parsed);
    }
  }

  return fallback;
}

function normalizeStringList(value: unknown, limit = 3): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const normalized: string[] = [];
  const seen: Record<string, true> = {};

  for (let index = 0; index < value.length; index += 1) {
    const text = toTrimmedString(value[index]);
    if (!text || seen[text]) {
      continue;
    }

    seen[text] = true;
    normalized.push(text);

    if (normalized.length >= limit) {
      break;
    }
  }

  return normalized;
}

function resolveModuleLabel(module: string): string {
  if (module === "function") {
    return "函数";
  }

  if (module === "trigonometry") {
    return "三角函数";
  }

  if (module === "inequality") {
    return "不等式";
  }

  return module || "数学";
}

function normalizeRecentBrowseItem(
  item: RecentBrowseItem,
  fallbackViewedAt: number,
): RecentBrowseItem {
  return {
    id: toTrimmedString(item.id),
    title: toTrimmedString(item.title),
    module: toTrimmedString(item.module),
    summary: toTrimmedString(item.summary),
    tags: normalizeStringList(item.tags, 6),
    viewedAt: toTimestamp(item.viewedAt, fallbackViewedAt),
  };
}

function mergeRecentBrowseItem(
  current: RecentBrowseItem | undefined,
  incoming: RecentBrowseItem,
): RecentBrowseItem {
  if (!current) {
    return incoming;
  }

  if (incoming.viewedAt > current.viewedAt) {
    return incoming;
  }

  if (incoming.viewedAt < current.viewedAt) {
    return current;
  }

  return {
    ...current,
    title: current.title || incoming.title,
    module: current.module || incoming.module,
    summary: current.summary || incoming.summary,
    tags: current.tags.length > 0 ? current.tags : incoming.tags,
  };
}

function normalizeRecentBrowseList(list: RecentBrowseItem[]): RecentBrowseItem[] {
  const byId: Record<string, RecentBrowseItem> = {};

  for (let index = 0; index < list.length; index += 1) {
    const normalizedItem = normalizeRecentBrowseItem(
      list[index],
      Date.now() - index,
    );

    if (!normalizedItem.id) {
      continue;
    }

    byId[normalizedItem.id] = mergeRecentBrowseItem(
      byId[normalizedItem.id],
      normalizedItem,
    );
  }

  return Object.keys(byId)
    .map((id) => byId[id])
    .sort((left, right) => right.viewedAt - left.viewedAt);
}

function buildCardTags(card: ConclusionCardCacheItem | null | undefined): string[] {
  const tags: string[] = [];
  const seen: Record<string, true> = {};

  const appendTag = (value: unknown) => {
    const tag = toTrimmedString(value);
    if (!tag || seen[tag] || tags.length >= 3) {
      return;
    }

    seen[tag] = true;
    tags.push(tag);
  };

  appendTag(card?.category);
  if (Array.isArray(card?.tags)) {
    card.tags.forEach((tag) => {
      appendTag(tag);
    });
  }
  appendTag(resolveModuleLabel(toTrimmedString(card?.module)));

  return tags;
}

function buildEmptyPreview(): CardPreviewFields {
  return {
    previewType: "none",
    previewHtml: "",
    previewText: "",
    previewImage: "",
    previewImageWidth: 0,
    previewImageHeight: 0,
    previewFallbackText: "",
  };
}

function buildCacheCardPreview(
  card: ConclusionCardCacheItem | null | undefined,
  fallbackSummary: string,
): CardPreviewFields {
  if (!card) {
    return buildEmptyPreview();
  }

  const previewImage = toTrimmedString(card.previewImage);
  const previewFallbackText = toTrimmedString(card.previewFallbackText)
    || toTrimmedString(card.coreFormulaLatex)
    || toTrimmedString(fallbackSummary);

  if (previewImage) {
    return {
      previewType: "image",
      previewHtml: "",
      previewText: "",
      previewImage,
      previewImageWidth: card.previewImageWidth,
      previewImageHeight: card.previewImageHeight,
      previewFallbackText,
    };
  }

  const previewText = toTrimmedString(card.previewText) || toTrimmedString(card.coreFormulaLatex);
  if (previewText) {
    return {
      previewType: "text",
      previewHtml: "",
      previewText,
      previewImage: "",
      previewImageWidth: 0,
      previewImageHeight: 0,
      previewFallbackText: previewFallbackText || previewText,
    };
  }

  return buildEmptyPreview();
}

function buildRecentBrowseCard(
  item: RecentBrowseItem,
  card: ConclusionCardCacheItem | null | undefined,
): RecentBrowseCardItem {
  const title = toTrimmedString(card?.title) || item.id;
  const tags = buildCardTags(card);
  const module = resolveModuleLabel(
    toTrimmedString(card?.category) || toTrimmedString(card?.module),
  );
  const summary =
    toTrimmedString(card?.summary)
    || (tags.length > 0 ? tags.join(" / ") : RECENT_BROWSE_COPY.fallbackSummary);

  return {
    id: item.id,
    title,
    summary,
    tags,
    module,
    viewedAt: item.viewedAt,
    ...buildCacheCardPreview(card, summary),
  };
}

Page<RecentBrowsePageData, WechatMiniprogram.IAnyObject>({
  data: {
    copy: RECENT_BROWSE_COPY,
    recentBrowseList: [],
    hasData: false,
    isLoading: false,
  },

  recentBrowseRequestId: 0,

  onLoad() {
    void this.reloadRecentBrowse();
  },

  onShow() {
    void this.reloadRecentBrowse();
  },

  onPullDownRefresh() {
    void this.reloadRecentBrowse().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  async reloadRecentBrowse() {
    const requestId = this.createRecentBrowseRequestId();

    this.setData({
      isLoading: true,
    });

    try {
      const recentBrowseItems = normalizeRecentBrowseList(getRecentBrowse());
      const recentBrowseIds = recentBrowseItems.map((item) => item.id);
      const resolvedCards = await resolveConclusionCards(recentBrowseIds);
      if (!this.isLatestRecentBrowseRequest(requestId)) {
        return;
      }

      const cardMap: Record<string, ConclusionCardCacheItem> = {};
      resolvedCards.items.forEach((item) => {
        cardMap[item.id] = item;
      });

      const recentBrowseList = recentBrowseItems.map((item) =>
        buildRecentBrowseCard(item, cardMap[item.id])
      );

      this.setData({
        recentBrowseList,
        hasData: recentBrowseList.length > 0,
      });
    } catch (error) {
      if (this.isLatestRecentBrowseRequest(requestId)) {
        recentBrowsePageLogger.warn("recent_browse_cards_resolve_failed", {
          error,
        });
      }
    } finally {
      if (this.isLatestRecentBrowseRequest(requestId)) {
        this.setData({
          isLoading: false,
        });
      }
    }
  },

  handleBackTap() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    wx.switchTab({
      url: "/pages/mine/mine",
      fail: () => {
        wx.reLaunch({
          url: "/pages/mine/mine",
        });
      },
    });
  },

  handleDetailTap(event: DetailTapEvent) {
    const id = toTrimmedString(
      event.detail?.id || event.currentTarget?.dataset?.id,
    );
    if (!id) {
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}&source=${encodeURIComponent("recent")}&entry=${encodeURIComponent("recent_browse_card")}`,
      fail: () => {
        wx.showToast({
          title: RECENT_BROWSE_COPY.openDetailFailedToast,
          icon: "none",
        });
      },
    });
  },

  handleClearTap() {
    if (!this.data.hasData) {
      return;
    }

    wx.showModal({
      title: RECENT_BROWSE_COPY.clearConfirmTitle,
      content: RECENT_BROWSE_COPY.clearConfirmContent,
      confirmText: RECENT_BROWSE_COPY.clearConfirmButton,
      confirmColor: "#d14343",
      cancelText: RECENT_BROWSE_COPY.clearCancelButton,
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        try {
          clearRecentBrowse();
          this.setData({
            recentBrowseList: [],
            hasData: false,
          });

          wx.showToast({
            title: RECENT_BROWSE_COPY.clearSuccessToast,
            icon: "none",
          });
        } catch (_error) {
          wx.showToast({
            title: RECENT_BROWSE_COPY.clearFailedToast,
            icon: "none",
          });
        }
      },
    });
  },

  createRecentBrowseRequestId(): number {
    this.recentBrowseRequestId += 1;
    return this.recentBrowseRequestId;
  },

  isLatestRecentBrowseRequest(requestId: number): boolean {
    return requestId === this.recentBrowseRequestId;
  },
});
