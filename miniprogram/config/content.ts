/**
 * 内容白名单（唯一数据源）
 * 目的：
 * 1. 防止用户篡改 URL
 * 2. 控制所有可访问内容
 * 3. 为后续扩展（接口 / CDN）做准备
 */
export const CONTENT_CONFIG = {
  inequality: ["001", "002", "003"],
  vector: ["001", "002", "003"],
};

/**
 * 获取合法 module 列表
 */
export function getValidModules(): string[] {
  return Object.keys(CONTENT_CONFIG);
}

/**
 * 判断 id 是否存在
 */
export function isValidId(module: string, id: string): boolean {
  if (!(module in CONTENT_CONFIG)) return false;
  return CONTENT_CONFIG[module as keyof typeof CONTENT_CONFIG].includes(id);
}
