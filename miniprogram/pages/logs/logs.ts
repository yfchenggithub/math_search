import {
  clearLogs,
  getLogs,
  getLogsByLevel,
  type RuntimeLogItem,
  type RuntimeLogLevelFilter,
} from "../../utils/logger/log-store";

type RuntimeLogFilterOption = {
  value: RuntimeLogLevelFilter;
  label: string;
};

type RuntimeLogListItem = RuntimeLogItem & {
  levelLabel: string;
  timestampText: string;
  summaryText: string;
};

type FilterTapEvent = {
  currentTarget: {
    dataset: {
      level?: RuntimeLogLevelFilter;
    };
  };
};

type LogTapEvent = {
  currentTarget: {
    dataset: {
      id?: string;
    };
  };
};

interface RuntimeLogsPageData {
  filters: RuntimeLogFilterOption[];
  activeFilter: RuntimeLogLevelFilter;
  logs: RuntimeLogListItem[];
  filteredCount: number;
  totalCount: number;
  countText: string;
}

const FILTER_OPTIONS: RuntimeLogFilterOption[] = [
  { value: "all", label: "全部" },
  { value: "debug", label: "DEBUG" },
  { value: "info", label: "INFO" },
  { value: "warn", label: "WARN" },
  { value: "error", label: "ERROR" },
];

const MAX_SUMMARY_LENGTH = 96;

function padNumber(value: number, size: number): string {
  const text = String(Math.trunc(value));
  if (text.length >= size) {
    return text;
  }

  return `${"0".repeat(size - text.length)}${text}`;
}

function formatTimestamp(timestamp: number): string {
  const date = new Date(timestamp);
  if (Number.isNaN(date.getTime())) {
    return "-";
  }

  const year = date.getFullYear();
  const month = padNumber(date.getMonth() + 1, 2);
  const day = padNumber(date.getDate(), 2);
  const hour = padNumber(date.getHours(), 2);
  const minute = padNumber(date.getMinutes(), 2);
  const second = padNumber(date.getSeconds(), 2);

  return `${year}-${month}-${day} ${hour}:${minute}:${second}`;
}

function getLevelLabel(level: RuntimeLogItem["level"]): string {
  if (level === "debug") {
    return "DEBUG";
  }

  if (level === "info") {
    return "INFO";
  }

  if (level === "warn") {
    return "WARN";
  }

  return "ERROR";
}

function buildSummary(payloadText: string): string {
  const normalized = String(payloadText || "")
    .replace(/\s+/g, " ")
    .trim();

  if (!normalized) {
    return "(empty payload)";
  }

  if (normalized.length <= MAX_SUMMARY_LENGTH) {
    return normalized;
  }

  return `${normalized.slice(0, MAX_SUMMARY_LENGTH)}...`;
}

function toRuntimeLogListItem(item: RuntimeLogItem): RuntimeLogListItem {
  return {
    ...item,
    levelLabel: getLevelLabel(item.level),
    timestampText: formatTimestamp(item.timestamp),
    summaryText: buildSummary(item.payloadText),
  };
}

function resolveLogsByFilter(filter: RuntimeLogLevelFilter): RuntimeLogItem[] {
  if (filter === "all") {
    return getLogs();
  }

  return getLogsByLevel(filter);
}

Page<RuntimeLogsPageData, WechatMiniprogram.IAnyObject>({
  data: {
    filters: FILTER_OPTIONS,
    activeFilter: "all",
    logs: [],
    filteredCount: 0,
    totalCount: 0,
    countText: "共 0 条",
  },

  onLoad() {
    this.reloadLogs();
  },

  onShow() {
    this.reloadLogs();
  },

  onPullDownRefresh() {
    this.reloadLogs();
    wx.stopPullDownRefresh();
  },

  reloadLogs() {
    const totalLogs = getLogs();
    const filteredLogs = resolveLogsByFilter(this.data.activeFilter);
    const countText = this.data.activeFilter === "all"
      ? `共 ${totalLogs.length} 条`
      : `筛选 ${filteredLogs.length} 条 / 总 ${totalLogs.length} 条`;

    this.setData({
      logs: filteredLogs.map((item) => toRuntimeLogListItem(item)),
      filteredCount: filteredLogs.length,
      totalCount: totalLogs.length,
      countText,
    });
  },

  handleFilterTap(event: FilterTapEvent) {
    const nextFilter = event.currentTarget.dataset.level;
    if (!nextFilter || this.data.activeFilter === nextFilter) {
      return;
    }

    this.setData(
      {
        activeFilter: nextFilter,
      },
      () => {
        this.reloadLogs();
      },
    );
  },

  handleLogTap(event: LogTapEvent) {
    const id = String(event.currentTarget.dataset.id || "").trim();
    if (!id) {
      return;
    }

    wx.navigateTo({
      url: `/pages/runtime-log-detail/runtime-log-detail?id=${encodeURIComponent(id)}`,
      fail: () => {
        wx.showToast({
          title: "日志详情打开失败",
          icon: "none",
        });
      },
    });
  },

  handleClearTap() {
    const totalCount = this.data.totalCount;
    if (totalCount <= 0) {
      wx.showToast({
        title: "暂无可清空日志",
        icon: "none",
      });
      return;
    }

    wx.showModal({
      title: "清空运行日志",
      content: `确认清空本地保存的 ${totalCount} 条运行日志吗？`,
      confirmText: "清空",
      confirmColor: "#d14343",
      cancelText: "取消",
      success: (result) => {
        if (!result.confirm) {
          return;
        }

        clearLogs();
        this.reloadLogs();

        wx.showToast({
          title: "运行日志已清空",
          icon: "none",
        });
      },
    });
  },
});
