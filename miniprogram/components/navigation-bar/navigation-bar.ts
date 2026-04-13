import { getNavLayout } from "../../utils/nav";

Component({
  options: {
    multipleSlots: true,
  },
  properties: {
    extClass: {
      type: String,
      value: "",
    },
    title: {
      type: String,
      value: "",
    },
    background: {
      type: String,
      value: "rgba(248, 250, 252, 0.86)",
    },
    color: {
      type: String,
      value: "#0f172a",
    },
    back: {
      type: Boolean,
      value: true,
    },
    loading: {
      type: Boolean,
      value: false,
    },
    homeButton: {
      type: Boolean,
      value: false,
    },
    fixed: {
      type: Boolean,
      value: false,
    },
    placeholder: {
      type: Boolean,
      value: true,
    },
    zIndex: {
      type: Number,
      value: 40,
    },
    animated: {
      type: Boolean,
      value: true,
    },
    show: {
      type: Boolean,
      value: true,
      observer: "_showChange",
    },
    delta: {
      type: Number,
      value: 1,
    },
  },
  data: {
    displayStyle: "",
    fixedStyle: "",
    placeholderStyle: "",
    innerPaddingRight: "",
    leftWidth: "",
    safeAreaTop: "",
    contentStyle: "",
    ios: true,
  },
  lifetimes: {
    attached() {
      this.applyLayout();
      this._showChange(this.data.show);
    },
  },
  observers: {
    fixed() {
      this.updateFixedStyle();
    },
    zIndex() {
      this.updateFixedStyle();
    },
  },
  methods: {
    applyLayout() {
      const layout = getNavLayout();
      const platform = String(wx.getSystemInfoSync().platform || "").toLowerCase();

      this.setData({
        ios: platform !== "android",
        innerPaddingRight: `padding-right: ${layout.sideWidthPx}px;`,
        leftWidth: `width: ${layout.sideWidthPx}px;`,
        safeAreaTop: `padding-top: ${layout.statusBarHeightPx}px;`,
        contentStyle: `height: ${layout.navBarHeightPx}px;`,
        placeholderStyle: `height: ${layout.navTotalHeightPx}px;`,
      });

      this.updateFixedStyle();
    },
    updateFixedStyle() {
      const fixedStyle = this.data.fixed
        ? `position: fixed; left: 0; right: 0; top: 0; z-index: ${this.data.zIndex};`
        : "";

      this.setData({
        fixedStyle,
      });
    },
    _showChange(show: boolean) {
      const animated = this.data.animated;
      let displayStyle = "";

      if (animated) {
        displayStyle = `opacity: ${show ? "1" : "0"};transition:opacity 0.5s;`;
      } else {
        displayStyle = `display: ${show ? "" : "none"}`;
      }

      this.setData({
        displayStyle,
      });
    },
    back() {
      if (this.data.delta) {
        wx.navigateBack({
          delta: this.data.delta,
        });
      }

      this.triggerEvent("back", { delta: this.data.delta }, {});
    },
    home() {
      wx.reLaunch({
        url: "/pages/index/index",
      });

      this.triggerEvent("home", {}, {});
    },
  },
});
