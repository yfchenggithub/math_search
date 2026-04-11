import { loadContent } from "./data-loader";

const inequality = loadContent("inequality");
// 后续可继续扩展更多模块：
// const vector = loadContent("vector");
// const trig = loadContent("trigonometry");

/**
 * 本地内容映射。
 * 当前主要用于本地详情与兜底链路，不作为远程搜索主数据源。
 */
export const CONTENT_MAP = {
  inequality,
  // vector,
  // trig,
} as Record<string, Record<string, unknown>>;
