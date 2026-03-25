/**
 * 资源路径结构
 */
export type AssetPaths = {
  webp: string;
  svg: string;
  fallback: string;
};

/**
 * 生成资源路径
 * 目的：
 * - 统一资源路径规则
 * - 支持未来 CDN / 分包
 */
export function getAssetPaths(module: string, id: string) {
  return {
    webp: `/assets/webp/${module}/${id}.webp`,
    svg: `/assets/svg/${module}/${id}.svg`,
    fallback: `/assets/fallback.png`,
  };
}

export function resolveAssets(options: Record<string, string | undefined>) {
  // || 是"只要不真就换"，?? 是"只要不存在才换"
  // const id = options.id || ""; || 在"任何假值"时触发
  const id = options.id ?? ""; // ?? 只在 null / undefined 时触发
  const module = options.module ?? "";

  return getAssetPaths(module, id);
}
