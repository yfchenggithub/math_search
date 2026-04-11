/**
 * API 层通用类型定义。
 *
 * 这层的职责是把“接口契约”单独放出来，
 * 避免类型散落在页面和请求工具里，后续扩展接口也更容易维护。
 */
export type RequestMethod = "GET" | "POST";

export type RequestHeader = Record<string, string>;

export type RequestData = WechatMiniprogram.IAnyObject | string | ArrayBuffer;

export interface RequestOptions<TData = RequestData> {
  url: string;
  method?: RequestMethod;
  data?: TData;
  header?: RequestHeader;
  timeout?: number;
}

/**
 * 兼容常见后端返回字段，供 request 层做基础业务异常兜底。
 * 当前不会强制页面依赖该结构，只在底层用于判错。
 */
export interface ApiBusinessMeta {
  code?: number | string;
  success?: boolean;
  message?: string;
  msg?: string;
  error?: string;
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

