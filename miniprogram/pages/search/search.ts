const appInstance = getApp<IAppOption>();

import type { ResultItem } from "../../types/search";
import { CONTENT_MAP } from "../../utils/content-map";
import { initSearchEngine, search, suggest } from "../../utils/search-engine";
let timer: any = null;

Page({
  data: {
    query: "", // 用户真实输入
    results: [] as ResultItem[],
    suggestions: [] as string[],

    // ✅ 新增（UI用）
    statusBarHeight: 0,
    // 模拟UI数据（后面可替换）
    total: 302,
    hotCount: 87,
    learned: 128,
    rate1: 63,
    rate2: 41,

    tabs: ["全部", "函数", "数列", "圆锥曲线", "立体几何", "概率统计"],
    activeTab: "全部",
    showClear: false, // 用搜索框的“清除体验”直接影响用户是否愿意连续搜索
  },

  onLoad() {
    initSearchEngine();

    // ✅ 注入状态栏高度
    this.setData({
      statusBarHeight: appInstance.globalData.statusBarHeight,
    });
  },

  // ✅ 保留你原来的逻辑（完全不动核心）
  onInput(e: any) {
    const value = e.detail.value;

    this.setData({
      query: value,
      showClear: !!value,
    });

    if (timer) clearTimeout(timer);

    timer = setTimeout(() => {
      if (!value) {
        this.setData({
          results: [],
          suggestions: [],
        });
        return;
      }

      const sug = suggest(value);
      const best = sug && sug.length > 0 ? sug[0] : value;
      const ids = search(best); // ⭐ 直接用补全词搜索
      const results = this.buildResults(ids, best);

      this.setData({
        suggestions: sug,
        results,
        query: value,
      });
    }, 80); // 80ms 手感最佳
  },

  // 点击建议 → 自动填充 + 搜索
  onSuggestionTap(e: any) {
    const text = e.currentTarget.dataset.text;

    const ids = search(text);
    const results = this.buildResults(ids, text);

    this.setData({
      query: text,
      suggestions: [],
      results,
    });
  },

  // 回车直接搜索
  onConfirm() {
    const { query } = this.data;

    const ids = search(query);
    const results = this.buildResults(ids, query);

    this.setData({
      suggestions: [],
      results,
    });
  },

  onClear() {
    this.setData({
      query: "",
      showClear: false,
    });

    // 👇 保持焦点（关键体验）
    this.setData({
      focus: true,
    });
  },
  // ✅ UI增强（补充字段）
  buildResults(ids: string[], highlightQuery: string): any[] {
    const list: any[] = [];

    for (let i = 0; i < Math.min(ids.length, 20); i++) {
      const id = ids[i];

      const module = this.getModuleById(id);
      const data = CONTENT_MAP[module];

      if (!data) continue;

      const item = data[id];

      if (item) {
        list.push({
          id,
          title: item.title,
          titleSegments: this.highlightSegments(item.title, highlightQuery),
          summary: item.summary || "",

          // ✅ UI需要的字段（可后续真实数据替换）
          formula: item.formula || item.title,
          module: module,
          level: "★★★",
          freq: "★★★★★",
          score: 20,
          recentScore: 20,
          usage: "2025新高考｜卷第19题适用",
        });
      }
    }

    return list;
  },

  highlightSegments(text: string, keyword: string) {
    if (!keyword) {
      return [{ text, highlight: false }];
    }

    const result: { text: string; highlight: boolean }[] = [];

    let start = 0;
    const lowerText = text.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();

    let index = lowerText.indexOf(lowerKeyword);

    while (index !== -1) {
      // 前面普通文本
      if (index > start) {
        result.push({
          text: text.slice(start, index),
          highlight: false,
        });
      }

      // 高亮部分
      result.push({
        text: text.slice(index, index + keyword.length),
        highlight: true,
      });

      start = index + keyword.length;
      index = lowerText.indexOf(lowerKeyword, start);
    }

    // 剩余部分
    if (start < text.length) {
      result.push({
        text: text.slice(start),
        highlight: false,
      });
    }

    return result;
  },

  // tab切换
  onTabTap(e: any) {
    const tab = e.currentTarget.dataset.tab;
    this.setData({ activeTab: tab });
  },

  getModuleById(id: string): string {
    if (id.startsWith("I")) return "inequality";
    if (id.startsWith("V")) return "vector";
    return "vector";
  },

  // 用户点击详情后可以到达结论的详情页面
  onDetailTap(e: any) {
    const id = e.currentTarget.dataset.id;
    wx.navigateTo({
      url: `/pages/detail/detail?id=${id}`,
    });
  },
});
