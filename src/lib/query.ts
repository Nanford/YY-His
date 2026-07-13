/**
 * INPUT:  Next.js PageProps 中的查询参数值（字符串、重复参数数组或 undefined）
 * OUTPUT: 可安全消费的单个字符串值
 * POS:    页面查询参数的统一归一化入口，避免重复 query key 导致运行时类型错误。
 */

export type QueryValue = string | string[] | undefined;

/** 重复查询参数取第一个值；空数组与缺失参数统一返回 undefined。 */
export function firstQueryValue(value: QueryValue): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}
