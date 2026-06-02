import { USERS_API_CONFIG } from "../../config/api";
import { request } from "../request/request";

export type UserAccountStatus = "active" | "disabled";

export interface UserAccountRecord {
  id: string;
  nickname: string;
  avatarUrl?: string;
  status: UserAccountStatus;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

export interface ListUsersParams {
  status?: UserAccountStatus | "all";
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface UserListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: UserAccountRecord[];
}

type UsersQuery = Record<string, string | number | boolean | undefined>;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function normalizeNumber(value: unknown, fallback = 0): number {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return parsed;
}

function normalizeStatus(value: unknown): UserAccountStatus {
  return normalizeText(value).toLowerCase() === "disabled" ? "disabled" : "active";
}

function normalizeUser(raw: unknown): UserAccountRecord {
  const item = isPlainObject(raw) ? raw : {};

  return {
    id: normalizeText(item.id || item.userId || item.user_id),
    nickname: normalizeText(item.nickname || item.nickName || item.nick_name) || "微信用户",
    avatarUrl: normalizeText(item.avatarUrl || item.avatar_url) || undefined,
    status: normalizeStatus(item.status),
    createdAt: normalizeText(item.createdAt || item.created_at),
    updatedAt: normalizeText(item.updatedAt || item.updated_at),
    lastLoginAt: normalizeText(item.lastLoginAt || item.last_login_at),
  };
}

function normalizeListResponse(raw: unknown): UserListResponse {
  const payload = isPlainObject(raw) ? raw : {};
  const rawItems =
    (Array.isArray(payload.items) && payload.items)
    || (Array.isArray(payload.users) && payload.users)
    || (Array.isArray(payload.list) && payload.list)
    || [];

  return {
    total: normalizeNumber(payload.total, rawItems.length),
    page: normalizeNumber(payload.page, 1),
    pageSize: normalizeNumber(payload.pageSize ?? payload.page_size, rawItems.length),
    items: rawItems.map((item) => normalizeUser(item)),
  };
}

export async function listUsers(params: ListUsersParams = {}): Promise<UserListResponse> {
  const query: UsersQuery = {
    status: params.status && params.status !== "all" ? params.status : undefined,
    keyword: params.keyword,
    page: params.page,
    page_size: params.pageSize,
  };

  const raw = await request<unknown>({
    url: USERS_API_CONFIG.LIST_PATH,
    method: "GET",
    query,
    authMode: "required",
  });

  return normalizeListResponse(raw);
}

export async function updateUserAccountStatus(
  id: string,
  status: UserAccountStatus,
): Promise<UserAccountRecord> {
  const userId = encodeURIComponent(id);
  const raw = await request<unknown, { status: UserAccountStatus }>({
    url: `${USERS_API_CONFIG.LIST_PATH}/${userId}/status`,
    method: "PUT",
    data: {
      status,
    },
    authMode: "required",
  });

  return normalizeUser(raw);
}
