import { authService } from "./services/auth/auth-service";

App<IAppOption>({
  globalData: {
    statusBarHeight: 0,
  },

  onLaunch() {
    const systemInfo = wx.getSystemInfoSync();
    this.globalData.statusBarHeight = systemInfo.statusBarHeight;
    authService.init();
  },
});
