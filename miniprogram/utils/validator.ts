import { getValidModules, isValidId } from "../config/content";

/**
 * 校验结果类型
 */
export type ValidateResult =
  | { valid: true; id: string; module: string }
  | { valid: false; reason: string };

/**
 * 校验 URL 参数
 * 目的：
 * 1. 所有外部输入必须校验
 * 2. 防止非法访问
 * 3. 提供明确错误原因
 */
export function validateOptions(
  options: Record<string, string | undefined>,
): ValidateResult {
  const id = options.id ?? "";
  const module = options.module ?? "";

  // 1️⃣ 参数缺失
  if (!id || !module) {
    return { valid: false, reason: "参数缺失" };
  }

  // 2️⃣ module 非法
  const validModules = getValidModules();
  if (!validModules.includes(module)) {
    return { valid: false, reason: "非法模块" };
  }

  // 3️⃣ id 不存在
  if (!isValidId(module, id)) {
    return { valid: false, reason: "内容不存在" };
  }

  return { valid: true, id, module };
}
