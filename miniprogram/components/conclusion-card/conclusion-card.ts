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

  return `width: ${width}px;`;
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
  },

  data: {
    previewImageLoadFailed: false,
    previewImageStyle: buildPreviewImageStyle(0, 0),
  },

  observers: {
    "previewType, previewImage, previewImageWidth, previewImageHeight"() {
      this.setData({
        previewImageStyle: buildPreviewImageStyle(
          this.data.previewImageWidth,
          this.data.previewImageHeight,
        ),
      });

      if (this.data.previewImageLoadFailed) {
        this.setData({
          previewImageLoadFailed: false,
        });
      }
    },
  },

  methods: {
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
