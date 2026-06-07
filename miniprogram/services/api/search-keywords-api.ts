import { SEARCH_KEYWORDS_API_CONFIG } from "../../config/api";
import { buildAbsoluteApiUrl } from "../../utils/api-url";
import { getAccessToken, getSession } from "../../utils/storage/token-storage";
import { authService } from "../auth/auth-service";
import { RequestError, request } from "../request/request";

export interface SearchKeywordRecord {
  id: number;
  keyword: string;
  normalizedKeyword: string;
  searchCount: number;
  noResultCount: number;
  lastResultCount: number;
  lastHasResult: boolean;
  createdAt: string;
  updatedAt: string;
}

export type SearchKeywordResultFilter = "all" | "no_result" | "low_result";
export type SearchKeywordSortBy = "recent" | "search_count" | "no_result_count";

export interface ListSearchKeywordsParams {
  keyword?: string;
  startDate?: string;
  endDate?: string;
  resultFilter?: SearchKeywordResultFilter;
  lowResultThreshold?: number;
  sortBy?: SearchKeywordSortBy;
  page?: number;
  pageSize?: number;
}

export type ExportSearchKeywordsCsvParams = Omit<
  ListSearchKeywordsParams,
  "page" | "pageSize"
>;

export interface SearchKeywordListResponse {
  total: number;
  noResultTotal: number;
  lowResultTotal: number;
  page: number;
  pageSize: number;
  items: SearchKeywordRecord[];
}

type SearchKeywordsQuery = Record<string, string | number | boolean | undefined>;
type CsvDownloadHeader = Record<string, string>;

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
    noResultCount: normalizeNumber(item.noResultCount ?? item.no_result_count),
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
    noResultTotal: normalizeNumber(payload.noResultTotal ?? payload.no_result_total),
    lowResultTotal: normalizeNumber(payload.lowResultTotal ?? payload.low_result_total),
    page: normalizeNumber(payload.page, 1),
    pageSize: normalizeNumber(payload.pageSize ?? payload.page_size, rawItems.length),
    items: rawItems.map((item) => normalizeKeyword(item)),
  };
}

function buildSearchKeywordsQuery(
  params: ListSearchKeywordsParams = {},
  includePagination: boolean,
): SearchKeywordsQuery {
  return {
    keyword: params.keyword,
    start_date: params.startDate,
    end_date: params.endDate,
    result_filter: params.resultFilter,
    low_result_threshold: params.lowResultThreshold,
    sort_by: params.sortBy,
    page: includePagination ? params.page : undefined,
    page_size: includePagination ? params.pageSize : undefined,
  };
}

function appendQueryEntry(
  pairs: string[],
  key: string,
  value: string | number | boolean,
): void {
  pairs.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
}

function buildQueryString(query: SearchKeywordsQuery): string {
  const pairs: string[] = [];
  const keys = Object.keys(query);

  for (let index = 0; index < keys.length; index += 1) {
    const key = keys[index];
    const value = query[key];

    if (value === undefined) {
      continue;
    }

    appendQueryEntry(pairs, key, value);
  }

  return pairs.join("&");
}

function appendQueryToUrl(url: string, query: SearchKeywordsQuery): string {
  const queryString = buildQueryString(query);
  if (!queryString) {
    return url;
  }

  const connector = url.includes("?") ? "&" : "?";
  return `${url}${connector}${queryString}`;
}

function resolveCsvDownloadHeader(): CsvDownloadHeader {
  const accessToken = getAccessToken();
  if (!accessToken) {
    authService.onAuthExpired();
    throw new RequestError("Please login first", {
      statusCode: 401,
      code: "AUTH_REQUIRED_NO_TOKEN",
    });
  }

  const tokenType = getSession()?.tokenType || "Bearer";
  return {
    Authorization: `${tokenType} ${accessToken}`,
  };
}

function buildCsvDownloadUrl(params: ExportSearchKeywordsCsvParams = {}): string {
  const exportUrl = buildAbsoluteApiUrl(SEARCH_KEYWORDS_API_CONFIG.ADMIN_EXPORT_PATH);
  if (!exportUrl) {
    throw new RequestError("CSV export url is invalid");
  }

  return appendQueryToUrl(exportUrl, buildSearchKeywordsQuery(params, false));
}

export async function listSearchKeywords(
  params: ListSearchKeywordsParams = {},
): Promise<SearchKeywordListResponse> {
  const raw = await request<unknown>({
    url: SEARCH_KEYWORDS_API_CONFIG.ADMIN_LIST_PATH,
    method: "GET",
    query: buildSearchKeywordsQuery(params, true),
    authMode: "required",
  });

  return normalizeListResponse(raw);
}

export async function downloadSearchKeywordsCsv(
  params: ExportSearchKeywordsCsvParams = {},
): Promise<string> {
  const url = buildCsvDownloadUrl(params);
  const header = resolveCsvDownloadHeader();

  return new Promise((resolve, reject) => {
    wx.downloadFile({
      url,
      header,
      success: (response) => {
        if (response.statusCode === 401) {
          authService.onAuthExpired();
          reject(new RequestError("Please login first", {
            statusCode: 401,
            code: 401,
            data: response,
          }));
          return;
        }

        if (response.statusCode !== 200 || !response.tempFilePath) {
          reject(new RequestError(`CSV export failed (HTTP ${response.statusCode})`, {
            statusCode: response.statusCode,
            data: response,
          }));
          return;
        }

        resolve(response.tempFilePath);
      },
      fail: (error) => {
        reject(new RequestError(String(error.errMsg || "CSV export failed"), {
          data: error,
        }));
      },
    });
  });
}
