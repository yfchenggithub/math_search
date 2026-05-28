import {
  DEFAULT_SETTINGS,
  getFontSizeText,
  getSettings,
  updateSettings,
  type AppSettings,
  type SettingsFontSize,
} from "../../services/settings";
import {
  clearRecentBrowse,
  clearSearchHistory,
} from "../../services/history";
import {
  clearAppCache,
  getCacheSize,
} from "../../services/cache";
import { createLogger } from "../../utils/logger/logger";

type SettingsPageData = {
  fontSize: SettingsFontSize;
  fontSizeLabel: string;
  saveSearchHistory: boolean;
  wifiOnlyDownload: boolean;
  localCacheSizeText: string;
};

const settingsPageLogger = createLogger("settings-page");

Page<SettingsPageData, WechatMiniprogram.IAnyObject>({
  data: {
    fontSize: DEFAULT_SETTINGS.fontSize,
    fontSizeLabel: getFontSizeText(DEFAULT_SETTINGS.fontSize),
    saveSearchHistory: DEFAULT_SETTINGS.saveSearchHistory,
    wifiOnlyDownload: DEFAULT_SETTINGS.wifiOnlyDownload,
    localCacheSizeText: "计算中",
  },

  currentSettings: { ...DEFAULT_SETTINGS } as AppSettings,
  cacheSizeRequestId: 0,

  onLoad() {
    this.hydrateSettings();
  },

  onShow() {
    this.hydrateSettings();
    void this.refreshLocalCacheSize();
  },

  hydrateSettings() {
    const settings = getSettings();
    this.applySettingsToView(settings);
  },

  applySettingsToView(settings: AppSettings) {
    this.currentSettings = {
      ...settings,
    };

    this.setData({
      fontSize: settings.fontSize,
      fontSizeLabel: getFontSizeText(settings.fontSize),
      saveSearchHistory: settings.saveSearchHistory,
      wifiOnlyDownload: settings.wifiOnlyDownload,
    });
  },

  persistSettingsPatch(patch: Partial<AppSettings>) {
    const previousSettings: AppSettings = {
      ...this.currentSettings,
    };

    this.applySettingsToView({
      ...previousSettings,
      ...patch,
    });

    try {
      const nextSettings = updateSettings(patch);
      this.applySettingsToView(nextSettings);

      wx.showToast({
        title: "已保存",
        icon: "none",
      });
    } catch (error) {
      settingsPageLogger.warn("update_settings_failed", {
        fields: Object.keys(patch),
        error,
      });

      this.applySettingsToView(previousSettings);
      wx.showToast({
        title: "保存失败，请稍后重试",
        icon: "none",
      });
    }
  },

  handleSaveSearchHistoryChange(
    event: WechatMiniprogram.CustomEvent<{ value: boolean }>,
  ) {
    const nextValue = Boolean(event.detail.value);
    if (nextValue === this.currentSettings.saveSearchHistory) {
      return;
    }

    this.persistSettingsPatch({
      saveSearchHistory: nextValue,
    });
  },

  handleWifiOnlyDownloadChange(
    event: WechatMiniprogram.CustomEvent<{ value: boolean }>,
  ) {
    const nextValue = Boolean(event.detail.value);
    if (nextValue === this.currentSettings.wifiOnlyDownload) {
      return;
    }

    this.persistSettingsPatch({
      wifiOnlyDownload: nextValue,
    });
  },

  handleFontSizeTap() {
    const itemList = ["标准", "较大"];
    const currentIndex = this.currentSettings.fontSize === "large" ? 1 : 0;

    wx.showActionSheet({
      itemList,
      success: (result) => {
        const nextFontSize: SettingsFontSize = result.tapIndex === 1 ? "large" : "standard";

        if (result.tapIndex === currentIndex || nextFontSize === this.currentSettings.fontSize) {
          return;
        }

        this.persistSettingsPatch({
          fontSize: nextFontSize,
        });
      },
      fail: (error) => {
        const errorMessage = String((error as { errMsg?: string })?.errMsg || "");
        if (errorMessage.includes("cancel")) {
          return;
        }

        settingsPageLogger.warn("font_size_action_sheet_failed", {
          error,
        });
      },
    });
  },

  handleClearSearchHistoryTap() {
    wx.showModal({
      title: "清空搜索记录",
      content: "清空后不可恢复，不会影响收藏内容。",
      confirmText: "清空",
      cancelText: "取消",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        try {
          clearSearchHistory();
          wx.showToast({
            title: "已清空搜索记录",
            icon: "none",
          });
        } catch (error) {
          settingsPageLogger.warn("clear_search_history_failed", {
            error,
          });
          wx.showToast({
            title: "清空失败，请稍后重试",
            icon: "none",
          });
        }
      },
      fail: (error) => {
        settingsPageLogger.warn("clear_search_history_confirm_failed", {
          error,
        });
      },
    });
  },

  handleClearRecentBrowseTap() {
    wx.showModal({
      title: "清空最近浏览",
      content: "清空后不可恢复，不会影响收藏内容。",
      confirmText: "清空",
      cancelText: "取消",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        try {
          clearRecentBrowse();
          wx.showToast({
            title: "已清空最近浏览",
            icon: "none",
          });
        } catch (error) {
          settingsPageLogger.warn("clear_recent_browse_failed", {
            error,
          });
          wx.showToast({
            title: "清空失败，请稍后重试",
            icon: "none",
          });
        }
      },
      fail: (error) => {
        settingsPageLogger.warn("clear_recent_browse_confirm_failed", {
          error,
        });
      },
    });
  },

  async refreshLocalCacheSize() {
    const requestId = Date.now();
    this.cacheSizeRequestId = requestId;

    this.setData({
      localCacheSizeText: "计算中",
    });

    try {
      const cacheSize = await getCacheSize();
      if (this.cacheSizeRequestId !== requestId) {
        return;
      }

      this.setData({
        localCacheSizeText: cacheSize.displayText,
      });
    } catch (error) {
      settingsPageLogger.warn("refresh_local_cache_size_failed", {
        error,
      });

      if (this.cacheSizeRequestId !== requestId) {
        return;
      }

      this.setData({
        localCacheSizeText: "--",
      });
    }
  },

  handleClearLocalCacheTap() {
    wx.showModal({
      title: "清理本地缓存",
      content: "将清理可重新下载或重新生成的本地缓存，不会影响收藏、登录状态和浏览记录。",
      confirmText: "清理",
      cancelText: "取消",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        void this.confirmClearLocalCache();
      },
      fail: (error) => {
        settingsPageLogger.warn("clear_local_cache_confirm_failed", {
          error,
        });
      },
    });
  },

  async confirmClearLocalCache() {
    let clearSucceeded = false;

    wx.showLoading({
      title: "正在清理",
      mask: true,
    });

    try {
      const result = await clearAppCache();
      clearSucceeded = result.success;

      if (!clearSucceeded) {
        settingsPageLogger.warn("clear_local_cache_failed", {
          result,
        });
      }
    } catch (error) {
      settingsPageLogger.warn("clear_local_cache_exception", {
        error,
      });
      clearSucceeded = false;
    } finally {
      wx.hideLoading();
    }

    if (clearSucceeded) {
      wx.showToast({
        title: "已清理缓存",
        icon: "none",
      });
    } else {
      wx.showToast({
        title: "清理失败，请稍后重试",
        icon: "none",
      });
    }

    void this.refreshLocalCacheSize();
  },
});
