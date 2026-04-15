export type AuthMode = "none" | "optional" | "required";

export type RequestMethod = "GET" | "POST" | "PUT" | "DELETE";

export type RequestHeader = Record<string, string>;

export type RequestData =
  | WechatMiniprogram.IAnyObject
  | string
  | ArrayBuffer
  | undefined;

export type RequestQueryPrimitive = string | number | boolean;

export type RequestQueryValue =
  | RequestQueryPrimitive
  | RequestQueryPrimitive[]
  | null
  | undefined;

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
  unwrapData?: boolean;
  authMode?: AuthMode;
  skip401Handler?: boolean;
}

export interface ApiEnvelope<TData = unknown> {
  code?: number | string;
  success?: boolean;
  message?: string;
  msg?: string;
  error?: string;
  data?: TData;
}
