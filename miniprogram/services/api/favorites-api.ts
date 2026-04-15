import { request } from "../request/request";

export interface FavoriteRecord {
  id: string;
  title: string;
  module: string;
  moduleLabel: string;
  tags: string[];
  summary: string;
  favoritedAt: string;
  pdfAvailable: boolean;
}

export interface FavoritesListResponse {
  list: FavoriteRecord[];
  total: number;
}

export interface GetFavoritesListParams {
  page?: number;
  pageSize?: number;
  module?: string;
  keyword?: string;
  sort?: "recent" | "title";
}

export interface AddFavoriteRequest {
  conclusion_id: string;
}

type FavoritesListQuery = Record<string, string | number | boolean | undefined>;

interface FavoritesListRawResponse {
  list?: unknown[];
  items?: unknown[];
  total?: number;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function normalizeFavoriteRecord(raw: unknown): FavoriteRecord | null {
  if (!isPlainObject(raw)) {
    return null;
  }

  const id = String(raw.id || raw.conclusion_id || "").trim();
  if (!id) {
    return null;
  }

  const module = String(raw.module || "function").trim() || "function";
  const tags = Array.isArray(raw.tags)
    ? raw.tags
      .map((item) => String(item || "").trim())
      .filter((item) => Boolean(item))
    : [];

  return {
    id,
    title: String(raw.title || "未命名结论").trim() || "未命名结论",
    module,
    moduleLabel: String(raw.moduleLabel || raw.module_label || module).trim() || module,
    tags,
    summary: String(raw.summary || "").trim(),
    favoritedAt: String(raw.favoritedAt || raw.favorited_at || "").trim(),
    pdfAvailable: Boolean(raw.pdfAvailable ?? raw.pdf_available),
  };
}

function normalizeFavoritesListResponse(raw: unknown): FavoritesListResponse {
  if (!isPlainObject(raw)) {
    return {
      list: [],
      total: 0,
    };
  }

  const rawList = Array.isArray(raw.list)
    ? raw.list
    : (Array.isArray(raw.items) ? raw.items : []);

  const list = rawList
    .map((item) => normalizeFavoriteRecord(item))
    .filter((item): item is FavoriteRecord => Boolean(item));

  const total = typeof raw.total === "number" ? raw.total : list.length;

  return {
    list,
    total,
  };
}

export async function getFavoritesList(
  query: GetFavoritesListParams = {},
): Promise<FavoritesListResponse> {
  const requestQuery: FavoritesListQuery = {
    page: query.page,
    pageSize: query.pageSize,
    module: query.module,
    keyword: query.keyword,
    sort: query.sort,
  };

  const raw = await request<FavoritesListRawResponse>({
    url: "/api/v1/favorites",
    method: "GET",
    query: requestQuery,
    authMode: "required",
  });

  return normalizeFavoritesListResponse(raw);
}

export function addFavorite(payload: AddFavoriteRequest): Promise<void> {
  return request<void, AddFavoriteRequest>({
    url: "/api/v1/favorites",
    method: "POST",
    data: payload,
    authMode: "required",
  });
}

export function removeFavorite(conclusionId: string): Promise<void> {
  const id = encodeURIComponent(String(conclusionId || "").trim());

  return request<void>({
    url: `/api/v1/favorites/${id}`,
    method: "DELETE",
    authMode: "required",
  });
}
