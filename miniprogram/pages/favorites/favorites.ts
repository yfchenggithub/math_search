type FavoritesPageData = {
  favoriteCount: number;
};

Page<FavoritesPageData, WechatMiniprogram.IAnyObject>({
  data: {
    favoriteCount: 24,
  },

  handleExportAllPdfTap() {
    wx.showToast({
      title: "功能建设中",
      icon: "none",
    });
  },
});

