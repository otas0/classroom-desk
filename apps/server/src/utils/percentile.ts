/** Inclusive percentile on a sorted ascending numeric array. */
export function percentile(sortedAsc: number[], p: number): number | null {
  if (!sortedAsc.length) return null;
  const clamped = Math.max(0, Math.min(100, p));
  if (sortedAsc.length === 1) return sortedAsc[0];
  const idx = (clamped / 100) * (sortedAsc.length - 1);
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sortedAsc[lo];
  const w = idx - lo;
  return sortedAsc[lo] * (1 - w) + sortedAsc[hi] * w;
}

export function summarizeDurations(values: number[]): {
  count: number;
  p50Ms: number | null;
  p95Ms: number | null;
  avgMs: number | null;
  minMs: number | null;
  maxMs: number | null;
} {
  const nums = values.filter((n) => Number.isFinite(n) && n >= 0).sort((a, b) => a - b);
  if (!nums.length) {
    return { count: 0, p50Ms: null, p95Ms: null, avgMs: null, minMs: null, maxMs: null };
  }
  const sum = nums.reduce((a, b) => a + b, 0);
  return {
    count: nums.length,
    p50Ms: Math.round(percentile(nums, 50) ?? 0),
    p95Ms: Math.round(percentile(nums, 95) ?? 0),
    avgMs: Math.round(sum / nums.length),
    minMs: nums[0],
    maxMs: nums[nums.length - 1],
  };
}
