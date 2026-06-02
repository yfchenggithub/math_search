import {
  listSearchKeywords,
  type SearchKeywordRecord,
} from "../../services/api/search-keywords-api";
import { createLogger } from "../../utils/logger/logger";
import { getErrorMessage } from "../../utils/request";

type SearchKeywordAdminItem = SearchKeywordRecord & {
  createdAtText: string;
  updatedAtText: string;
  countText: string;
  resultText: string;
};

type SearchInputEvent = {
  detail: {
    value?: string;
  };
};

type SearchKeywordAdminData = {
  searchInput: string;
  keyword: string;
  items: SearchKeywordAdminItem[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  loadingMore: boolean;
  errorMessage: string;
  hasMore: boolean;
  countText: string;
};

const PAGE_SIZE = 20;
const adminLogger = createLogger("search-keywords-admin");

function padNumber(value: number, size: number): string {
  const text = String(Math.trunc(value));
  if (text.length >= size) {
    return text;
  }

  return `${"0".repeat(size - text.length)}${text}`;
}

function formatDateTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1, 2);
  const day = padNumber(date.getDate(), 2);
  const hour = padNumber(date.getHours(), 2);
  const minute = padNumber(date.getMinutes(), 2);

  return `${year}-${month}-${day} ${hour}:${minute}`;
}

function buildCountText(total: number, currentCount: number): string {
  if (total <= 0) {
    return "暂无搜索词";
  }

  return `共 ${total} 个搜索词，当前显示 ${currentCount} 个`;
}

function mapKeywordToViewItem(record: SearchKeywordRecord): SearchKeywordAdminItem {
  return {
    ...record,
    createdAtText: formatDateTime(record.createdAt),
    updatedAtText: formatDateTime(record.updatedAt),
    countText: `搜索 ${record.searchCount} 次`,
    resultText: record.lastHasResult
      ? `最近有结果：${record.lastResultCount} 条`
      : "最近无结果",
  };
}

Page<SearchKeywordAdminData, WechatMiniprogram.IAnyObject>({
  data: {
    searchInput: "",
    keyword: "",
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    loading: false,
    loadingMore: false,
    errorMessage: "",
    hasMore: false,
    countText: "暂无搜索词",
  },

  onLoad() {
    void this.refreshKeywords();
  },

  onPullDownRefresh() {
    void this.refreshKeywords().finally(() => {
      wx.stopPullDownRefresh();
    });
  },

  handleKeywordInput(event: SearchInputEvent) {
    this.setData({
      searchInput: event.detail.value || "",
    });
  },

  handleSearchConfirm() {
    const keyword = this.data.searchInput.trim();
    if (keyword === this.data.keyword) {
      return;
    }

    this.setData({
      keyword,
    });
    void this.refreshKeywords();
  },

  handleClearSearchTap() {
    if (!this.data.searchInput && !this.data.keyword) {
      return;
    }

    this.setData({
      searchInput: "",
      keyword: "",
    });
    void this.refreshKeywords();
  },

  handleRetryTap() {
    void this.refreshKeywords();
  },

  handleRefreshTap() {
    void this.refreshKeywords();
  },

  handleLoadMoreTap() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    void this.loadKeywords(this.data.page + 1, true);
  },

  async refreshKeywords(): Promise<void> {
    await this.loadKeywords(1, false);
  },

  async loadKeywords(page: number, append: boolean): Promise<void> {
    if (append) {
      this.setData({
        loadingMore: true,
        errorMessage: "",
      });
    } else {
      this.setData({
        loading: true,
        errorMessage: "",
        items: [],
        total: 0,
        page: 1,
        hasMore: false,
        countText: "暂无搜索词",
      });
    }

    try {
      const response = await listSearchKeywords({
        keyword: this.data.keyword,
        page,
        pageSize: this.data.pageSize,
      });
      const mappedItems = response.items.map((item) => mapKeywordToViewItem(item));
      const nextItems = append ? this.data.items.concat(mappedItems) : mappedItems;
      const total = response.total;

      this.setData({
        items: nextItems,
        total,
        page: response.page,
        hasMore: nextItems.length < total,
        countText: buildCountText(total, nextItems.length),
      });
    } catch (error) {
      adminLogger.warn("list_load_failed", {
        keyword: this.data.keyword,
        page,
        error,
      });
      this.setData({
        errorMessage: getErrorMessage(error, "搜索词列表加载失败"),
      });
    } finally {
      this.setData({
        loading: false,
        loadingMore: false,
      });
    }
  },
});
