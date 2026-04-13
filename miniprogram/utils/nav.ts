export interface NavLayout {
  statusBarHeightPx: number;
  capsuleTopPx: number;
  capsuleHeightPx: number;
  capsuleBottomPx: number;
  sideWidthPx: number;
  navBarHeightPx: number;
  navTotalHeightPx: number;
  stickyTopPx: number;
  pageTopPaddingPx: number;
  safeBottomInsetPx: number;
  // Compatible alias for existing pages.
  headerStickyTopPx: number;
}

const IOS_NAV_MIN_HEIGHT = 44;
const ANDROID_NAV_MIN_HEIGHT = 48;
const MIN_SIDE_WIDTH = 88;
const FALLBACK_SIDE_WIDTH = 96;
const DEFAULT_PAGE_GAP_PX = 16;
const DEFAULT_STICKY_GAP_PX = 12;

type SafeAreaLike = {
  bottom?: number;
  top?: number;
};

type WindowLikeInfo = {
  statusBarHeight?: number;
  windowWidth?: number;
  screenHeight?: number;
  safeArea?: SafeAreaLike;
  platform?: string;
};

function getWindowInfoSafe(): WindowLikeInfo {
  const maybeGetWindowInfo = (wx as unknown as {
    getWindowInfo?: () => WindowLikeInfo;
  }).getWindowInfo;

  if (typeof maybeGetWindowInfo !== "function") {
    return {};
  }

  try {
    return maybeGetWindowInfo() || {};
  } catch (error) {
    console.warn("[nav] getWindowInfo failed, fallback to getSystemInfoSync", error);
    return {};
  }
}

function getMenuButtonRectSafe(): WechatMiniprogram.Rect | null {
  if (typeof wx.getMenuButtonBoundingClientRect !== "function") {
    return null;
  }

  try {
    const rect = wx.getMenuButtonBoundingClientRect();
    if (!rect || !rect.height) {
      return null;
    }
    return rect;
  } catch (error) {
    console.warn("[nav] getMenuButtonBoundingClientRect failed", error);
    return null;
  }
}

function resolveSafeBottomInsetPx(
  windowInfo: WindowLikeInfo,
  systemInfo: WechatMiniprogram.SystemInfo,
): number {
  const safeArea = windowInfo.safeArea || (systemInfo.safeArea as SafeAreaLike | undefined);
  const screenHeight = windowInfo.screenHeight || systemInfo.screenHeight || 0;

  if (!safeArea || !safeArea.bottom || !screenHeight) {
    return 0;
  }

  return Math.max(0, screenHeight - safeArea.bottom);
}

export function getNavLayout(): NavLayout {
  const systemInfo = wx.getSystemInfoSync();
  const windowInfo = getWindowInfoSafe();
  const menuButton = getMenuButtonRectSafe();

  const statusBarHeight = Math.max(
    0,
    windowInfo.statusBarHeight || systemInfo.statusBarHeight || systemInfo.safeArea?.top || 0,
  );
  const windowWidth = Math.max(0, windowInfo.windowWidth || systemInfo.windowWidth || 0);
  const platform = String(windowInfo.platform || systemInfo.platform || "").toLowerCase();
  const isAndroid = platform === "android";
  const navMinHeight = isAndroid ? ANDROID_NAV_MIN_HEIGHT : IOS_NAV_MIN_HEIGHT;

  const capsuleTop = menuButton?.top || statusBarHeight + (isAndroid ? 6 : 8);
  const capsuleHeight = menuButton?.height || 32;
  const capsuleBottom = capsuleTop + capsuleHeight;
  const capsuleGap = Math.max(capsuleTop - statusBarHeight, 6);
  const navBarHeight = Math.max(navMinHeight, capsuleHeight + capsuleGap * 2);
  const navTotalHeight = statusBarHeight + navBarHeight;
  const sideWidth = menuButton?.left
    ? Math.max(windowWidth - menuButton.left, MIN_SIDE_WIDTH)
    : FALLBACK_SIDE_WIDTH;
  const safeBottomInsetPx = resolveSafeBottomInsetPx(windowInfo, systemInfo);
  const stickyTop = navTotalHeight + DEFAULT_STICKY_GAP_PX;

  return {
    statusBarHeightPx: statusBarHeight,
    capsuleTopPx: capsuleTop,
    capsuleHeightPx: capsuleHeight,
    capsuleBottomPx: capsuleBottom,
    sideWidthPx: sideWidth,
    navBarHeightPx: navBarHeight,
    navTotalHeightPx: navTotalHeight,
    stickyTopPx: stickyTop,
    pageTopPaddingPx: navTotalHeight + DEFAULT_PAGE_GAP_PX,
    safeBottomInsetPx,
    headerStickyTopPx: stickyTop,
  };
}
