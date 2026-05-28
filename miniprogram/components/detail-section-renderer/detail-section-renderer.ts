const READING_THEME_BY_KEY: Record<string, string> = {
  explanation: "understanding",
  proof: "proof",
  examples: "example",
  traps: "warning",
  summary: "summary",
};

function buildSectionRootClass(section: Record<string, unknown> | null) {
  const layout = String(section?.layout || "legacy");
  const key = String(section?.key || "").trim();
  const theme = READING_THEME_BY_KEY[key];
  const classes = ["section", `section-${layout}`];

  if (theme) {
    classes.push("section--reading", `section--tone-${theme}`);
  }

  return classes.join(" ");
}

// The page consumes one normalized section view model and leaves schema branching
// inside the adapter. display_version=2 is already structured, so this renderer
// should honor each block/segment as-is instead of rebuilding plain text first.
Component({
  data: {
    rootClass: "section section-legacy",
  },

  properties: {
    section: {
      type: Object,
      value: {},
    },
    zoomActive: {
      type: Boolean,
      value: false,
    },
  },

  observers: {
    section(section: Record<string, unknown> | null) {
      this.setData({
        rootClass: buildSectionRootClass(section),
      });
    },
  },

  methods: {
    onMathImageError(e: WechatMiniprogram.BaseEvent) {
      const nodePath = String(e.currentTarget.dataset.nodePath || "").trim();
      const imageUrl = String(e.currentTarget.dataset.url || "").trim();
      const blockIndex = Number(e.currentTarget.dataset.blockIndex);

      console.warn("[detail] math image load unavailable", {
        nodePath: nodePath || undefined,
        blockIndex: Number.isFinite(blockIndex) ? blockIndex : undefined,
        url: imageUrl,
      });

      if (nodePath) {
        this.setData({
          [`${nodePath}.imageLoadFailed`]: true,
        });
        return;
      }

      if (!Number.isFinite(blockIndex) || blockIndex < 0) {
        return;
      }

      this.setData({
        [`section.blocks[${blockIndex}].imageLoadFailed`]: true,
      });
    },
  },
});
