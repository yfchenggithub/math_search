import { authService } from "./services/auth/auth-service";
import { createLogger } from "./utils/logger/logger";

const appLogger = createLogger("app");

App<IAppOption>({
  globalData: {
    statusBarHeight: 0,
  },

  onLaunch() {
    const systemInfo = wx.getSystemInfoSync();
    this.globalData.statusBarHeight = systemInfo.statusBarHeight;
    authService.init();
  },

  onError(error: string) {
    appLogger.error("app_error", {
      error,
    });
  },

  onUnhandledRejection(result: WechatMiniprogram.OnUnhandledRejectionCallbackResult) {
    appLogger.error("app_unhandled_rejection", {
      reason: result.reason,
    });
  },

  onPageNotFound(options: WechatMiniprogram.App.PageNotFoundOption) {
    appLogger.warn("app_page_not_found", {
      path: options.path,
      query: options.query,
      isEntryPage: options.isEntryPage,
    });
  },
});
