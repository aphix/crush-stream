/** `list` cut to its `k` strongest, summing to 1 (in place). */
export function strongest<T extends { w: number }>(list: T[], k: number): T[] {
  list.sort((a, b) => b.w - a.w);
  if (list.length > k) list.length = k;
  let sum = 0;
  for (const s of list) sum += s.w;
  if (sum > 1e-8) for (const s of list) s.w /= sum;
  return list;
}
