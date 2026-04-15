import { authService } from "../../services/auth/auth-service";
import type { RequireAuthOptions } from "../../services/auth/auth-types";

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
  if (authService.isAuthenticated()) {
    return action();
  }

  const confirmed = await showLoginConfirmModal(options);
  if (!confirmed) {
    return undefined;
  }

  try {
    wx.showLoading({
      title: "登录中...",
      mask: true,
    });

    await authService.login();
    return await action();
  } catch (error) {
    wx.showToast({
      title: "登录失败，请重试",
      icon: "none",
    });
    return undefined;
  } finally {
    wx.hideLoading();
  }
}
