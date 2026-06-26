import {
  listCorrectionReports,
  type CorrectionReportLocation,
  type CorrectionReportRecord,
  type CorrectionReportStatus,
  type CorrectionReportType,
} from "../../services/api/correction-reports-api";
import { formatBeijingDateTime } from "../../utils/beijing-time";
import { createLogger } from "../../utils/logger/logger";
import { getErrorMessage } from "../../utils/request";

type StatusFilter = CorrectionReportStatus | "all";

type StatusFilterOption = {
  value: StatusFilter;
  label: string;
};

type CorrectionReportAdminItem = CorrectionReportRecord & {
  statusText: string;
  statusClass: string;
  createdAtText: string;
  locationText: string;
  typeText: string;
  userText: string;
};

type StatusTapEvent = {
  currentTarget: {
    dataset: {
      status?: StatusFilter;
    };
  };
};

type CorrectionReportAdminData = {
  filters: StatusFilterOption[];
  activeStatus: StatusFilter;
  items: CorrectionReportAdminItem[];
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
const STATUS_FILTERS: StatusFilterOption[] = [
  { value: "all", label: "全部" },
  { value: "pending", label: "待处理" },
  { value: "reviewed", label: "已查看" },
  { value: "ignored", label: "已忽略" },
];

const adminLogger = createLogger("correction-report-admin");

function formatDateTime(value: string): string {
  return formatBeijingDateTime(value, {
    includeYear: false,
  });
}

function getStatusText(status: CorrectionReportStatus): string {
  if (status === "reviewed") {
    return "已查看";
  }

  if (status === "ignored") {
    return "已忽略";
  }

  return "待处理";
}

function getLocationText(location: CorrectionReportLocation): string {
  if (location === "title") {
    return "标题";
  }

  if (location === "summary") {
    return "简介";
  }

  if (location === "core_formula") {
    return "核心公式";
  }

  if (location === "pdf") {
    return "高清 PDF";
  }

  if (location === "other") {
    return "其他";
  }

  return "正文内容";
}

function getTypeText(type: CorrectionReportType): string {
  if (type === "formula") {
    return "公式错误";
  }

  if (type === "layout") {
    return "排版问题";
  }

  if (type === "other") {
    return "其他";
  }

  return "文字错误";
}

function mapRecordToViewItem(record: CorrectionReportRecord): CorrectionReportAdminItem {
  return {
    ...record,
    statusText: getStatusText(record.status),
    statusClass: record.status,
    createdAtText: formatDateTime(record.createdAt),
    locationText: getLocationText(record.errorLocation),
    typeText: getTypeText(record.errorType),
    userText: record.userId || "匿名用户",
  };
}

function buildCountText(total: number, currentCount: number): string {
  if (total <= 0) {
    return "暂无记录";
  }

  return `共 ${total} 条，当前显示 ${currentCount} 条`;
}

Page<CorrectionReportAdminData, WechatMiniprogram.IAnyObject>({
  data: {
    filters: STATUS_FILTERS,
    activeStatus: "all",
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    loading: false,
    loadingMore: false,
    errorMessage: "",
    hasMore: false,
    countText: "暂无记录",
  },

  onLoad() {
    void this.refreshReports();
  },

  handleFilterTap(event: StatusTapEvent) {
    const nextStatus = event.currentTarget.dataset.status || "all";
    if (nextStatus === this.data.activeStatus) {
      return;
    }

    this.setData({
      activeStatus: nextStatus,
    });
    void this.refreshReports();
  },

  handleRetryTap() {
    void this.refreshReports();
  },

  handleRefreshTap() {
    void this.refreshReports();
  },

  handleLoadMoreTap() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    void this.loadReports(this.data.page + 1, true);
  },

  async refreshReports() {
    await this.loadReports(1, false);
  },

  async loadReports(page: number, append: boolean) {
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
        countText: "暂无记录",
      });
    }

    try {
      const response = await listCorrectionReports({
        status: this.data.activeStatus,
        page,
        pageSize: this.data.pageSize,
      });
      const mappedItems = response.items.map((item) => mapRecordToViewItem(item));
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
        activeStatus: this.data.activeStatus,
        page,
        error,
      });
      this.setData({
        errorMessage: getErrorMessage(error, "纠错记录加载失败"),
      });
    } finally {
      this.setData({
        loading: false,
        loadingMore: false,
      });
    }
  },
});
