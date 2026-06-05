import { getLogById, type RuntimeLogItem } from "../../utils/logger/log-store";
import { formatBeijingDateTime } from "../../utils/beijing-time";

type RuntimeLogDetailQuery = {
  id?: string;
};

interface RuntimeLogDetailPageData {
  log: RuntimeLogItem | null;
  notFound: boolean;
  timestampText: string;
  levelText: string;
  locationText: string;
}

function formatFullTimestamp(timestamp: number): string {
  return formatBeijingDateTime(timestamp, {
    includeMilliseconds: true,
  });
}

function formatLevel(level: RuntimeLogItem["level"]): string {
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

function formatLocation(log: RuntimeLogItem): string {
  if (!log.fileName) {
    return "-";
  }

  if (typeof log.line === "number" && log.line > 0) {
    return `${log.fileName}:${log.line}`;
  }

  return log.fileName;
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch (_error) {
    return value;
  }
}

Page<RuntimeLogDetailPageData, WechatMiniprogram.IAnyObject>({
  data: {
    log: null,
    notFound: false,
    timestampText: "",
    levelText: "",
    locationText: "-",
  },

  logId: "",

  onLoad(query: RuntimeLogDetailQuery) {
    this.logId = safeDecode(String(query.id || "").trim());
    this.loadLog();
  },

  onShow() {
    if (!this.logId) {
      return;
    }

    this.loadLog();
  },

  loadLog() {
    if (!this.logId) {
      this.setData({
        log: null,
        notFound: true,
        timestampText: "",
        levelText: "",
        locationText: "-",
      });
      return;
    }

    const log = getLogById(this.logId);
    if (!log) {
      this.setData({
        log: null,
        notFound: true,
        timestampText: "",
        levelText: "",
        locationText: "-",
      });
      return;
    }

    this.setData({
      log,
      notFound: false,
      timestampText: formatFullTimestamp(log.timestamp),
      levelText: formatLevel(log.level),
      locationText: formatLocation(log),
    });
  },

  handleCopyTap() {
    const formattedLine = this.data.log?.formattedLine || "";
    if (!formattedLine) {
      wx.showToast({
        title: "无可复制内容",
        icon: "none",
      });
      return;
    }

    wx.setClipboardData({
      data: formattedLine,
      success: () => {
        wx.showToast({
          title: "已复制完整日志",
          icon: "none",
        });
      },
    });
  },
});
