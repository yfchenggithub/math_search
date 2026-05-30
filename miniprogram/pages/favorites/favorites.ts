type FavoritesPageData = {
  favoriteCount: number;
  favoriteItems: FavoriteConclusionItem[];
};

type FavoriteConclusionItem = {
  id: string;
  detailId: string;
  title: string;
  summary: string;
  tags: string[];
  module: string;
};

type FavoriteCardTapEvent = {
  detail?: {
    id?: string;
  };
};

const FAVORITE_MOCK_ITEMS: FavoriteConclusionItem[] = [
  {
    id: "favorite-log-mean-inequality",
    detailId: "",
    title: "对数平均值不等式",
    summary: "两个不相等的正数的对数平均值，严格介于它们的几何平均值和算术平均值之间。",
    tags: ["不等式", "对数平均值", "均值不等式"],
    module: "不等式",
  },
  {
    id: "favorite-cauchy-inequality",
    detailId: "",
    title: "柯西不等式",
    summary: "两个序列平方和的乘积，不小于它们对应项乘积之和的平方。",
    tags: ["不等式", "柯西不等式", "向量不等式"],
    module: "不等式",
  },
  {
    id: "favorite-bernoulli-inequality",
    detailId: "",
    title: "伯努利不等式",
    summary: "用一次函数 1+nx 逼近 (1+x)^n，逼近方向由指数 n 是否在 [0,1] 区间内决定。",
    tags: ["不等式", "伯努利不等式", "指数函数"],
    module: "不等式",
  },
];

Page<FavoritesPageData, WechatMiniprogram.IAnyObject>({
  data: {
    favoriteCount: 24,
    favoriteItems: FAVORITE_MOCK_ITEMS,
  },

  handleExportAllPdfTap() {
    wx.showToast({
      title: "功能建设中",
      icon: "none",
    });
  },

  handleFavoriteCardTap(event: FavoriteCardTapEvent) {
    const cardId = String(event.detail?.id || "").trim();
    if (!cardId) {
      wx.showToast({
        title: "收藏项暂不可用",
        icon: "none",
      });
      return;
    }

    const target = this.data.favoriteItems.find((item) => item.id === cardId);
    if (!target) {
      wx.showToast({
        title: "收藏项暂不可用",
        icon: "none",
      });
      return;
    }

    if (!target.detailId) {
      wx.showToast({
        title: "示例数据暂未绑定详情",
        icon: "none",
      });
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${target.detailId}&source=${encodeURIComponent("favorites")}&entry=${encodeURIComponent("favorites_card")}`,
      fail: () => {
        wx.showToast({
          title: "详情页打开失败",
          icon: "none",
        });
      },
    });
  },
});
