/**
 * 统一错误处理
 * 目的：
 * - 所有异常统一处理
 * - 保证用户体验一致
 */
export function handleInvalidAccess(reason: string) {
  wx.showToast({
    title: reason,
    icon: "none",
  });

  setTimeout(() => {
    wx.navigateBack({
      fail: () => {
        // 兜底：首页
        wx.switchTab({
          url: "/pages/index/index",
        });
      },
    });
  }, 1200);
}
