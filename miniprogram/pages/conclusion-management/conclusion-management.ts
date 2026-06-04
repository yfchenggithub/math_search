import {
  CONTENT_MODULE_FILTERS,
  type ContentModuleFilter,
} from "../../constants/content-modules";
import type { AuthStatusToastType } from "../../services/auth/auth-types";
import {
  listAdminConclusions,
  type AdminConclusionRecord,
  type AdminConclusionPreviewType,
} from "../../services/api/conclusions-admin-api";
import type { AuthStatusToastState } from "../../utils/auth/auth-status-feedback";
import {
  hideAuthStatusToast,
  retryAuthStatusToast,
  showAuthStatusToast,
  subscribeAuthStatusToast,
} from "../../utils/auth/auth-status-feedback";
import { createLogger } from "../../utils/logger/logger";
import { renderMath } from "../../utils/math-render";
import { getErrorMessage } from "../../utils/request";

type CardPreviewType = AdminConclusionPreviewType;

type ConclusionManagementModuleFilter = {
  label: string;
  backendModule: string;
};

type ConclusionManagementCard = {
  id: string;
  title: string;
  summary: string;
  module: string;
  tags: string[];
  previewType: CardPreviewType;
  previewHtml: string;
  previewText: string;
  previewImage: string;
  previewImageWidth: number;
  previewImageHeight: number;
  previewFallbackText: string;
};

type SearchInputEvent = {
  detail: {
    value?: string;
  };
};

type ModuleTapEvent = {
  currentTarget: {
    dataset: {
      module?: string;
    };
  };
};

type CardTapEvent = {
  detail?: {
    id?: string;
  };
  currentTarget?: {
    dataset?: {
      id?: string;
    };
  };
};

type ConclusionManagementData = {
  moduleFilters: ConclusionManagementModuleFilter[];
  activeModule: string;
  searchInput: string;
  keyword: string;
  items: ConclusionManagementCard[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  loadingMore: boolean;
  errorMessage: string;
  hasMore: boolean;
  countText: string;
  authStatusToastVisible: boolean;
  authStatusToastType: AuthStatusToastType;
  authStatusToastTitle: string;
  authStatusToastMessage: string;
  authStatusToastRetryable: boolean;
  authStatusToastClosable: boolean;
};

const PAGE_SIZE = 20;
const ALL_MODULE_FILTER: ConclusionManagementModuleFilter = {
  label: "全部",
  backendModule: "",
};
const managementLogger = createLogger("conclusion-management");

function toTrimmedString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function buildModuleFilters(): ConclusionManagementModuleFilter[] {
  return [
    ALL_MODULE_FILTER,
    ...CONTENT_MODULE_FILTERS.map((item: ContentModuleFilter) => ({
      label: item.label,
      backendModule: item.backendModule,
    })),
  ];
}

function resolveModuleLabel(module: string, fallback: string): string {
  const matched = CONTENT_MODULE_FILTERS.find((item) => item.backendModule === module);
  return matched?.label || fallback || module || "数学";
}

function buildTags(record: AdminConclusionRecord, moduleLabel: string): string[] {
  const tags: string[] = [];
  const seen: Record<string, true> = {};

  const appendTag = (rawTag: string) => {
    const tag = toTrimmedString(rawTag);
    if (!tag || seen[tag] || tags.length >= 3) {
      return;
    }

    seen[tag] = true;
    tags.push(tag);
  };

  appendTag(record.category || moduleLabel);
  record.tags.forEach((tag) => {
    appendTag(tag);
  });

  return tags;
}

function buildPreview(record: AdminConclusionRecord): Pick<
  ConclusionManagementCard,
  | "previewType"
  | "previewHtml"
  | "previewText"
  | "previewImage"
  | "previewImageWidth"
  | "previewImageHeight"
  | "previewFallbackText"
> {
  if (record.previewType === "image" && record.previewImage) {
    return {
      previewType: "image",
      previewHtml: "",
      previewText: "",
      previewImage: record.previewImage,
      previewImageWidth: record.previewImageWidth,
      previewImageHeight: record.previewImageHeight,
      previewFallbackText: record.previewFallbackText,
    };
  }

  if (record.previewType === "html" && record.previewHtml) {
    return {
      previewType: "html",
      previewHtml: record.previewHtml,
      previewText: "",
      previewImage: "",
      previewImageWidth: 0,
      previewImageHeight: 0,
      previewFallbackText: record.previewFallbackText,
    };
  }

  if (record.previewType === "text" && record.previewText) {
    return {
      previewType: "text",
      previewHtml: "",
      previewText: record.previewText,
      previewImage: "",
      previewImageWidth: 0,
      previewImageHeight: 0,
      previewFallbackText: record.previewFallbackText || record.previewText,
    };
  }

  if (record.coreFormula) {
    const mathResult = renderMath(record.coreFormula, true);
    return {
      previewType: mathResult.html ? "html" : "text",
      previewHtml: mathResult.html,
      previewText: mathResult.html ? "" : mathResult.source,
      previewImage: "",
      previewImageWidth: 0,
      previewImageHeight: 0,
      previewFallbackText: mathResult.source,
    };
  }

  return {
    previewType: "none",
    previewHtml: "",
    previewText: "",
    previewImage: "",
    previewImageWidth: 0,
    previewImageHeight: 0,
    previewFallbackText: "",
  };
}

function mapRecordToCard(record: AdminConclusionRecord): ConclusionManagementCard {
  const moduleLabel = resolveModuleLabel(record.module, record.category);
  const tags = buildTags(record, moduleLabel);
  const summary = record.summary || (tags.length > 0 ? tags.join(" / ") : "暂无摘要");

  return {
    id: record.id,
    title: record.title || record.id,
    summary,
    module: moduleLabel,
    tags,
    ...buildPreview(record),
  };
}

function buildCountText(total: number, currentCount: number, activeModule: string): string {
  const moduleLabel = resolveModuleLabel(activeModule, activeModule ? activeModule : "全部");
  if (total <= 0) {
    return activeModule ? `${moduleLabel}暂无结论` : "暂无结论";
  }

  return `${moduleLabel}共 ${total} 条，当前显示 ${currentCount} 条`;
}

Page<ConclusionManagementData, WechatMiniprogram.IAnyObject>({
  data: {
    moduleFilters: buildModuleFilters(),
    activeModule: "",
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
    authStatusToastVisible: false,
    authStatusToastType: "idle",
    authStatusToastTitle: "",
    authStatusToastMessage: "",
    authStatusToastRetryable: false,
    authStatusToastClosable: false,
    countText: "暂无结论",
  },

  unsubscribeAuthStatusToast: undefined as undefined | (() => void),

  onLoad() {
    this.unsubscribeAuthStatusToast = subscribeAuthStatusToast((state) => {
      this.syncAuthStatusToast(state);
    });
    void this.refreshConclusions();
  },

  onPullDownRefresh() {
    void this.refreshConclusions()
      .then(() => {
        this.showRefreshCompleteToast();
      })
      .catch((error: unknown) => {
        managementLogger.warn("conclusion_admin_pull_refresh_failed", { error });
        showAuthStatusToast({
          type: "error",
          title: "刷新失败",
          message: getErrorMessage(error, "刷新失败，请稍后重试"),
          closable: true,
          source: "unknown",
        });
      })
      .finally(() => {
        wx.stopPullDownRefresh();
      });
  },

  onUnload() {
    this.unsubscribeAuthStatusToast?.();
    this.unsubscribeAuthStatusToast = undefined;
    hideAuthStatusToast("conclusion_management_unload");
  },

  handleAuthStatusToastRetry() {
    const retried = retryAuthStatusToast();
    if (!retried) {
      hideAuthStatusToast("retry_unavailable");
    }
  },

  handleAuthStatusToastClose() {
    hideAuthStatusToast("manual_close");
  },

  syncAuthStatusToast(state: AuthStatusToastState) {
    this.setData({
      authStatusToastVisible: state.visible,
      authStatusToastType: state.type,
      authStatusToastTitle: state.title,
      authStatusToastMessage: state.message,
      authStatusToastRetryable: state.retryable,
      authStatusToastClosable: state.closable,
    });
  },

  showRefreshCompleteToast() {
    const errorMessage = String(this.data.errorMessage || "").trim();
    if (errorMessage) {
      showAuthStatusToast({
        type: "error",
        title: "刷新失败",
        message: errorMessage,
        closable: true,
        source: "unknown",
      });
      return;
    }

    showAuthStatusToast({
      type: "success",
      title: "刷新完成",
      message: "结论列表已更新",
      source: "unknown",
    });
  },

  handleModuleTap(event: ModuleTapEvent) {
    const module = String(event.currentTarget.dataset.module || "");
    if (module === this.data.activeModule) {
      return;
    }

    this.setData({
      activeModule: module,
      page: 1,
    });
    void this.refreshConclusions();
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
      page: 1,
    });
    void this.refreshConclusions();
  },

  handleClearSearchTap() {
    if (!this.data.searchInput && !this.data.keyword) {
      return;
    }

    this.setData({
      searchInput: "",
      keyword: "",
      page: 1,
    });
    void this.refreshConclusions();
  },

  handleRefreshTap() {
    void this.refreshConclusions();
  },

  handleRetryTap() {
    void this.refreshConclusions();
  },

  handleLoadMoreTap() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    void this.loadConclusions(this.data.page + 1, true);
  },

  handleCardTap(event: CardTapEvent) {
    const id = String(event.detail?.id || event.currentTarget?.dataset?.id || "");
    if (!id) {
      wx.showToast({
        title: "暂时无法打开该结论",
        icon: "none",
      });
      return;
    }

    wx.navigateTo({
      url: `/pages/detail/detail?id=${encodeURIComponent(id)}&source=admin&entry=conclusion_management_card`,
      fail: () => {
        wx.showToast({
          title: "详情页打开失败",
          icon: "none",
        });
      },
    });
  },

  async refreshConclusions(): Promise<void> {
    await this.loadConclusions(1, false);
  },

  async loadConclusions(page: number, append: boolean): Promise<void> {
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
        countText: buildCountText(0, 0, this.data.activeModule),
      });
    }

    try {
      const response = await listAdminConclusions({
        module: this.data.activeModule || undefined,
        keyword: this.data.keyword,
        page,
        pageSize: this.data.pageSize,
      });
      const mappedItems = response.items.map((item) => mapRecordToCard(item));
      const nextItems = append ? this.data.items.concat(mappedItems) : mappedItems;
      const total = response.total;

      this.setData({
        items: nextItems,
        total,
        page: response.page,
        hasMore: nextItems.length < total,
        countText: buildCountText(total, nextItems.length, this.data.activeModule),
      });
    } catch (error) {
      managementLogger.warn("conclusion_admin_list_failed", {
        module: this.data.activeModule,
        keyword: this.data.keyword,
        page,
        error,
      });
      this.setData({
        errorMessage: getErrorMessage(error, "结论列表加载失败"),
      });
    } finally {
      this.setData({
        loading: false,
        loadingMore: false,
      });
    }
  },
});
