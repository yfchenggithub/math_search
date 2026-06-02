type ConclusionCardEventDetail = {
  id: string;
  entry: string;
  section: string;
  title: string;
  module: string;
  hasPdf: boolean;
};

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
