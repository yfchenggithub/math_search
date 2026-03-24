// utils/data-loader.ts
import { ContentMap, ContentType } from '../data/content/registry';

/**
 * 封装加载函数
 * @param name 结论的唯一标识符
 * @returns 对应的数学结论数据
 */
export function loadContent<T = any>(name: ContentType): T {
  try {
    const data = ContentMap[name];
    if (!data) {
      throw new Error(`Content [${name}] not found in ContentMap`);
    }
    console.log("加载数学内容成功:", name)
    return data as T;
  } catch (e) {
    console.error("加载数学内容失败:", name, e);
    return {} as T;
  }
}