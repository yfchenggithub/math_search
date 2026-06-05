import {
  listUsers,
  updateUserAccountStatus,
  type UserAccountRecord,
  type UserAccountStatus,
} from "../../services/api/users-api";
import { formatBeijingDateTime } from "../../utils/beijing-time";
import { createLogger } from "../../utils/logger/logger";
import { getErrorMessage } from "../../utils/request";

type StatusFilter = UserAccountStatus | "all";

type StatusFilterOption = {
  value: StatusFilter;
  label: string;
};

type UserStatusAction = {
  status: UserAccountStatus;
  label: string;
};

type UserManagementItem = UserAccountRecord & {
  avatarSrc: string;
  statusText: string;
  statusClass: string;
  createdAtText: string;
  updatedAtText: string;
  lastLoginAtText: string;
  actionStatus: UserAccountStatus;
  actionLabel: string;
};

type SearchInputEvent = {
  detail: {
    value?: string;
  };
};

type StatusTapEvent = {
  currentTarget: {
    dataset: {
      status?: StatusFilter;
    };
  };
};

type UserStatusTapEvent = {
  currentTarget: {
    dataset: {
      id?: string;
      status?: UserAccountStatus;
    };
  };
};

type UserManagementData = {
  filters: StatusFilterOption[];
  activeStatus: StatusFilter;
  searchInput: string;
  keyword: string;
  items: UserManagementItem[];
  total: number;
  page: number;
  pageSize: number;
  loading: boolean;
  loadingMore: boolean;
  errorMessage: string;
  hasMore: boolean;
  updatingUserId: string;
  countText: string;
};

const PAGE_SIZE = 20;
const DEFAULT_AVATAR = "/assets/images/default-avatar.png";
const STATUS_FILTERS: StatusFilterOption[] = [
  { value: "all", label: "全部" },
  { value: "active", label: "正常" },
  { value: "disabled", label: "已禁用" },
];

const userManagementLogger = createLogger("user-management");

function getStatusText(status: UserAccountStatus): string {
  return status === "disabled" ? "已禁用" : "正常";
}

function buildStatusAction(status: UserAccountStatus): UserStatusAction {
  if (status === "disabled") {
    return {
      status: "active",
      label: "启用账号",
    };
  }

  return {
    status: "disabled",
    label: "禁用账号",
  };
}

function mapUserToViewItem(record: UserAccountRecord): UserManagementItem {
  const action = buildStatusAction(record.status);

  return {
    ...record,
    avatarSrc: record.avatarUrl || DEFAULT_AVATAR,
    statusText: getStatusText(record.status),
    statusClass: record.status,
    createdAtText: formatBeijingDateTime(record.createdAt),
    updatedAtText: formatBeijingDateTime(record.updatedAt),
    lastLoginAtText: formatBeijingDateTime(record.lastLoginAt),
    actionStatus: action.status,
    actionLabel: action.label,
  };
}

function buildCountText(total: number, currentCount: number): string {
  if (total <= 0) {
    return "暂无用户";
  }

  return `共 ${total} 位用户，当前显示 ${currentCount} 位`;
}

Page<UserManagementData, WechatMiniprogram.IAnyObject>({
  data: {
    filters: STATUS_FILTERS,
    activeStatus: "all",
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
    updatingUserId: "",
    countText: "暂无用户",
  },

  onLoad() {
    void this.refreshUsers();
  },

  onPullDownRefresh() {
    void this.refreshUsers().finally(() => {
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
    void this.refreshUsers();
  },

  handleClearSearchTap() {
    if (!this.data.searchInput && !this.data.keyword) {
      return;
    }

    this.setData({
      searchInput: "",
      keyword: "",
    });
    void this.refreshUsers();
  },

  handleFilterTap(event: StatusTapEvent) {
    const nextStatus = event.currentTarget.dataset.status || "all";
    if (nextStatus === this.data.activeStatus) {
      return;
    }

    this.setData({
      activeStatus: nextStatus,
    });
    void this.refreshUsers();
  },

  handleRetryTap() {
    void this.refreshUsers();
  },

  handleRefreshTap() {
    void this.refreshUsers();
  },

  handleLoadMoreTap() {
    if (this.data.loading || this.data.loadingMore || !this.data.hasMore) {
      return;
    }

    void this.loadUsers(this.data.page + 1, true);
  },

  handleStatusActionTap(event: UserStatusTapEvent) {
    const userId = event.currentTarget.dataset.id || "";
    const status = event.currentTarget.dataset.status;

    if (!userId || !status || this.data.updatingUserId) {
      return;
    }

    const targetUser = this.data.items.find((item) => item.id === userId);
    const actionLabel = status === "disabled" ? "禁用账号" : "启用账号";
    const targetName = targetUser?.nickname || userId;

    wx.showModal({
      title: actionLabel,
      content: `确认${actionLabel}「${targetName}」吗？`,
      confirmText: actionLabel,
      cancelText: "取消",
      success: (res) => {
        if (!res.confirm) {
          return;
        }

        void this.updateUserStatus(userId, status);
      },
    });
  },

  async updateUserStatus(userId: string, status: UserAccountStatus) {
    this.setData({
      updatingUserId: userId,
    });

    try {
      const currentUser = this.data.items.find((item) => item.id === userId);
      const updated = await updateUserAccountStatus(userId, status);
      const mergedUser: UserAccountRecord = {
        id: updated.id || currentUser?.id || userId,
        nickname: updated.nickname || currentUser?.nickname || "微信用户",
        avatarUrl: updated.avatarUrl || currentUser?.avatarUrl,
        status,
        createdAt: updated.createdAt || currentUser?.createdAt || "",
        updatedAt: updated.updatedAt || currentUser?.updatedAt || "",
        lastLoginAt: updated.lastLoginAt || currentUser?.lastLoginAt || "",
      };
      const updatedItem = mapUserToViewItem(mergedUser);
      const activeStatus = this.data.activeStatus;
      const shouldKeep = activeStatus === "all" || activeStatus === status;
      const nextItems = shouldKeep
        ? this.data.items.map((item) => (item.id === userId ? updatedItem : item))
        : this.data.items.filter((item) => item.id !== userId);
      const nextTotal = shouldKeep ? this.data.total : Math.max(0, this.data.total - 1);

      this.setData({
        items: nextItems,
        total: nextTotal,
        countText: buildCountText(nextTotal, nextItems.length),
        hasMore: nextItems.length < nextTotal,
      });

      wx.showToast({
        title: status === "disabled" ? "账号已禁用" : "账号已启用",
        icon: "none",
      });
    } catch (error) {
      userManagementLogger.warn("status_update_failed", {
        userId,
        status,
        error,
      });
      wx.showToast({
        title: getErrorMessage(error, "账号状态更新失败"),
        icon: "none",
      });
    } finally {
      this.setData({
        updatingUserId: "",
      });
    }
  },

  async refreshUsers(): Promise<void> {
    await this.loadUsers(1, false);
  },

  async loadUsers(page: number, append: boolean): Promise<void> {
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
        countText: "暂无用户",
      });
    }

    try {
      const response = await listUsers({
        status: this.data.activeStatus,
        keyword: this.data.keyword,
        page,
        pageSize: this.data.pageSize,
      });
      const mappedItems = response.items.map((item) => mapUserToViewItem(item));
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
      userManagementLogger.warn("list_load_failed", {
        activeStatus: this.data.activeStatus,
        keyword: this.data.keyword,
        page,
        error,
      });
      this.setData({
        errorMessage: getErrorMessage(error, "用户列表加载失败"),
      });
    } finally {
      this.setData({
        loading: false,
        loadingMore: false,
      });
    }
  },
});
