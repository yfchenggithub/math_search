App<IAppOption>({
  globalData: {
    statusBarHeight: 0,
  },

  onLaunch() {
    const systemInfo = wx.getSystemInfoSync();
    this.globalData.statusBarHeight = systemInfo.statusBarHeight;

    wx.login({
      success: (res) => {
        console.log(res.code);
      },
    });
  },
});
