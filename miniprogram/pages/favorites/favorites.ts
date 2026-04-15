import { getNavLayout } from "../../utils/nav";
import {
  getFavoritesList,
  removeFavorite,
  type FavoriteRecord,
} from "../../services/api/favorites-api";
import { authService } from "../../services/auth/auth-service";
import { requireAuthAndRun } from "../../utils/guards/require-auth-and-run";
import { RequestError, getErrorMessage } from "../../utils/request";

type FavoriteItem = FavoriteRecord & {
  checked?: boolean;
};

type FavoritesViewState = "auth_required" | "loading" | "empty" | "ready" | "error";

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
  viewState: FavoritesViewState;
  errorMessage: string;
  statusBarHeightPx: number;
  navBarHeightPx: number;
  navTotalHeightPx: number;
  stickyTopPx: number;
  safeBottomInsetPx: number;
}

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

function normalizeFavorite(item: FavoriteRecord): FavoriteItem {
  const module = String(item.module || "").trim() || "function";
  return {
    ...item,
    module,
    moduleLabel: item.moduleLabel || MODULE_LABEL_MAP[module] || module,
    title: String(item.title || "").trim() || "未命名结论",
    tags: Array.isArray(item.tags) ? item.tags.filter(Boolean) : [],
    summary: String(item.summary || "").trim(),
    favoritedAt: formatDateTime(String(item.favoritedAt || "")),
    pdfAvailable: Boolean(item.pdfAvailable),
    checked: false,
  };
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
    viewState: "auth_required",
    errorMessage: "",
    statusBarHeightPx: 0,
    navBarHeightPx: 44,
    navTotalHeightPx: 64,
    stickyTopPx: 76,
    safeBottomInsetPx: 0,
  },

  onLoad() {
    authService.init();
    this.setData(getNavLayout());
    void this.bootstrapPage();
  },

  onShow() {
    this.setData(getNavLayout());
    void this.bootstrapPage();
  },

  async bootstrapPage() {
    if (!authService.isAuthenticated()) {
      this.enterAuthRequiredState();
      return;
    }

    this.setData({
      isLoggedIn: true,
    });

    await this.loadFavorites();
  },

  enterAuthRequiredState() {
    this.setData({
      isLoggedIn: false,
      isLoading: false,
      isManaging: false,
      favoriteCount: 0,
      selectedCount: 0,
      lastFavoriteAt: "",
      favoriteList: [],
      filteredFavoriteList: [],
      viewState: "auth_required",
      errorMessage: "",
    });
  },

  async loadFavorites() {
    this.setData({
      isLoading: true,
      errorMessage: "",
      viewState: "loading",
    });

    try {
      const response = await getFavoritesList();
      const favoriteList = response.list.map((item) => normalizeFavorite(item));
      const favoriteCount = typeof response.total === "number"
        ? response.total
        : favoriteList.length;

      this.setData(
        {
          favoriteList,
          favoriteCount,
          lastFavoriteAt: favoriteList[0]?.favoritedAt || "",
          isManaging: false,
        },
        () => {
          this.applyFilters();

          this.setData({
            viewState: this.data.filteredFavoriteList.length ? "ready" : "empty",
          });
        },
      );
    } catch (error) {
      if (error instanceof RequestError && error.statusCode === 401) {
        this.enterAuthRequiredState();
        return;
      }

      this.setData({
        viewState: "error",
        errorMessage: getErrorMessage(error, "收藏加载失败"),
      });
    } finally {
      this.setData({ isLoading: false });
    }
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
          ...(Array.isArray(item.tags) ? item.tags : []),
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

  async handleLoginTap() {
    await requireAuthAndRun(
      async () => {
        await this.bootstrapPage();
      },
      {
        title: "请先登录",
        content: "登录后可查看和管理收藏列表",
      },
    );
  },

  handleRetryTap() {
    void this.loadFavorites();
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
        if (this.data.isLoggedIn) {
          this.setData({
            viewState: this.data.filteredFavoriteList.length ? "ready" : "empty",
          });
        }
      },
    );
  },

  handleKeywordConfirm() {
    this.applyFilters();
    if (this.data.isLoggedIn) {
      this.setData({
        viewState: this.data.filteredFavoriteList.length ? "ready" : "empty",
      });
    }
  },

  handleModuleChange(event: WechatMiniprogram.BaseEvent) {
    const module = String(event.currentTarget.dataset.module || "all");

    this.setData(
      {
        selectedModule: module,
      },
      () => {
        this.applyFilters();
        if (this.data.isLoggedIn) {
          this.setData({
            viewState: this.data.filteredFavoriteList.length ? "ready" : "empty",
          });
        }
      },
    );
  },

  handleSortChange(event: WechatMiniprogram.BaseEvent) {
    const sort = String(event.currentTarget.dataset.sort || "recent") as "recent" | "title";

    this.setData(
      {
        selectedSort: sort,
      },
      () => {
        this.applyFilters();
        if (this.data.isLoggedIn) {
          this.setData({
            viewState: this.data.filteredFavoriteList.length ? "ready" : "empty",
          });
        }
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
          title: "跳转详情失败",
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

        void this.confirmBatchRemove(selectedIds);
      },
    });
  },

  async confirmBatchRemove(selectedIds: string[]) {
    try {
      wx.showLoading({
        title: "处理中...",
        mask: true,
      });

      await Promise.all(selectedIds.map((id) => removeFavorite(id)));

      wx.showToast({
        title: "已取消收藏",
        icon: "success",
      });

      await this.loadFavorites();
    } catch (error) {
      if (error instanceof RequestError && error.statusCode === 401) {
        this.enterAuthRequiredState();
        return;
      }

      wx.showToast({
        title: getErrorMessage(error, "取消收藏失败"),
        icon: "none",
      });
    } finally {
      wx.hideLoading();
    }
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
