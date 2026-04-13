type UserInfo = {
  nickname: string;
  avatarUrl: string;
};

type MinePageData = {
  isLoggedIn: boolean;
  defaultAvatar: string;
  userInfo: UserInfo;
  favoriteCount: number;
  pointBalance: number;
};

const TOKEN_KEY = "auth_token";
const USER_KEY = "auth_user";

function getStoredToken(): string {
  return String(wx.getStorageSync(TOKEN_KEY) || "").trim();
}

function getStoredUser(): UserInfo {
  const raw = wx.getStorageSync(USER_KEY);
  if (!raw || typeof raw !== "object") {
    return {
      nickname: "",
      avatarUrl: "",
    };
  }

  return {
    nickname: String((raw as Record<string, unknown>).nickname || ""),
    avatarUrl: String((raw as Record<string, unknown>).avatarUrl || ""),
  };
}

Page<MinePageData, WechatMiniprogram.IAnyObject>({
  data: {
    isLoggedIn: false,
    defaultAvatar: "/assets/images/default-avatar.png",
    userInfo: {
      nickname: "",
      avatarUrl: "",
    },
    favoriteCount: 0,
    pointBalance: 0,
  },

  onShow() {
    this.bootstrapPage();
  },

  async bootstrapPage() {
    const token = getStoredToken();
    const isLoggedIn = Boolean(token);
    const userInfo = getStoredUser();

    this.setData({
      isLoggedIn,
      userInfo,
    });

    if (!isLoggedIn) {
      this.setData({
        favoriteCount: 0,
        pointBalance: 0,
      });
      return;
    }

    await this.loadMineSummary();
  },

  async loadMineSummary() {
    try {
      wx.showNavigationBarLoading();

      // TODO: Replace with real API integration.
      const mockFavoriteCount = 23;
      const mockPointBalance = 8;

      this.setData({
        favoriteCount: mockFavoriteCount,
        pointBalance: mockPointBalance,
      });
    } catch (error) {
      console.error("[mine] loadMineSummary failed:", error);
      wx.showToast({
        title: "加载失败，请稍后重试",
        icon: "none",
      });
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  async handleLoginTap() {
    await this.ensureLogin({
      reason: "登录后可同步收藏、点数与下载记录",
    });
  },

  async ensureLogin(options?: { reason?: string }): Promise<boolean> {
    if (this.data.isLoggedIn) {
      return true;
    }

    const reason = options?.reason || "该功能需要登录后使用";

    const confirmed = await new Promise<boolean>((resolve) => {
      wx.showModal({
        title: "请先登录",
        content: reason,
        confirmText: "立即登录",
        cancelText: "暂不登录",
        success: (res) => resolve(Boolean(res.confirm)),
        fail: () => resolve(false),
      });
    });

    if (!confirmed) {
      return false;
    }

    return this.performLogin();
  },

  async performLogin(): Promise<boolean> {
    try {
      wx.showLoading({
        title: "登录中...",
        mask: true,
      });

      // TODO: Replace with real login flow.
      const mockToken = "mock-token-u1001";
      const mockUser: UserInfo = {
        nickname: "远锋用户",
        avatarUrl: "",
      };

      wx.setStorageSync(TOKEN_KEY, mockToken);
      wx.setStorageSync(USER_KEY, mockUser);

      this.setData({
        isLoggedIn: true,
        userInfo: mockUser,
      });

      await this.loadMineSummary();

      wx.showToast({
        title: "登录成功",
        icon: "success",
      });

      return true;
    } catch (error) {
      console.error("[mine] performLogin failed:", error);
      wx.showToast({
        title: "登录失败，请稍后重试",
        icon: "none",
      });
      return false;
    } finally {
      wx.hideLoading();
    }
  },

  async handleFavoritesTap() {
    const ok = await this.ensureLogin({
      reason: "登录后可查看和同步你的收藏内容",
    });
    if (!ok) {
      return;
    }

    wx.navigateTo({
      url: "/pages/favorites/favorites",
    });
  },

  async handlePointsTap() {
    const ok = await this.ensureLogin({
      reason: "登录后可查看 PDF 点数与权益",
    });
    if (!ok) {
      return;
    }

    wx.showToast({
      title: "点数页待接入",
      icon: "none",
    });
  },

  async handleExportRecordsTap() {
    const ok = await this.ensureLogin({
      reason: "登录后可查看导出记录",
    });
    if (!ok) {
      return;
    }

    wx.showToast({
      title: "导出记录页待接入",
      icon: "none",
    });
  },

  async handleShareRecordsTap() {
    const ok = await this.ensureLogin({
      reason: "登录后可查看分享记录",
    });
    if (!ok) {
      return;
    }

    wx.showToast({
      title: "我的分享页待接入",
      icon: "none",
    });
  },

  async handleBatchExportTap() {
    const ok = await this.ensureLogin({
      reason: "登录后可批量导出收藏 PDF",
    });
    if (!ok) {
      return;
    }

    wx.navigateTo({
      url: "/pages/favorites/favorites?mode=export",
    });
  },

  async handleRewardAdTap() {
    const ok = await this.ensureLogin({
      reason: "登录后可获取并记录 PDF 点数",
    });
    if (!ok) {
      return;
    }

    wx.showToast({
      title: "广告领点数待接入",
      icon: "none",
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