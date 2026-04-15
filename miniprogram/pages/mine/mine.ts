import { fetchMineUserInfo } from "../../services/api/auth-api";
import { getFavoritesList } from "../../services/api/favorites-api";
import { authService } from "../../services/auth/auth-service";
import type { AuthStatus, AuthUser } from "../../services/auth/auth-types";
import { authStore } from "../../stores/auth-store";
import { requireAuthAndRun } from "../../utils/guards/require-auth-and-run";
import { getErrorMessage, RequestError } from "../../utils/request";

type MinePageData = {
  authStatus: AuthStatus;
  isLoggedIn: boolean;
  isLoggingIn: boolean;
  defaultAvatar: string;
  userInfo: AuthUser | null;
  favoriteCount: number;
  pointBalance: number;
};

Page<MinePageData, WechatMiniprogram.IAnyObject>({
  data: {
    authStatus: "visitor",
    isLoggedIn: false,
    isLoggingIn: false,
    defaultAvatar: "/assets/images/default-avatar.png",
    userInfo: null,
    favoriteCount: 0,
    pointBalance: 0,
  },

  unsubscribeAuthStore: undefined as undefined | (() => void),

  onLoad() {
    authService.init();

    this.unsubscribeAuthStore = authStore.subscribe(() => {
      this.syncAuthState();
    });
  },

  onShow() {
    this.syncAuthState();

    if (this.data.isLoggedIn) {
      void this.refreshMineData();
    }
  },

  onUnload() {
    this.unsubscribeAuthStore?.();
    this.unsubscribeAuthStore = undefined;
  },

  syncAuthState() {
    const state = authStore.getState();
    const isLoggedIn = state.status === "authenticated";
    const userInfo = isLoggedIn
      ? (state.user || {
        id: "",
        nickname: "微信用户",
        avatarUrl: "",
      })
      : null;

    this.setData({
      authStatus: state.status,
      isLoggedIn,
      isLoggingIn: state.status === "logging_in",
      userInfo,
    });

    if (!isLoggedIn) {
      this.setData({
        favoriteCount: 0,
        pointBalance: 0,
      });
    }
  },

  async refreshMineData() {
    await Promise.allSettled([
      this.refreshUserInfo(),
      this.loadMineSummary(),
    ]);
  },

  async refreshUserInfo() {
    if (!this.data.isLoggedIn) {
      return;
    }

    try {
      const user = await fetchMineUserInfo();
      authService.syncUser(user);
    } catch (error) {
      if (error instanceof RequestError && error.statusCode === 401) {
        return;
      }

      console.warn("[mine] refreshUserInfo failed:", error);
    }
  },

  async loadMineSummary() {
    if (!this.data.isLoggedIn) {
      return;
    }

    try {
      wx.showNavigationBarLoading();
      const response = await getFavoritesList({
        page: 1,
        pageSize: 1,
      });

      this.setData({
        favoriteCount: response.total || 0,
      });
    } catch (error) {
      if (error instanceof RequestError && error.statusCode === 401) {
        return;
      }

      wx.showToast({
        title: getErrorMessage(error, "加载失败，请稍后重试"),
        icon: "none",
      });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  async handleLoginTap() {
    if (this.data.isLoggingIn) {
      return;
    }

    try {
      wx.showLoading({
        title: "登录中...",
        mask: true,
      });

      await authService.login();
      await this.refreshMineData();

      wx.showToast({
        title: "登录成功",
        icon: "success",
      });
    } catch (error) {
      wx.showToast({
        title: getErrorMessage(error, "登录失败，请重试"),
        icon: "none",
      });
    } finally {
      wx.hideLoading();
    }
  },

  handleLogoutTap() {
    wx.showModal({
      title: "退出登录",
      content: "退出后仍可匿名使用搜索、建议、详情和 PDF 浏览。",
      confirmText: "退出",
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        authService.logout();
        wx.showToast({
          title: "已退出登录",
          icon: "none",
        });
      },
    });
  },

  async handleFavoritesTap() {
    await requireAuthAndRun(
      () => new Promise<void>((resolve, reject) => {
        wx.navigateTo({
          url: "/pages/favorites/favorites",
          success: () => resolve(),
          fail: (error) => reject(error),
        });
      }),
      {
        title: "请先登录",
        content: "登录后可查看和管理收藏列表",
      },
    );
  },

  async runProtectedAction(
    reason: string,
    action: () => Promise<void> | void,
  ) {
    await requireAuthAndRun(
      async () => {
        await action();
      },
      {
        title: "请先登录",
        content: reason,
      },
    );
  },

  async handlePointsTap() {
    await this.runProtectedAction("登录后可查看 PDF 点数与权益", () => {
      wx.showToast({
        title: "点数页待接入",
        icon: "none",
      });
    });
  },

  async handleExportRecordsTap() {
    await this.runProtectedAction("登录后可查看导出记录", () => {
      wx.showToast({
        title: "导出记录页待接入",
        icon: "none",
      });
    });
  },

  async handleShareRecordsTap() {
    await this.runProtectedAction("登录后可查看分享记录", () => {
      wx.showToast({
        title: "我的分享页待接入",
        icon: "none",
      });
    });
  },

  async handleBatchExportTap() {
    await this.runProtectedAction("登录后可批量导出收藏 PDF", () => {
      wx.navigateTo({
        url: "/pages/favorites/favorites?mode=export",
      });
    });
  },

  async handleRewardAdTap() {
    await this.runProtectedAction("登录后可获取并记录 PDF 点数", () => {
      wx.showToast({
        title: "广告领点数待接入",
        icon: "none",
      });
    });
  },

  handleHistoryTap() {
    wx.showToast({
      title: "最近浏览页待接入",
      icon: "none",
    });
  },

  handleFeedbackTap() {
    wx.showToast({
      title: "反馈页待接入",
      icon: "none",
    });
  },

  handleSettingsTap() {
    wx.showToast({
      title: "设置页待接入",
      icon: "none",
    });
  },

  handleUserAgreementTap() {
    wx.showToast({
      title: "用户协议页待接入",
      icon: "none",
    });
  },

  handlePrivacyTap() {
    wx.showToast({
      title: "隐私政策页待接入",
      icon: "none",
    });
  },
});
