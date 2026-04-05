// data/content/registry.ts

// 导入具体的结论模块（假设每个模块导出的是一个对象或数组）
const core_index = require("../index/core_index.js");
const suggest_index = require("../index/suggest_index.js");
const rank_index = require("../index/rank_index.js");
const inequality = require("./inequality.js");
// const vector = require("./vector.js");

// 定义一个类型映射，方便后续在 loadContent 中使用
export const ContentMap = {
  inequality, // 不等式
  // vector, // 向量
  // 随着结论增加，在这里持续添加映射
  core_index,
  suggest_index,
  rank_index,
} as const;

// 导出 Key 的联合类型，例如 "inequality" | "vectors" | "conic"
export type ContentType = keyof typeof ContentMap;
