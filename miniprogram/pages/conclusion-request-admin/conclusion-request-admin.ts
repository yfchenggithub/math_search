import {
  listConclusionRequests,
  updateConclusionRequestStatus,
  type ConclusionRequestRecord,
  type ConclusionRequestStatus,
} from "../../services/api/conclusion-requests-api";
import { formatBeijingDateTime } from "../../utils/beijing-time";
import { createLogger } from "../../utils/logger/logger";
import { getErrorMessage } from "../../utils/request";

type StatusFilter = ConclusionRequestStatus | "all";

type StatusFilterOption = {
  value: StatusFilter;
  label: string;
};

type StatusAction = {
  status: ConclusionRequestStatus;
  label: string;
};

type ConclusionRequestAdminItem = ConclusionRequestRecord & {
  statusText: string;
  statusClass: string;
  createdAtText: string;
  resultText: string;
  noteText: string;
  actions: StatusAction[];
};

type StatusTapEvent = {
  currentTarget: {
    dataset: {
      status?: StatusFilter;
    };
  };
};

type UpdateStatusTapEvent = {
  currentTarget: {
    dataset: {
      id?: number | string;
      status?: ConclusionRequestStatus;
    };
  };
};

type ConclusionRequestAdminData = {
  filters: StatusFilterOption[];
  activeStatus: StatusFilter;
  items: ConclusionRequestAdminItem[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  loadingMore: boolean;
  errorMessage: string;
  hasMore: boolean;
  updatingRequestId: number;
  countText: string;
};

const PAGE_SIZE = 20;
const STATUS_FILTERS: StatusFilterOption[] = [
  { value: "pending", label: "待处理" },
  { value: "updated", label: "已更新" },
  { value: "ignored", label: "已忽略" },
  { value: "all", label: "全部" },
];

const adminLogger = createLogger("conclusion-request-admin");

function formatDateTime(value: string): string {
  return formatBeijingDateTime(value, {
    includeYear: false,
  });
}

function getStatusText(status: ConclusionRequestStatus): string {
  if (status === "updated") {
    return "已更新";
  }

  if (status === "ignored") {
    return "已忽略";
  }

  return "待处理";
}

function buildActions(status: ConclusionRequestStatus): StatusAction[] {
  if (status === "pending") {
    return [
      { status: "updated", label: "标记已更新" },
      { status: "ignored", label: "忽略" },
    ];
  }

  if (status === "updated") {
    return [
      { status: "pending", label: "重新待处理" },
      { status: "ignored", label: "忽略" },
    ];
  }

  return [
    { status: "pending", label: "重新待处理" },
    { status: "updated", label: "标记已更新" },
  ];
}

function mapRecordToViewItem(record: ConclusionRequestRecord): ConclusionRequestAdminItem {
  const resultCount = Number(record.resultCount || 0);

  return {
    ...record,
    statusText: getStatusText(record.status),
    statusClass: record.status,
    createdAtText: formatDateTime(record.createdAt),
    resultText: record.hasResult ? `当时有结果 ${resultCount} 条` : "当时无结果",
    noteText: record.note || "没有补充说明",
    actions: buildActions(record.status),
  };
}

function buildCountText(total: number, currentCount: number): string {
  if (total <= 0) {
    return "暂无记录";
  }

  return `共 ${total} 条，当前显示 ${currentCount} 条`;
}

Page<ConclusionRequestAdminData, WechatMiniprogram.IAnyObject>({
  data: {
    filters: STATUS_FILTERS,
    activeStatus: "pending",
    items: [],
    total: 0,
    page: 1,
    pageSize: PAGE_SIZE,
    loading: false,
    loadingMore: false,
    errorMessage: "",
    hasMore: false,
    updatingRequestId: 0,
    countText: "暂无记录",
  },

  onLoad() {
    void this.refreshRequests();
  },

  handleFilterTap(event: StatusTapEvent) {
    const nextStatus = event.currentTarget.dataset.status || "pending";
    if (nextStatus === this.data.activeStatus) {
      return;
    }

    this.setData({
      activeStatus: nextStatus,
    });
    void this.refreshRequests();
  },

  handleRetryTap() {
    void this.refreshRequests();
  },

  handleRefreshTap() {
    void this.refreshRequests();
  },

  handleLoadMoreTap() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    void this.loadRequests(this.data.page + 1, true);
  },

  async handleStatusActionTap(event: UpdateStatusTapEvent) {
    const requestId = Number(event.currentTarget.dataset.id || 0);
    const status = event.currentTarget.dataset.status;

    if (!requestId || !status || this.data.updatingRequestId > 0) {
      return;
    }

    this.setData({
      updatingRequestId: requestId,
    });

    try {
      const updated = await updateConclusionRequestStatus(requestId, status);
      const updatedItem = mapRecordToViewItem(updated);
      const activeStatus = this.data.activeStatus;
      const shouldKeep = activeStatus === "all" || activeStatus === updated.status;
      const nextItems = shouldKeep
        ? this.data.items.map((item) => (item.id === requestId ? updatedItem : item))
        : this.data.items.filter((item) => item.id !== requestId);
      const nextTotal = shouldKeep ? this.data.total : Math.max(0, this.data.total - 1);

      this.setData({
        items: nextItems,
        total: nextTotal,
        countText: buildCountText(nextTotal, nextItems.length),
        hasMore: nextItems.length < nextTotal,
      });

      wx.showToast({
        title: "状态已更新",
        icon: "none",
      });
    } catch (error) {
      adminLogger.warn("status_update_failed", {
        requestId,
        status,
        error,
      });
      wx.showToast({
        title: getErrorMessage(error, "状态更新失败"),
        icon: "none",
      });
    } finally {
      this.setData({
        updatingRequestId: 0,
      });
    }
  },

  async refreshRequests() {
    await this.loadRequests(1, false);
  },

  async loadRequests(page: number, append: boolean) {
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
      const response = await listConclusionRequests({
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
        errorMessage: getErrorMessage(error, "求结论记录加载失败"),
      });
    } finally {
      this.setData({
        loading: false,
        loadingMore: false,
      });
    }
  },
});
