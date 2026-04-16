import { fetchMineUserInfo } from "../../services/api/auth-api";
import { getFavoritesList } from "../../services/api/favorites-api";
import { authService } from "../../services/auth/auth-service";
import type {
  AuthLoginStage,
  AuthStatusToastType,
  AuthStatus,
  AuthUser,
  RequireAuthOptions,
} from "../../services/auth/auth-types";
import { authStore } from "../../stores/auth-store";
import type { AuthFlowErrorCategory } from "../../utils/auth/auth-login-feedback";
import {
  createLoginTraceId,
  formatLoginDebugText,
  getLoginStageText,
  isAuthDebugEnv,
  mapAuthFlowError,
} from "../../utils/auth/auth-login-feedback";
import type { AuthStatusToastState } from "../../utils/auth/auth-status-feedback";
import {
  hideAuthStatusToast,
  retryAuthStatusToast,
  showAuthStatusToast,
  subscribeAuthStatusToast,
} from "../../utils/auth/auth-status-feedback";
import { requireAuthAndRun } from "../../utils/guards/require-auth-and-run";
import { createLogger } from "../../utils/logger/logger";
import { RequestError } from "../../utils/request";

type LoginSource = NonNullable<RequireAuthOptions["loginSource"]>;

type MineRefreshTaskResult = {
  ok: boolean;
  error?: unknown;
};

type MineRefreshResult = {
  profile: MineRefreshTaskResult;
  summary: MineRefreshTaskResult;
};

type LoginRefreshOutcome = {
  stage: "success" | "partial_success";
  warningText?: string;
};

type RefreshMineDataOptions = {
  withLoginFeedback?: boolean;
  traceId?: string;
};

const mineLoginLogger = createLogger("mine-login");
const authStatusToastLogger = createLogger("auth-status-toast");

type MinePageData = {
  authStatus: AuthStatus;
  isLoggedIn: boolean;
  isLoggingIn: boolean;
  defaultAvatar: string;
  userInfo: AuthUser | null;
  favoriteCount: number;
  pointBalance: number;
  loginStage: AuthLoginStage;
  loginHintText: string;
  loginErrorText: string;
  loginWarningText: string;
  loginElapsedMs: number;
  loginDebugVisible: boolean;
  loginDebugText: string;
  loginTraceId: string;
  authStatusToastVisible: boolean;
  authStatusToastType: AuthStatusToastType;
  authStatusToastTitle: string;
  authStatusToastMessage: string;
  authStatusToastRetryable: boolean;
  authStatusToastClosable: boolean;
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
    loginStage: "idle",
    loginHintText: "",
    loginErrorText: "",
    loginWarningText: "",
    loginElapsedMs: 0,
    loginDebugVisible: false,
    loginDebugText: "",
    loginTraceId: "",
    authStatusToastVisible: false,
    authStatusToastType: "idle",
    authStatusToastTitle: "",
    authStatusToastMessage: "",
    authStatusToastRetryable: false,
    authStatusToastClosable: false,
  },

  unsubscribeAuthStore: undefined as undefined | (() => void),
  unsubscribeAuthStatusToast: undefined as undefined | (() => void),
  isLoginDebugEnv: false,
  isPageVisible: false,
  loginFlowStartedAt: 0,
  loginElapsedTimer: undefined as undefined | number,
  latestLoginErrorCategory: "" as "" | AuthFlowErrorCategory,
  latestLoginDebugMessage: "",

  onLoad() {
    this.isLoginDebugEnv = isAuthDebugEnv();
    this.setData({
      loginDebugVisible: this.isLoginDebugEnv,
    });

    authService.init();
    this.unsubscribeAuthStore = authStore.subscribe(() => {
      this.syncAuthState();
    });
    this.unsubscribeAuthStatusToast = subscribeAuthStatusToast((state) => {
      this.syncAuthStatusToast(state);
    });
  },

  onShow() {
    this.isPageVisible = true;
    this.syncAuthState();

    if (this.data.isLoggedIn) {
      void this.refreshMineData().then((result: MineRefreshResult) => {
        if (!result.profile.ok || !result.summary.ok) {
          mineLoginLogger.warn("page_show_refresh_failed", {
            profileOk: result.profile.ok,
            summaryOk: result.summary.ok,
          });
        }
      });
    }
  },

  onHide() {
    this.isPageVisible = false;
    hideAuthStatusToast("page_hide");
  },

  onUnload() {
    this.isPageVisible = false;
    this.stopLoginElapsedTimer();
    this.unsubscribeAuthStore?.();
    this.unsubscribeAuthStore = undefined;
    this.unsubscribeAuthStatusToast?.();
    this.unsubscribeAuthStatusToast = undefined;
    hideAuthStatusToast("page_unload");
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

  resetLoginFeedback() {
    this.stopLoginElapsedTimer();
    this.loginFlowStartedAt = 0;
    this.latestLoginErrorCategory = "";
    this.latestLoginDebugMessage = "";
    hideAuthStatusToast("reset_feedback");

    this.setData({
      loginStage: "idle",
      loginHintText: "",
      loginErrorText: "",
      loginWarningText: "",
      loginElapsedMs: 0,
      loginTraceId: "",
    });

    this.updateLoginDebugText("idle");
  },

  setLoginStage(
    stage: AuthLoginStage,
    extra: {
      message?: string;
      traceId?: string;
      elapsedMs?: number;
    } = {},
  ) {
    const hintText = extra.message || getLoginStageText(stage);
    const elapsedMs = typeof extra.elapsedMs === "number"
      ? extra.elapsedMs
      : this.getLoginElapsedMs();
    const traceId = extra.traceId || this.data.loginTraceId;

    this.setData({
      loginStage: stage,
      loginHintText: hintText,
      loginElapsedMs: elapsedMs,
      loginTraceId: traceId,
    });

    mineLoginLogger.info("login_stage_change", {
      traceId,
      stage,
      hintText,
      elapsedMs,
    });

    this.updateLoginDebugText(stage);

    if (this.isLoggingStage(stage)) {
      if (this.isPageVisible) {
        showAuthStatusToast({
          type: "logging",
          title: "登录中",
          message: hintText || "正在处理登录...",
          traceId,
          source: "mine",
        });
      }
    }
  },

  setLoginFailed(error: unknown) {
    const mappedError = mapAuthFlowError(error);
    this.latestLoginErrorCategory = mappedError.category;
    this.latestLoginDebugMessage = mappedError.debugMessage;

    this.setLoginStage("failed", {
      message: getLoginStageText("failed"),
    });
    this.setData({
      loginErrorText: mappedError.userMessage,
      loginWarningText: "",
    });

    mineLoginLogger.warn("login_failed", {
      traceId: this.data.loginTraceId,
      category: mappedError.category,
      debugMessage: mappedError.debugMessage,
      error,
    });

    if (mappedError.isUserCancelled) {
      if (this.isPageVisible) {
        showAuthStatusToast({
          type: "cancelled",
          title: "已取消登录",
          message: mappedError.userMessage,
          traceId: this.data.loginTraceId,
          source: "mine",
        });
      }
    } else {
      if (this.isPageVisible) {
        showAuthStatusToast({
          type: "error",
          title: "登录未完成",
          message: mappedError.userMessage,
          retryable: true,
          closable: true,
          traceId: this.data.loginTraceId,
          source: "mine",
          onRetry: () => {
            void this.performLoginFlow();
          },
        });
      }
    }

    this.updateLoginDebugText("failed");
  },

  setLoginPartialSuccess(warning: string) {
    this.latestLoginDebugMessage = warning;
    this.latestLoginErrorCategory = "";

    this.setLoginStage("partial_success", {
      message: getLoginStageText("partial_success"),
    });
    this.setData({
      loginErrorText: "",
      loginWarningText: warning,
    });

    mineLoginLogger.info("login_partial_success", {
      traceId: this.data.loginTraceId,
      warning,
      elapsedMs: this.getLoginElapsedMs(),
    });

    if (this.isPageVisible) {
      showAuthStatusToast({
        type: "warning",
        title: "登录已完成",
        message: warning,
        traceId: this.data.loginTraceId,
        source: "mine",
      });
    }

    this.updateLoginDebugText("partial_success");
  },

  setLoginSuccess() {
    this.latestLoginDebugMessage = "登录与资料同步完成";
    this.latestLoginErrorCategory = "";

    this.setLoginStage("success", {
      message: getLoginStageText("success"),
    });
    this.setData({
      loginErrorText: "",
      loginWarningText: "",
    });

    mineLoginLogger.info("login_success", {
      traceId: this.data.loginTraceId,
      elapsedMs: this.getLoginElapsedMs(),
    });

    if (this.isPageVisible) {
      showAuthStatusToast({
        type: "success",
        title: "已完成登录",
        message: "登录成功",
        traceId: this.data.loginTraceId,
        source: "mine",
      });
    }

    this.updateLoginDebugText("success");
  },

  updateLoginDebugText(stageOverride?: AuthLoginStage) {
    if (!this.isLoginDebugEnv) {
      if (this.data.loginDebugVisible || this.data.loginDebugText) {
        this.setData({
          loginDebugVisible: false,
          loginDebugText: "",
        });
      }
      return;
    }

    const debugText = formatLoginDebugText({
      traceId: this.data.loginTraceId,
      stage: stageOverride || this.data.loginStage,
      elapsedMs: this.getLoginElapsedMs(),
      errorCategory: this.latestLoginErrorCategory || undefined,
      isLoggedIn: this.data.isLoggedIn,
      favoriteCount: this.data.favoriteCount,
      debugMessage: this.latestLoginDebugMessage || undefined,
    });

    if (
      this.data.loginDebugVisible === true
      && this.data.loginDebugText === debugText
    ) {
      return;
    }

    this.setData({
      loginDebugVisible: true,
      loginDebugText: debugText,
    });
  },

  buildLoginRefreshResult(result: MineRefreshResult): LoginRefreshOutcome {
    if (result.profile.ok && result.summary.ok) {
      return {
        stage: "success",
      };
    }

    if (!result.profile.ok && !result.summary.ok) {
      return {
        stage: "partial_success",
        warningText: "已登录，个人资料与收藏统计稍后刷新",
      };
    }

    if (!result.profile.ok) {
      return {
        stage: "partial_success",
        warningText: "已登录，个人资料稍后自动刷新",
      };
    }

    return {
      stage: "partial_success",
      warningText: "已登录，收藏统计稍后刷新",
    };
  },

  async performLoginFlow() {
    if (this.data.isLoggingIn) {
      return;
    }

    this.resetLoginFeedback();

    const traceId = createLoginTraceId();
    this.loginFlowStartedAt = Date.now();
    this.setData({
      loginTraceId: traceId,
      loginElapsedMs: 0,
    });
    this.startLoginElapsedTimer();

    mineLoginLogger.info("login_tap", {
      traceId,
      isLoggedIn: this.data.isLoggedIn,
    });

    this.setLoginStage("preparing", {
      traceId,
      message: getLoginStageText("preparing"),
      elapsedMs: 0,
    });

    try {
      await authService.login({
        traceId,
        onStageChange: (payload) => {
          this.setLoginStage(payload.stage, {
            traceId: payload.traceId || traceId,
            message: payload.message || getLoginStageText(payload.stage),
          });
        },
      });

      const refreshResult = await this.refreshMineData({
        withLoginFeedback: true,
        traceId,
      });
      const refreshOutcome = this.buildLoginRefreshResult(refreshResult);

      if (refreshOutcome.stage === "success") {
        this.setLoginSuccess();
      } else {
        this.setLoginPartialSuccess(refreshOutcome.warningText || "已登录，部分数据稍后刷新");
      }

      mineLoginLogger.info("login_flow_finish", {
        traceId,
        finalStage: refreshOutcome.stage,
        elapsedMs: this.getLoginElapsedMs(),
      });
    } catch (error) {
      this.setLoginFailed(error);
      mineLoginLogger.warn("login_flow_failed", {
        traceId,
        elapsedMs: this.getLoginElapsedMs(),
        error,
      });
    } finally {
      this.stopLoginElapsedTimer();
      this.setData({
        loginElapsedMs: this.getLoginElapsedMs(),
      });
      this.updateLoginDebugText();
    }
  },

  async refreshMineData(options: RefreshMineDataOptions = {}): Promise<MineRefreshResult> {
    const result: MineRefreshResult = {
      profile: { ok: true },
      summary: { ok: true },
    };

    if (!this.data.isLoggedIn) {
      return result;
    }

    if (options.withLoginFeedback) {
      this.setLoginStage("syncing_profile", {
        traceId: options.traceId,
        message: getLoginStageText("syncing_profile"),
      });
    }

    try {
      await this.refreshUserInfo();
      result.profile = { ok: true };
    } catch (error) {
      result.profile = { ok: false, error };
    }

    if (options.withLoginFeedback) {
      this.setLoginStage("loading_summary", {
        traceId: options.traceId,
        message: getLoginStageText("loading_summary"),
      });
    }

    try {
      await this.loadMineSummary();
      result.summary = { ok: true };
    } catch (error) {
      result.summary = { ok: false, error };
    }

    return result;
  },

  async refreshUserInfo() {
    if (!this.data.isLoggedIn) {
      return;
    }

    mineLoginLogger.info("refresh_user_info_start", {
      traceId: this.data.loginTraceId,
    });

    try {
      const user = await fetchMineUserInfo();
      authService.syncUser(user);

      mineLoginLogger.info("refresh_user_info_success", {
        traceId: this.data.loginTraceId,
      });
    } catch (error) {
      if (error instanceof RequestError && error.statusCode === 401) {
        mineLoginLogger.warn("refresh_user_info_unauthorized", {
          traceId: this.data.loginTraceId,
        });
        throw error;
      }

      mineLoginLogger.warn("refresh_user_info_failed", {
        traceId: this.data.loginTraceId,
        error,
      });
      throw error;
    }
  },

  async loadMineSummary() {
    if (!this.data.isLoggedIn) {
      return;
    }

    mineLoginLogger.info("load_mine_summary_start", {
      traceId: this.data.loginTraceId,
    });

    try {
      wx.showNavigationBarLoading();
      const response = await getFavoritesList({
        page: 1,
        pageSize: 1,
      });

      this.setData({
        favoriteCount: response.total || 0,
      });

      mineLoginLogger.info("load_mine_summary_success", {
        traceId: this.data.loginTraceId,
        favoriteCount: response.total || 0,
      });
    } catch (error) {
      if (error instanceof RequestError && error.statusCode === 401) {
        mineLoginLogger.warn("load_mine_summary_unauthorized", {
          traceId: this.data.loginTraceId,
        });
        throw error;
      }

      mineLoginLogger.warn("load_mine_summary_failed", {
        traceId: this.data.loginTraceId,
        error,
      });
      throw error;
    } finally {
      wx.hideNavigationBarLoading();
    }
  },

  async handleLoginTap() {
    await this.performLoginFlow();
  },

  handleAuthStatusRetryTap() {
    authStatusToastLogger.info("mine_retry_tap", {
      traceId: this.data.loginTraceId,
    });

    const retried = retryAuthStatusToast();
    if (!retried) {
      void this.performLoginFlow();
    }
  },

  handleAuthStatusCloseTap() {
    authStatusToastLogger.info("mine_close_tap");
    hideAuthStatusToast("manual_close");
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
        this.resetLoginFeedback();
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
        loginSource: "favorites",
      },
    );
  },

  async runProtectedAction(
    reason: string,
    action: () => Promise<void> | void,
    loginSource: LoginSource = "mine_page",
  ) {
    await requireAuthAndRun(
      async () => {
        await action();
      },
      {
        title: "请先登录",
        content: reason,
        loginSource,
      },
    );
  },

  async handlePointsTap() {
    await this.runProtectedAction("登录后可查看 PDF 点数与权益", () => {
      wx.showToast({
        title: "点数页待接入",
        icon: "none",
      });
    }, "points");
  },

  async handleExportRecordsTap() {
    await this.runProtectedAction("登录后可查看导出记录", () => {
      wx.showToast({
        title: "导出记录页待接入",
        icon: "none",
      });
    }, "mine_page");
  },

  async handleShareRecordsTap() {
    await this.runProtectedAction("登录后可查看分享记录", () => {
      wx.showToast({
        title: "我的分享页待接入",
        icon: "none",
      });
    }, "mine_page");
  },

  async handleBatchExportTap() {
    await this.runProtectedAction("登录后可批量导出收藏 PDF", () => {
      wx.navigateTo({
        url: "/pages/favorites/favorites?mode=export",
      });
    }, "favorites");
  },

  async handleRewardAdTap() {
    await this.runProtectedAction("登录后可获取并记录 PDF 点数", () => {
      wx.showToast({
        title: "广告领点数待接入",
        icon: "none",
      });
    }, "points");
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

  noop() {
    return;
  },

  getLoginElapsedMs(): number {
    if (!this.loginFlowStartedAt) {
      return this.data.loginElapsedMs;
    }

    return Date.now() - this.loginFlowStartedAt;
  },

  startLoginElapsedTimer() {
    this.stopLoginElapsedTimer();
    this.loginElapsedTimer = setInterval(() => {
      const nextElapsedMs = this.getLoginElapsedMs();
      if (nextElapsedMs === this.data.loginElapsedMs) {
        return;
      }

      this.setData({
        loginElapsedMs: nextElapsedMs,
      });
      this.updateLoginDebugText();
    }, 300);
  },

  stopLoginElapsedTimer() {
    if (this.loginElapsedTimer === undefined) {
      return;
    }

    clearInterval(this.loginElapsedTimer);
    this.loginElapsedTimer = undefined;
  },

  syncAuthStatusToast(state: AuthStatusToastState) {
    this.setData({
      authStatusToastVisible: state.visible,
      authStatusToastType: state.type,
      authStatusToastTitle: state.title,
      authStatusToastMessage: state.message,
      authStatusToastRetryable: state.retryable,
      authStatusToastClosable: state.closable,
    });
  },

  isLoggingStage(stage: AuthLoginStage): boolean {
    return (
      stage === "preparing"
      || stage === "wechat_code"
      || stage === "server_sign_in"
      || stage === "session_ready"
      || stage === "syncing_profile"
      || stage === "loading_summary"
    );
  },
});
