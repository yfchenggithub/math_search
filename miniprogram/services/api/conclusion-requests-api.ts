import { CONCLUSION_REQUEST_API_CONFIG } from "../../config/api";
import { request } from "../request/request";

export type ConclusionRequestStatus = "pending" | "updated" | "ignored";

export interface SubmitConclusionRequestPayload {
  query: string;
  note: string;
  source: string;
  page: string;
  entry: string;
  result_count: number;
  has_result: boolean;
  active_tab: string;
}

export interface ConclusionRequestRecord {
  id: number;
  userId: string;
  query: string;
  note: string;
  source: string;
  page: string;
  entry: string;
  activeTab: string;
  resultCount: number;
  hasResult: boolean;
  status: ConclusionRequestStatus;
  createdAt: string;
  updatedAt: string;
}

export interface ListConclusionRequestsParams {
  status?: ConclusionRequestStatus | "all";
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface ConclusionRequestListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: ConclusionRequestRecord[];
}

type ConclusionRequestsQuery = Record<string, string | number | boolean | undefined>;

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

function normalizeStatus(value: unknown): ConclusionRequestStatus {
  const status = normalizeText(value).toLowerCase();
  if (status === "updated" || status === "ignored") {
    return status;
  }

  return "pending";
}

function normalizeRecord(raw: unknown): ConclusionRequestRecord {
  const item = isPlainObject(raw) ? raw : {};

  return {
    id: normalizeNumber(item.id),
    userId: normalizeText(item.userId || item.user_id),
    query: normalizeText(item.query),
    note: normalizeText(item.note),
    source: normalizeText(item.source),
    page: normalizeText(item.page),
    entry: normalizeText(item.entry),
    activeTab: normalizeText(item.activeTab || item.active_tab),
    resultCount: normalizeNumber(item.resultCount ?? item.result_count),
    hasResult: Boolean(item.hasResult ?? item.has_result),
    status: normalizeStatus(item.status),
    createdAt: normalizeText(item.createdAt || item.created_at),
    updatedAt: normalizeText(item.updatedAt || item.updated_at),
  };
}

function normalizeListResponse(raw: unknown): ConclusionRequestListResponse {
  const payload = isPlainObject(raw) ? raw : {};
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  return {
    total: normalizeNumber(payload.total, rawItems.length),
    page: normalizeNumber(payload.page, 1),
    pageSize: normalizeNumber(payload.pageSize ?? payload.page_size, rawItems.length),
    items: rawItems.map((item) => normalizeRecord(item)),
  };
}

export async function submitConclusionRequest(
  payload: SubmitConclusionRequestPayload,
): Promise<ConclusionRequestRecord> {
  const raw = await request<unknown, SubmitConclusionRequestPayload>({
    url: CONCLUSION_REQUEST_API_CONFIG.SUBMIT_PATH,
    method: "POST",
    data: payload,
    authMode: "optional",
  });

  return normalizeRecord(raw);
}

export async function listConclusionRequests(
  params: ListConclusionRequestsParams = {},
): Promise<ConclusionRequestListResponse> {
  const query: ConclusionRequestsQuery = {
    status: params.status && params.status !== "all" ? params.status : undefined,
    keyword: params.keyword,
    page: params.page,
    page_size: params.pageSize,
  };

  const raw = await request<unknown>({
    url: CONCLUSION_REQUEST_API_CONFIG.ADMIN_LIST_PATH,
    method: "GET",
    query,
    authMode: "required",
  });

  return normalizeListResponse(raw);
}

export async function updateConclusionRequestStatus(
  id: number,
  status: ConclusionRequestStatus,
): Promise<ConclusionRequestRecord> {
  const requestId = encodeURIComponent(String(id));
  const raw = await request<unknown, { status: ConclusionRequestStatus }>({
    url: `${CONCLUSION_REQUEST_API_CONFIG.ADMIN_LIST_PATH}/${requestId}`,
    method: "PUT",
    data: {
      status,
    },
    authMode: "required",
  });

  return normalizeRecord(raw);
}
