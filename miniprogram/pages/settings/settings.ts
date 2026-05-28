type SettingsPageData = {
  saveSearchHistory: boolean;
  wifiOnlyHighResDownload: boolean;
};

Page<SettingsPageData, WechatMiniprogram.IAnyObject>({
  data: {
    saveSearchHistory: true,
    wifiOnlyHighResDownload: true,
  },

  handleSaveSearchHistoryChange(
    event: WechatMiniprogram.CustomEvent<{ value: boolean }>,
  ) {
    this.setData({
      saveSearchHistory: Boolean(event.detail.value),
    });
  },

  handleWifiOnlyHighResDownloadChange(
    event: WechatMiniprogram.CustomEvent<{ value: boolean }>,
  ) {
    this.setData({
      wifiOnlyHighResDownload: Boolean(event.detail.value),
    });
  },
});
