export const SHARE_COPY = {
  appTitle: "数秒查｜公式、结论与模型快速查询",
  appDesc: "常用公式、结论与模型，快速查询",
  detailTitleSuffix: "｜数秒查",
  detailDesc: "常用结论与模型，打开即可查看",
  copySuccessToast: "已复制，可粘贴给朋友",
  copyFailedToast: "复制失败，请稍后再试",
  fallbackConclusionTitle: "数秒查结论",
} as const;

const HOME_PATH = "/pages/search/search";
const DETAIL_PATH = "/pages/detail/detail";
const MAX_DETAIL_TITLE_LENGTH = 36;
const MAX_COPY_LENGTH = 120;
const MAX_COPY_KEYWORDS = 3;

const RESTRICTED_SHARE_TERMS = [
  "高中数学",
  "高考",
  "k12",
  "提分",
  "刷题",
  "压轴题",
  "应试",
  "名师",
  "课程",
  "培训",
  "辅导",
  "作业批改",
  "一对一",
  "押题",
  "保分",
  "冲刺",
  "学科培训",
  "教辅资料",
  "复习讲义",
  "学霸必备",
  "秒杀技巧",
  "必考模型",
] as const;

export type DetailShareSource = {
  id?: string | number | null;
  title?: string | null;
  keywords?: Array<string | number | null> | null;
};

function normalizeText(value: unknown): string {
  return String(value || "").trim();
}

function truncateText(value: string, maxLength: number): string {
  if (!value || value.length <= maxLength) {
    return value;
  }

  return `${value.slice(0, maxLength)}...`;
}

function containsRestrictedShareTerm(value: string): boolean {
  const normalized = normalizeText(value).toLowerCase();
  if (!normalized) {
    return false;
  }

  return RESTRICTED_SHARE_TERMS.some((term) => normalized.includes(term));
}

function normalizeId(value: unknown): string {
  return normalizeText(value);
}

function buildQueryString(params: Record<string, string | undefined>): string {
  const pairs = Object.keys(params)
    .map((key) => {
      const value = normalizeText(params[key]);
      if (!value) {
        return "";
      }

      return `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
    })
    .filter(Boolean);

  if (pairs.length <= 0) {
    return "";
  }

  return `?${pairs.join("&")}`;
}

function normalizeCopyKeywords(
  keywords?: Array<string | number | null> | null,
): string[] {
  if (!Array.isArray(keywords)) {
    return [];
  }

  const normalized: string[] = [];
  const seen: Record<string, true> = {};

  for (let index = 0; index < keywords.length; index += 1) {
    const rawKeyword = normalizeText(keywords[index]);
    if (!rawKeyword) {
      continue;
    }

    if (containsRestrictedShareTerm(rawKeyword)) {
      continue;
    }

    if (seen[rawKeyword]) {
      continue;
    }

    seen[rawKeyword] = true;
    normalized.push(rawKeyword);

    if (normalized.length >= MAX_COPY_KEYWORDS) {
      break;
    }
  }

  return normalized;
}

function getSafeRawDetailTitle(title?: string | null): string {
  const normalizedTitle = normalizeText(title);
  if (!normalizedTitle) {
    return "";
  }

  if (containsRestrictedShareTerm(normalizedTitle)) {
    return "";
  }

  return truncateText(normalizedTitle, MAX_DETAIL_TITLE_LENGTH);
}

export function getSafeShareTitle(title?: string | null): string {
  const safeTitle = getSafeRawDetailTitle(title);
  if (!safeTitle) {
    return SHARE_COPY.appTitle;
  }

  return `${safeTitle}${SHARE_COPY.detailTitleSuffix}`;
}

export function buildHomeSharePath(source?: string): string {
  const query = buildQueryString({
    source: normalizeText(source),
  });

  return `${HOME_PATH}${query}`;
}

export function buildDetailSharePath(id?: string | number | null, source = "share"): string {
  const normalizedId = normalizeId(id);
  if (!normalizedId) {
    return buildHomeSharePath(source);
  }

  const query = buildQueryString({
    id: normalizedId,
    source: normalizeText(source),
  });

  return `${DETAIL_PATH}${query}`;
}

export function buildHomeSharePayload(source = "share"): WechatMiniprogram.Page.ICustomShareContent {
  return {
    title: SHARE_COPY.appTitle,
    path: buildHomeSharePath(source),
  };
}

export function buildHomeTimelinePayload(): WechatMiniprogram.Page.ICustomTimelineContent {
  return {
    title: SHARE_COPY.appTitle,
    query: "source=timeline",
  };
}

export function buildDetailSharePayload(
  source: DetailShareSource,
): WechatMiniprogram.Page.ICustomShareContent {
  const id = normalizeId(source.id);
  if (!id) {
    return buildHomeSharePayload("share");
  }

  return {
    title: getSafeShareTitle(source.title),
    path: buildDetailSharePath(id, "share"),
  };
}

export function buildDetailTimelinePayload(
  source: DetailShareSource,
): WechatMiniprogram.Page.ICustomTimelineContent {
  const id = normalizeId(source.id);
  if (!id) {
    return buildHomeTimelinePayload();
  }

  return {
    title: getSafeShareTitle(source.title),
    query: `id=${encodeURIComponent(id)}&source=timeline`,
  };
}

export function buildConclusionCopyText(source: DetailShareSource): string {
  const safeTitle = getSafeRawDetailTitle(source.title) || SHARE_COPY.fallbackConclusionTitle;
  const keywords = normalizeCopyKeywords(source.keywords);

  const payload = keywords.length > 0
    ? `${safeTitle}：${keywords.join("、")}`
    : safeTitle;

  return truncateText(payload, MAX_COPY_LENGTH);
}

export function copyConclusionText(source: DetailShareSource): Promise<void> {
  const text = buildConclusionCopyText(source);

  return new Promise((resolve, reject) => {
    wx.setClipboardData({
      data: text,
      success: () => {
        resolve();
      },
      fail: (error) => {
        reject(error);
      },
    });
  });
}

export function showShareMenuSafely() {
  try {
    wx.showShareMenu({
      withShareTicket: false,
      menus: ["shareAppMessage", "shareTimeline"],
    });
    return;
  } catch (_error) {
    // Ignore unsupported menus fields in older base libraries.
  }

  try {
    wx.showShareMenu({
      withShareTicket: false,
    });
  } catch (_error) {
    // Keep silent to avoid affecting page usage.
  }
}
