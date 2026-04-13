import { getNavLayout } from "../../utils/nav";

interface FavoriteItem {
  id: string;
  title: string;
  module: string;
  moduleLabel: string;
  tags: string[];
  summary: string;
  favoritedAt: string;
  pdfAvailable: boolean;
  checked?: boolean;
}

interface FavoritesPageData {
  isLoggedIn: boolean;
  isLoading: boolean;
  isManaging: boolean;
  keyword: string;
  selectedModule: string;
  selectedSort: "recent" | "title";
  favoriteCount: number;
  selectedCount: number;
  lastFavoriteAt: string;
  favoriteList: FavoriteItem[];
  filteredFavoriteList: FavoriteItem[];
  statusBarHeightPx: number;
  navBarHeightPx: number;
  navTotalHeightPx: number;
  stickyTopPx: number;
  safeBottomInsetPx: number;
}

const STORAGE_KEYS = {
  token: "auth_token",
  favoriteList: "favorite_list",
} as const;

const MODULE_LABEL_MAP: Record<string, string> = {
  all: "全部",
  function: "函数",
  sequence: "数列",
  inequality: "不等式",
  set: "集合",
  conic: "圆锥曲线",
  vector: "向量",
  trigonometry: "三角",
  probability: "概率统计",
  geometry: "立体几何",
};

function formatDateTime(input: string): string {
  if (!input) {
    return "";
  }

  const date = new Date(input);
  if (Number.isNaN(date.getTime())) {
    return input;
  }

  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  const hour = `${date.getHours()}`.padStart(2, "0");
  const minute = `${date.getMinutes()}`.padStart(2, "0");

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function normalizeFavorite(
  raw: Partial<FavoriteItem> & { id: string; title: string },
): FavoriteItem {
  const module = String(raw.module || "").trim() || "function";

  return {
    id: raw.id,
    title: String(raw.title || "").trim() || "未命名结论",
    module,
    moduleLabel: raw.moduleLabel || MODULE_LABEL_MAP[module] || module,
    tags: Array.isArray(raw.tags) ? raw.tags.filter(Boolean) : [],
    summary: String(raw.summary || "").trim(),
    favoritedAt: formatDateTime(String(raw.favoritedAt || "")),
    pdfAvailable: Boolean(raw.pdfAvailable),
    checked: Boolean(raw.checked),
  };
}

function getMockFavorites(): FavoriteItem[] {
  return [
    {
      id: "I022",
      title: "二元分式与不等式（倒数和 >= 4/和）",
      module: "inequality",
      moduleLabel: "不等式",
      tags: ["均值不等式", "分式", "常用结论"],
      summary: "适用于正数条件下的倒数和放缩，是高频秒杀型二级结论。",
      favoritedAt: "2026-04-13 14:30",
      pdfAvailable: true,
      checked: false,
    },
    {
      id: "F013",
      title: "函数单调性与零点个数联动判断",
      module: "function",
      moduleLabel: "函数",
      tags: ["单调性", "零点", "导数"],
      summary: "用于处理参数范围、零点个数、交点个数等综合题型。",
      favoritedAt: "2026-04-12 21:10",
      pdfAvailable: true,
      checked: false,
    },
    {
      id: "S009",
      title: "等差数列前 n 项和最值切入",
      module: "sequence",
      moduleLabel: "数列",
      tags: ["数列", "前n项和", "最值"],
      summary: "适合与二次函数、配方法联动使用，常见于压轴前两问。",
      favoritedAt: "2026-04-11 09:20",
      pdfAvailable: false,
      checked: false,
    },
  ];
}

Page<FavoritesPageData, WechatMiniprogram.IAnyObject>({
  data: {
    isLoggedIn: false,
    isLoading: false,
    isManaging: false,
    keyword: "",
    selectedModule: "all",
    selectedSort: "recent",
    favoriteCount: 0,
    selectedCount: 0,
    lastFavoriteAt: "",
    favoriteList: [],
    filteredFavoriteList: [],

    statusBarHeightPx: 0,
    navBarHeightPx: 44,
    navTotalHeightPx: 64,
    stickyTopPx: 76,
    safeBottomInsetPx: 0,
  },

  onLoad() {
    this.setData(getNavLayout());
    this.bootstrapPage();
  },

  onShow() {
    this.setData(getNavLayout());
    this.syncLoginState();
    if (this.data.isLoggedIn) {
      this.loadFavorites();
    }
  },

  bootstrapPage() {
    this.syncLoginState();
    if (!this.data.isLoggedIn) {
      return;
    }
    this.loadFavorites();
  },

  syncLoginState() {
    const token = wx.getStorageSync(STORAGE_KEYS.token);
    this.setData({
      isLoggedIn: Boolean(token),
    });
  },

  loadFavorites() {
    this.setData({ isLoading: true });

    try {
      const cached = wx.getStorageSync(STORAGE_KEYS.favoriteList);
      const sourceList =
        Array.isArray(cached) && cached.length ? cached : getMockFavorites();
      const favoriteList = sourceList.map((item) => normalizeFavorite(item));

      this.setData(
        {
          favoriteList,
          favoriteCount: favoriteList.length,
          lastFavoriteAt: favoriteList[0]?.favoritedAt || "",
        },
        () => {
          this.applyFilters();
        },
      );
    } catch (error) {
      console.error("[favorites] loadFavorites failed:", error);
      wx.showToast({
        title: "收藏加载失败",
        icon: "none",
      });
    } finally {
      this.setData({ isLoading: false });
    }
  },

  persistFavorites(nextList: FavoriteItem[]) {
    wx.setStorageSync(STORAGE_KEYS.favoriteList, nextList);
  },

  applyFilters() {
    const keyword = String(this.data.keyword || "")
      .trim()
      .toLowerCase();
    const selectedModule = this.data.selectedModule;
    const selectedSort = this.data.selectedSort;

    let list = [...this.data.favoriteList];

    if (selectedModule !== "all") {
      list = list.filter((item) => item.module === selectedModule);
    }

    if (keyword) {
      list = list.filter((item) => {
        const haystack = [
          item.title,
          item.summary,
          item.moduleLabel,
          ...item.tags,
        ]
          .join(" ")
          .toLowerCase();
        return haystack.includes(keyword);
      });
    }

    if (selectedSort === "recent") {
      list.sort((a, b) => `${b.favoritedAt}`.localeCompare(`${a.favoritedAt}`));
    } else {
      list.sort((a, b) => a.title.localeCompare(b.title, "zh-CN"));
    }

    this.setData({
      filteredFavoriteList: list,
      selectedCount: this.computeSelectedCount(this.data.favoriteList),
    });
  },

  computeSelectedCount(list: FavoriteItem[]): number {
    return list.reduce((count, item) => (item.checked ? count + 1 : count), 0);
  },

  handleBackTap() {
    const pages = getCurrentPages();
    if (pages.length > 1) {
      wx.navigateBack();
      return;
    }

    wx.switchTab({
      url: "/pages/search/search",
      fail: () => {
        wx.reLaunch({ url: "/pages/search/search" });
      },
    });
  },

  handleLoginTap() {
    wx.navigateTo({
      url: "/pages/login/login",
      fail: () => {
        wx.showToast({
          title: "请接入登录页",
          icon: "none",
        });
      },
    });
  },

  handleGoSearchTap() {
    wx.switchTab({
      url: "/pages/search/search",
      fail: () => {
        wx.navigateTo({ url: "/pages/search/search" });
      },
    });
  },

  handleKeywordInput(event: WechatMiniprogram.Input) {
    this.setData(
      {
        keyword: String(event.detail.value || ""),
      },
      () => {
        this.applyFilters();
      },
    );
  },

  handleKeywordConfirm() {
    this.applyFilters();
  },

  handleModuleChange(event: WechatMiniprogram.BaseEvent) {
    const module = String(event.currentTarget.dataset.module || "all");
    this.setData(
      {
        selectedModule: module,
      },
      () => {
        this.applyFilters();
      },
    );
  },

  handleSortChange(event: WechatMiniprogram.BaseEvent) {
    const sort = String(event.currentTarget.dataset.sort || "recent") as
      | "recent"
      | "title";
    this.setData(
      {
        selectedSort: sort,
      },
      () => {
        this.applyFilters();
      },
    );
  },

  handleManageToggleTap() {
    const nextManaging = !this.data.isManaging;
    const nextList = nextManaging
      ? this.data.favoriteList
      : this.data.favoriteList.map((item) => ({ ...item, checked: false }));

    this.setData(
      {
        isManaging: nextManaging,
        favoriteList: nextList,
      },
      () => {
        this.applyFilters();
      },
    );
  },

  handleSelectItemTap(event: WechatMiniprogram.BaseEvent) {
    const targetId = String(event.currentTarget.dataset.id || "");
    if (!targetId) {
      return;
    }

    const nextList = this.data.favoriteList.map((item) => {
      if (item.id !== targetId) {
        return item;
      }
      return {
        ...item,
        checked: !item.checked,
      };
    });

    this.setData(
      {
        favoriteList: nextList,
      },
      () => {
        this.applyFilters();
      },
    );
  },

  handleFavoriteDetailTap(event: WechatMiniprogram.BaseEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    if (!id) {
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
      fail: () => {
        wx.showToast({
          title: `跳转详情失败：${id}`,
          icon: "none",
        });
      },
    });
  },

  handleViewTap(event: WechatMiniprogram.BaseEvent) {
    this.handleFavoriteDetailTap(event);
  },

  handlePdfTap(event: WechatMiniprogram.BaseEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const current = this.data.favoriteList.find((item) => item.id === id);

    if (!current) {
      return;
    }

    if (!current.pdfAvailable) {
      wx.showToast({
        title: "该结论暂未提供 PDF",
        icon: "none",
      });
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}&openPdf=1`,
      fail: () => {
        wx.showToast({
          title: "PDF 打开失败",
          icon: "none",
        });
      },
    });
  },

  handleShareTap(event: WechatMiniprogram.BaseEvent) {
    const id = String(event.currentTarget.dataset.id || "");
    const current = this.data.favoriteList.find((item) => item.id === id);
    if (!current) {
      return;
    }

    wx.showShareMenu({
      withShareTicket: true,
      menus: ["shareAppMessage", "shareTimeline"],
    });

    wx.showToast({
      title: `可分享：${current.title}`,
      icon: "none",
    });
  },

  handleBatchExportTap() {
    const selectedList = this.data.favoriteList.filter((item) => item.checked);
    const exportList =
      this.data.isManaging && selectedList.length
        ? selectedList
        : this.data.favoriteList;

    if (!exportList.length) {
      wx.showToast({
        title: "暂无可导出的收藏",
        icon: "none",
      });
      return;
    }

    wx.showModal({
      title: "批量导出 PDF",
      content: `当前将导出 ${exportList.length} 条收藏。后续可接后端打包 PDF 能力。`,
      showCancel: false,
    });
  },

  handleBatchRemoveTap() {
    const selectedIds = this.data.favoriteList
      .filter((item) => item.checked)
      .map((item) => item.id);

    if (!selectedIds.length) {
      wx.showToast({
        title: "请先选择要取消收藏的条目",
        icon: "none",
      });
      return;
    }

    wx.showModal({
      title: "确认取消收藏",
      content: `确定取消 ${selectedIds.length} 条收藏吗？`,
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        const nextList = this.data.favoriteList.filter(
          (item) => !selectedIds.includes(item.id),
        );
        this.persistFavorites(nextList);
        this.setData(
          {
            favoriteList: nextList,
            favoriteCount: nextList.length,
            lastFavoriteAt: nextList[0]?.favoritedAt || "",
            isManaging: false,
          },
          () => {
            this.applyFilters();
          },
        );

        wx.showToast({
          title: "已取消收藏",
          icon: "success",
        });
      },
    });
  },

  onShareAppMessage() {
    return {
      title: "我收藏的高中数学二级结论",
      path: "/pages/favorites/favorites",
    };
  },

  onShareTimeline() {
    return {
      title: "我收藏的高中数学二级结论",
      query: "from=favorites",
    };
  },
});