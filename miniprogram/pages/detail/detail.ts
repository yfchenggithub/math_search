import { CONTENT_MAP } from "../../utils/content-map";

Page({
  data: {
    detail: {},
    showProof: false,
  },

  onLoad(options: any) {
    const id = options.id;

    const module = this.getModuleById(id);
    const data = CONTENT_MAP[module];
    const detail = data && data[id];
    console.log(detail)
    if (!detail) {
      wx.showToast({ title: "数据不存在", icon: "none" });
      return;
    }

    this.setData({
      detail,
    });
  },

  // 页面 JS 处理返回事件
  onNavBack() {
    const pages = getCurrentPages();

    if (pages.length > 1) {
      wx.navigateBack();
    } else {
      wx.reLaunch({
        url: "/pages/search/search",
      });
    }
  },

  toggleProof() {
    this.setData({
      showProof: !this.data.showProof,
    });
  },

  getModuleById(id: string): string {
    if (id.startsWith("I")) return "inequality";
    return "inequality";
  },
});
