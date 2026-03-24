import { loadContent } from "./data-loader";

const inequality = loadContent("inequality");
// 后面可以扩展
// const vector = loadContent("vector");
// const trig = loadContent("trigonometry");

export const CONTENT_MAP = {
  inequality,
  // vector,
  // trig,
} as Record<string, Record<string, any>>;
