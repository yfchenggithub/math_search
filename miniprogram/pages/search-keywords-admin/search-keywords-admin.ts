import {
  downloadSearchKeywordsCsv,
  listSearchKeywords,
  type SearchKeywordRecord,
  type SearchKeywordResultFilter,
} from "../../services/api/search-keywords-api";
import { createLogger } from "../../utils/logger/logger";
import { RequestError, getErrorMessage } from "../../utils/request";

type SearchKeywordTimeRange = "all" | "today" | "7d" | "30d";

type FilterOption<TValue extends string> = {
  value: TValue;
  label: string;
  active: boolean;
};

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

type FilterTapEvent = {
  currentTarget: {
    dataset: {
      value?: string;
    };
  };
};

type SearchKeywordAdminData = {
  searchInput: string;
  keyword: string;
  timeRangeOptions: Array<FilterOption<SearchKeywordTimeRange>>;
  resultFilterOptions: Array<FilterOption<SearchKeywordResultFilter>>;
  activeTimeRange: SearchKeywordTimeRange;
  activeResultFilter: SearchKeywordResultFilter;
  items: SearchKeywordAdminItem[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  loadingMore: boolean;
  exportingCsv: boolean;
  errorMessage: string;
  hasMore: boolean;
  countText: string;
};

const PAGE_SIZE = 20;
const LOW_RESULT_THRESHOLD = 3;
const adminLogger = createLogger("search-keywords-admin");
const TIME_RANGE_OPTIONS: Array<Omit<FilterOption<SearchKeywordTimeRange>, "active">> = [
  { value: "all", label: "全部时间" },
  { value: "today", label: "今日" },
  { value: "7d", label: "近 7 天" },
  { value: "30d", label: "近 30 天" },
];
const RESULT_FILTER_OPTIONS: Array<Omit<FilterOption<SearchKeywordResultFilter>, "active">> = [
  { value: "all", label: "全部结果" },
  { value: "no_result", label: "无结果" },
  { value: "low_result", label: "低结果" },
];

type SearchKeywordFilterParams = {
  keyword?: string;
  startDate?: string;
  endDate?: string;
  resultFilter: SearchKeywordResultFilter;
  lowResultThreshold: number;
};

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

function formatDateForQuery(value: Date): string {
  const year = value.getFullYear();
  const month = padNumber(value.getMonth() + 1, 2);
  const day = padNumber(value.getDate(), 2);

  return `${year}-${month}-${day}`;
}

function addDays(value: Date, offset: number): Date {
  const next = new Date(value);
  next.setDate(next.getDate() + offset);
  return next;
}

function getTodayStart(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate());
}

function resolveTimeRange(
  value: SearchKeywordTimeRange,
): Pick<SearchKeywordFilterParams, "startDate" | "endDate"> {
  if (value === "all") {
    return {};
  }

  const today = getTodayStart();
  const endDate = formatDateForQuery(today);

  if (value === "today") {
    return {
      startDate: endDate,
      endDate,
    };
  }

  const startOffset = value === "7d" ? -6 : -29;
  return {
    startDate: formatDateForQuery(addDays(today, startOffset)),
    endDate,
  };
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

function buildFilterOptions<TValue extends string>(
  options: Array<Omit<FilterOption<TValue>, "active">>,
  activeValue: TValue,
): Array<FilterOption<TValue>> {
  return options.map((option) => ({
    ...option,
    active: option.value === activeValue,
  }));
}

function isTimeRangeValue(value: unknown): value is SearchKeywordTimeRange {
  return TIME_RANGE_OPTIONS.some((option) => option.value === value);
}

function isResultFilterValue(value: unknown): value is SearchKeywordResultFilter {
  return RESULT_FILTER_OPTIONS.some((option) => option.value === value);
}

function buildFilterParams(data: SearchKeywordAdminData): SearchKeywordFilterParams {
  return {
    keyword: data.keyword,
    ...resolveTimeRange(data.activeTimeRange),
    resultFilter: data.activeResultFilter,
    lowResultThreshold: LOW_RESULT_THRESHOLD,
  };
}

function openCsvDocument(filePath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    wx.openDocument({
      filePath,
      showMenu: true,
      success: () => {
        resolve();
      },
      fail: (error) => {
        reject(new RequestError(String(error.errMsg || "CSV open failed"), {
          data: error,
        }));
      },
    });
  });
}

Page<SearchKeywordAdminData, WechatMiniprogram.IAnyObject>({
  data: {
    searchInput: "",
    keyword: "",
    timeRangeOptions: buildFilterOptions(TIME_RANGE_OPTIONS, "all"),
    resultFilterOptions: buildFilterOptions(RESULT_FILTER_OPTIONS, "all"),
    activeTimeRange: "all",
    activeResultFilter: "all",
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    loading: false,
    loadingMore: false,
    exportingCsv: false,
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

  handleTimeRangeTap(event: FilterTapEvent) {
    const value = event.currentTarget.dataset.value;
    if (!isTimeRangeValue(value) || value === this.data.activeTimeRange) {
      return;
    }

    this.setData({
      activeTimeRange: value,
      timeRangeOptions: buildFilterOptions(TIME_RANGE_OPTIONS, value),
    });
    void this.refreshKeywords();
  },

  handleResultFilterTap(event: FilterTapEvent) {
    const value = event.currentTarget.dataset.value;
    if (!isResultFilterValue(value) || value === this.data.activeResultFilter) {
      return;
    }

    this.setData({
      activeResultFilter: value,
      resultFilterOptions: buildFilterOptions(RESULT_FILTER_OPTIONS, value),
    });
    void this.refreshKeywords();
  },

  handleLoadMoreTap() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    void this.loadKeywords(this.data.page + 1, true);
  },

  async handleExportCsvTap(): Promise<void> {
    if (this.data.exportingCsv) {
      return;
    }

    this.setData({
      exportingCsv: true,
    });

    try {
      const tempFilePath = await downloadSearchKeywordsCsv(buildFilterParams(this.data));

      try {
        await openCsvDocument(tempFilePath);
        wx.showToast({
          title: "CSV 已导出",
          icon: "success",
        });
      } catch (openError) {
        adminLogger.warn("csv_open_failed", {
          keyword: this.data.keyword,
          activeTimeRange: this.data.activeTimeRange,
          activeResultFilter: this.data.activeResultFilter,
          error: openError,
        });
        wx.showModal({
          title: "导出完成",
          content: "CSV 已生成，但当前设备无法直接预览。",
          showCancel: false,
        });
      }
    } catch (error) {
      adminLogger.warn("csv_export_failed", {
        keyword: this.data.keyword,
        activeTimeRange: this.data.activeTimeRange,
        activeResultFilter: this.data.activeResultFilter,
        error,
      });
      wx.showToast({
        title: getErrorMessage(error, "CSV 导出失败"),
        icon: "none",
      });
    } finally {
      this.setData({
        exportingCsv: false,
      });
    }
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
      const filterParams = buildFilterParams(this.data);
      const response = await listSearchKeywords({
        ...filterParams,
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
        activeTimeRange: this.data.activeTimeRange,
        activeResultFilter: this.data.activeResultFilter,
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
