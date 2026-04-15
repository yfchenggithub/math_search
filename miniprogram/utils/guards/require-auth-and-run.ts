import { authService } from "../../services/auth/auth-service";
import type { RequireAuthOptions } from "../../services/auth/auth-types";
import {
  createLoginTraceId,
  getLoginStageText,
  mapAuthFlowError,
} from "../auth/auth-login-feedback";
import {
  hasAuthStatusToastSubscriber,
  showAuthStatusToast,
} from "../auth/auth-status-feedback";
import { getErrorMessage } from "../request";

function showLoginConfirmModal(options: RequireAuthOptions): Promise<boolean> {
  return new Promise((resolve) => {
    wx.showModal({
      title: options.title || "请先登录",
      content: options.content || "该功能需要登录后使用",
      confirmText: options.confirmText || "去登录",
      cancelText: options.cancelText || "先看看",
      showCancel: options.showCancel !== false,
      success: (res) => {
        resolve(Boolean(res.confirm));
      },
      fail: () => {
        resolve(false);
      },
    });
  });
}

export async function requireAuthAndRun<T>(
  action: () => Promise<T> | T,
  options: RequireAuthOptions = {},
): Promise<T | undefined> {
  const loginSource = options.loginSource || "unknown";

  if (authService.isAuthenticated()) {
    return action();
  }

  const confirmed = await showLoginConfirmModal(options);
  if (!confirmed) {
    console.info("[auth-flow] [guard] 用户取消登录确认", {
      loginSource,
    });
    return undefined;
  }

  const traceId = createLoginTraceId();
  const hasStatusToastHost = hasAuthStatusToastSubscriber();

  try {
    if (hasStatusToastHost) {
      showAuthStatusToast({
        type: "logging",
        title: "登录中",
        message: getLoginStageText("preparing"),
        traceId,
        source: "guard",
      });
    } else {
      wx.showLoading({
        title: "正在登录...",
        mask: true,
      });
    }

    await authService.login({
      traceId,
      onStageChange: (payload) => {
        const stageText = payload.message || getLoginStageText(payload.stage);
        console.info("[auth-flow] [guard] 阶段切换", {
          traceId: payload.traceId || traceId,
          stage: payload.stage,
          message: stageText,
          loginSource,
        });

        if (!hasStatusToastHost || payload.stage === "failed") {
          return;
        }

        showAuthStatusToast({
          type: "logging",
          title: "登录中",
          message: stageText || "正在处理登录...",
          traceId: payload.traceId || traceId,
          source: "guard",
        });
      },
    });

    if (hasStatusToastHost) {
      showAuthStatusToast({
        type: "success",
        title: "已完成登录",
        message: "登录成功",
        traceId,
        source: "guard",
      });
    }
  } catch (error) {
    const mappedError = mapAuthFlowError(error);
    console.warn("[auth-flow] [guard] 登录失败", {
      traceId,
      loginSource,
      category: mappedError.category,
      debugMessage: mappedError.debugMessage,
      error,
    });

    if (hasStatusToastHost) {
      if (mappedError.isUserCancelled) {
        showAuthStatusToast({
          type: "cancelled",
          title: "已取消登录",
          message: mappedError.userMessage,
          traceId,
          source: "guard",
        });
      } else {
        showAuthStatusToast({
          type: "error",
          title: "登录未完成",
          message: mappedError.userMessage,
          retryable: true,
          closable: true,
          traceId,
          source: "guard",
          onRetry: () => {
            void requireAuthAndRun(action, options);
          },
        });
      }
    } else if (!mappedError.isUserCancelled && mappedError.shouldToast) {
      wx.showToast({
        title: mappedError.userMessage,
        icon: "none",
      });
    }

    return undefined;
  } finally {
    if (!hasStatusToastHost) {
      wx.hideLoading();
    }
  }

  try {
    return await action();
  } catch (error) {
    console.warn("[auth-flow] [guard] 已登录但受保护动作执行失败", {
      traceId,
      loginSource,
      error,
    });

    wx.showToast({
      title: getErrorMessage(error, "操作未完成，请稍后重试"),
      icon: "none",
    });

    return undefined;
  }
}
