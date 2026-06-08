import { getFormulaImageScale } from "../../services/settings";

type ConclusionCardEventDetail = {
  id: string;
  entry: string;
  section: string;
  title: string;
  module: string;
  hasPdf: boolean;
};

const DEFAULT_PREVIEW_IMAGE_WIDTH_PX = 160;
const MAX_PREVIEW_IMAGE_WIDTH_PX = 288;
const MAX_PREVIEW_IMAGE_HEIGHT_PX = 118;
const DESIGN_RPX_PER_PX = 2;
const UPDATED_AT_PREFIX = "\u66f4\u65b0\u65f6\u95f4\uff1a";
const FAVORITE_ICON_TEXT = "\u2661";
const VIEW_ICON_TEXT = "\u25ce";
const VIEW_COUNT_PREFIX = "\u6d4f\u89c8\uff1a";

function normalizeDimension(value: unknown): number {
  const numberValue = Number(value);
  return Number.isFinite(numberValue) && numberValue > 0
    ? Math.round(numberValue)
    : 0;
}

function buildPreviewImageStyle(widthValue: unknown, heightValue: unknown): string {
  let width = normalizeDimension(widthValue);
  const height = normalizeDimension(heightValue);

  if (width <= 0) {
    width = DEFAULT_PREVIEW_IMAGE_WIDTH_PX;
  }

  let scale = 1;
  if (width > MAX_PREVIEW_IMAGE_WIDTH_PX) {
    scale = Math.min(scale, MAX_PREVIEW_IMAGE_WIDTH_PX / width);
  }

  if (height > MAX_PREVIEW_IMAGE_HEIGHT_PX) {
    scale = Math.min(scale, MAX_PREVIEW_IMAGE_HEIGHT_PX / height);
  }

  if (scale < 1) {
    width = Math.max(1, Math.round(width * scale));
  }

  return `width: ${Math.max(1, Math.round(width * DESIGN_RPX_PER_PX * getFormulaImageScale()))}rpx;`;
}

function padDatePart(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

function parseTimestamp(value: unknown): number {
  if (typeof value === "number" && Number.isFinite(value)) {
    if (value > 1e12) {
      return Math.floor(value);
    }

    if (value > 1e9) {
      return Math.floor(value * 1000);
    }

    return 0;
  }

  const text = String(value || "").trim();
  if (!text) {
    return 0;
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric)) {
    return parseTimestamp(numeric);
  }

  const parsed = Date.parse(text);
  return Number.isFinite(parsed) ? parsed : 0;
}

function formatUpdatedAt(value: unknown): string {
  const timestamp = parseTimestamp(value);
  if (timestamp <= 0) {
    return "";
  }

  const date = new Date(timestamp);
  if (!Number.isFinite(date.getTime())) {
    return "";
  }

  const year = date.getFullYear();
  const month = padDatePart(date.getMonth() + 1);
  const day = padDatePart(date.getDate());
  const hour = padDatePart(date.getHours());
  const minute = padDatePart(date.getMinutes());

  return `${UPDATED_AT_PREFIX} ${year}-${month}-${day} ${hour}:${minute}`;
}

function normalizeCount(value: unknown): number {
  const parsed = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(parsed)) {
    return 0;
  }

  return Math.max(0, Math.round(parsed));
}

function trimCompactCount(value: number): string {
  return value.toFixed(1).replace(/\.0$/, "");
}

function formatCount(value: unknown): string {
  const count = normalizeCount(value);
  if (count < 1000) {
    return String(count);
  }

  if (count < 1000000) {
    return `${trimCompactCount(count / 1000)}k`;
  }

  return `${trimCompactCount(count / 1000000)}m`;
}

Component({
  properties: {
    itemId: {
      type: String,
      value: "",
    },
    title: {
      type: String,
      value: "",
    },
    titleSegments: {
      type: Array,
      value: [],
    },
    summary: {
      type: String,
      value: "",
    },
    tags: {
      type: Array,
      value: [],
    },
    actionText: {
      type: String,
      value: "查看详情",
    },
    entry: {
      type: String,
      value: "",
    },
    section: {
      type: String,
      value: "",
    },
    module: {
      type: String,
      value: "",
    },
    hasPdf: {
      type: Boolean,
      value: false,
    },
    compact: {
      type: Boolean,
      value: false,
    },
    showTags: {
      type: Boolean,
      value: true,
    },
    previewType: {
      type: String,
      value: "none",
    },
    previewHtml: {
      type: String,
      value: "",
    },
    previewText: {
      type: String,
      value: "",
    },
    previewImage: {
      type: String,
      value: "",
    },
    previewImageWidth: {
      type: Number,
      value: 0,
    },
    previewImageHeight: {
      type: Number,
      value: 0,
    },
    previewFallbackText: {
      type: String,
      value: "",
    },
    updatedAt: {
      type: null,
      value: "",
    },
    favoriteCount: {
      type: Number,
      value: 0,
    },
    viewCount: {
      type: Number,
      value: 0,
    },
  },

  data: {
    previewImageLoadFailed: false,
    previewImageStyle: buildPreviewImageStyle(0, 0),
    updatedAtText: "",
    favoriteIconText: FAVORITE_ICON_TEXT,
    viewIconText: VIEW_ICON_TEXT,
    viewCountPrefix: VIEW_COUNT_PREFIX,
    favoriteCountText: "0",
    viewCountText: "0",
  },

  observers: {
    "previewType, previewImage, previewImageWidth, previewImageHeight"() {
      this.syncPreviewImageStyle();

      if (this.data.previewImageLoadFailed) {
        this.setData({
          previewImageLoadFailed: false,
        });
      }
    },
    updatedAt(value: unknown) {
      this.setData({
        updatedAtText: formatUpdatedAt(value),
      });
    },
    "favoriteCount, viewCount"() {
      this.setData({
        favoriteCountText: formatCount(this.data.favoriteCount),
        viewCountText: formatCount(this.data.viewCount),
      });
    },
  },

  pageLifetimes: {
    show() {
      this.syncPreviewImageStyle();
    },
  },

  methods: {
    syncPreviewImageStyle() {
      this.setData({
        previewImageStyle: buildPreviewImageStyle(
          this.data.previewImageWidth,
          this.data.previewImageHeight,
        ),
      });
    },

    onCardTap() {
      this.emitCardTap();
    },

    onCardLongPress() {
      this.emitCardLongPress();
    },

    onActionTap() {
      this.emitCardTap();
    },

    onPreviewImageError() {
      this.setData({
        previewImageLoadFailed: true,
      });
    },

    emitCardTap() {
      this.triggerEvent("cardtap", this.buildCardEventDetail());
    },

    emitCardLongPress() {
      this.triggerEvent("cardlongpress", this.buildCardEventDetail());
    },

    buildCardEventDetail(): ConclusionCardEventDetail {
      return {
        id: String(this.data.itemId || ""),
        entry: String(this.data.entry || ""),
        section: String(this.data.section || ""),
        title: String(this.data.title || ""),
        module: String(this.data.module || ""),
        hasPdf: Boolean(this.data.hasPdf),
      };
    },
  },
});
