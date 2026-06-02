import { SEARCH_KEYWORDS_API_CONFIG } from "../../config/api";
import { request } from "../request/request";

export interface SearchKeywordRecord {
  id: number;
  keyword: string;
  normalizedKeyword: string;
  searchCount: number;
  lastResultCount: number;
  lastHasResult: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ListSearchKeywordsParams {
  keyword?: string;
  page?: number;
  pageSize?: number;
}

export interface SearchKeywordListResponse {
  total: number;
  page: number;
  pageSize: number;
  items: SearchKeywordRecord[];
}

type SearchKeywordsQuery = Record<string, string | number | boolean | undefined>;

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

function normalizeKeyword(raw: unknown): SearchKeywordRecord {
  const item = isPlainObject(raw) ? raw : {};

  return {
    id: normalizeNumber(item.id),
    keyword: normalizeText(item.keyword),
    normalizedKeyword: normalizeText(item.normalizedKeyword || item.normalized_keyword),
    searchCount: normalizeNumber(item.searchCount ?? item.search_count),
    lastResultCount: normalizeNumber(item.lastResultCount ?? item.last_result_count),
    lastHasResult: Boolean(item.lastHasResult ?? item.last_has_result),
    createdAt: normalizeText(item.createdAt || item.created_at),
    updatedAt: normalizeText(item.updatedAt || item.updated_at),
  };
}

function normalizeListResponse(raw: unknown): SearchKeywordListResponse {
  const payload = isPlainObject(raw) ? raw : {};
  const rawItems = Array.isArray(payload.items) ? payload.items : [];

  return {
    total: normalizeNumber(payload.total, rawItems.length),
    page: normalizeNumber(payload.page, 1),
    pageSize: normalizeNumber(payload.pageSize ?? payload.page_size, rawItems.length),
    items: rawItems.map((item) => normalizeKeyword(item)),
  };
}

export async function listSearchKeywords(
  params: ListSearchKeywordsParams = {},
): Promise<SearchKeywordListResponse> {
  const query: SearchKeywordsQuery = {
    keyword: params.keyword,
    page: params.page,
    page_size: params.pageSize,
  };

  const raw = await request<unknown>({
    url: SEARCH_KEYWORDS_API_CONFIG.ADMIN_LIST_PATH,
    method: "GET",
    query,
    authMode: "required",
  });

  return normalizeListResponse(raw);
}
