/**
 * API 层公共类型定义。
 */
export type RequestMethod = "GET" | "POST" | "DELETE";

export type RequestHeader = Record<string, string>;

export type RequestData = WechatMiniprogram.IAnyObject | string | ArrayBuffer;

export type RequestQueryPrimitive = string | number | boolean;

export type RequestQueryValue =
  | RequestQueryPrimitive
  | null
  | undefined
  | RequestQueryPrimitive[];

export type RequestQuery = Record<string, RequestQueryValue>;

export interface RequestOptions<
  TData = RequestData,
  TQuery extends RequestQuery = RequestQuery,
> {
  url: string;
  method?: RequestMethod;
  data?: TData;
  query?: TQuery;
  header?: RequestHeader;
  timeout?: number;
  /**
   * 是否自动对 `{ code, message, data }` 结构做 data 解包。
   * 默认 `true`。
   */
  unwrapData?: boolean;
}

/**
 * request 层用于业务判错与自动解包的通用接口结构。
 */
export interface ApiBusinessMeta {
  code?: number | string;
  success?: boolean;
  message?: string;
  msg?: string;
  error?: string;
}

export interface ApiEnvelope<TData = unknown> extends ApiBusinessMeta {
  data?: TData;
}

export interface SearchParams {
  q: string;
  module?: string;
  limit?: number;
  offset?: number;
}

export interface SearchItem {
  id: string;
  title: string;
  module: string;
  snippet?: string;
  score?: number;
}

export interface SearchResponse {
  list: SearchItem[];
  total: number;
}

export interface SuggestResponse {
  suggestions: string[];
}

export interface ConclusionDetail {
  id: string;
  title: string;
  module: string;
  statement?: string;
  explanation?: string;
  proof?: string;
  examples?: string;
  traps?: string;
  summary?: string;
}
