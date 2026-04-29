/**
 * Safe numeric and array helpers to avoid NaN, negative, or undefined crashes.
 */

/** Coerce to number; use fallback for NaN/undefined/null; optionally clamp to [min, max]. */
export function safeNum(
  value: unknown,
  fallback: number,
  min?: number,
  max?: number
): number {
  const n = Number(value)
  const safe = Number.isFinite(n) ? n : fallback
  if (min !== undefined && safe < min) return min
  if (max !== undefined && safe > max) return max
  return safe
}

/** Return the array or a safe empty array (never undefined for .map()). */
export function safeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? value : []
}
