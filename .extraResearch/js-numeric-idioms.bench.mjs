// Throwaway micro-benchmark of number idioms in hot loops. Runs in node (V8) and, pasted into a page, in Firefox (SpiderMonkey).
// Each idiom is its own function over the same Float64Array; the sum defeats dead-code elimination. Reports the best of REPS, ns per element.
const N = 1 << 20;
const REPS = 15;
const mixed = new Float64Array(N); // reals of both signs, some integers, some zeros
const nonneg = new Float64Array(N); // [0, 1000)
const sparse = new Float64Array(N); // 1 % NaN, 1 % -0
let seed = 12345;
const rnd = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) | 0) >>> 0) / 4294967296;
for (let i = 0; i < N; i++) {
  const r = rnd();
  mixed[i] = (r - 0.5) * 2000;
  nonneg[i] = r * 1000;
  const k = rnd();
  sparse[i] = k < 0.01 ? NaN : k < 0.02 ? -0 : (r - 0.5) * 2000;
}
const B = mixed.slice().reverse();

const cases = {
  // NaN tests (count NaNs)
  "nan: x !== x": (a) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i]; if (x !== x) s++; } return s; },
  "nan: Number.isNaN(x)": (a) => { let s = 0; for (let i = 0; i < N; i++) if (Number.isNaN(a[i])) s++; return s; },
  "nan: isNaN(x)": (a) => { let s = 0; for (let i = 0; i < N; i++) if (isNaN(a[i])) s++; return s; },
  // -0 normalise (sum of 1/x signs proves the zero's sign)
  "-0: x + 0": (a) => { let s = 0; for (let i = 0; i < N; i++) s += a[i] + 0; return s; },
  "-0: x === 0 ? 0 : x": (a) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i]; s += x === 0 ? 0 : x; } return s; },
  "-0: Object.is(x, -0) ? 0 : x": (a) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i]; s += Object.is(x, -0) ? 0 : x; } return s; },
  "-0: baseline (x)": (a) => { let s = 0; for (let i = 0; i < N; i++) s += a[i]; return s; },
  // truncation toward zero
  "trunc: ~~x": (a) => { let s = 0; for (let i = 0; i < N; i++) s += ~~a[i]; return s; },
  "trunc: x | 0": (a) => { let s = 0; for (let i = 0; i < N; i++) s += a[i] | 0; return s; },
  "trunc: x >> 0": (a) => { let s = 0; for (let i = 0; i < N; i++) s += a[i] >> 0; return s; },
  "trunc: Math.trunc(x)": (a) => { let s = 0; for (let i = 0; i < N; i++) s += Math.trunc(a[i]); return s; },
  // floor (non-negative input, where floor === trunc)
  "floor+: Math.floor(x)": (a) => { let s = 0; for (let i = 0; i < N; i++) s += Math.floor(a[i]); return s; },
  "floor+: x | 0": (a) => { let s = 0; for (let i = 0; i < N; i++) s += a[i] | 0; return s; },
  "floor+: x >>> 0": (a) => { let s = 0; for (let i = 0; i < N; i++) s += a[i] >>> 0; return s; },
  // floor used as an array index (the common real use)
  "index: t[Math.floor(x)]": (a, _b, t) => { let s = 0; for (let i = 0; i < N; i++) s += t[Math.floor(a[i])]; return s; },
  "index: t[x | 0]": (a, _b, t) => { let s = 0; for (let i = 0; i < N; i++) s += t[a[i] | 0]; return s; },
  // round (non-negative)
  "round+: Math.round(x)": (a) => { let s = 0; for (let i = 0; i < N; i++) s += Math.round(a[i]); return s; },
  "round+: (x + 0.5) | 0": (a) => { let s = 0; for (let i = 0; i < N; i++) s += (a[i] + 0.5) | 0; return s; },
  // max / min / clamp / abs / sign
  "max: Math.max(a, b)": (a, b) => { let s = 0; for (let i = 0; i < N; i++) s += Math.max(a[i], b[i]); return s; },
  "max: a > b ? a : b": (a, b) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i], y = b[i]; s += x > y ? x : y; } return s; },
  "min: Math.min(a, b)": (a, b) => { let s = 0; for (let i = 0; i < N; i++) s += Math.min(a[i], b[i]); return s; },
  "min: a < b ? a : b": (a, b) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i], y = b[i]; s += x < y ? x : y; } return s; },
  "clamp: Math.min(1, Math.max(0, x))": (a) => { let s = 0; for (let i = 0; i < N; i++) s += Math.min(1, Math.max(0, a[i] * 0.001)); return s; },
  "clamp: x < 0 ? 0 : x > 1 ? 1 : x": (a) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i] * 0.001; s += x < 0 ? 0 : x > 1 ? 1 : x; } return s; },
  "abs: Math.abs(x)": (a) => { let s = 0; for (let i = 0; i < N; i++) s += Math.abs(a[i]); return s; },
  "abs: x < 0 ? -x : x": (a) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i]; s += x < 0 ? -x : x; } return s; },
  "sign: Math.sign(x)": (a) => { let s = 0; for (let i = 0; i < N; i++) s += Math.sign(a[i]); return s; },
  "sign: (x > 0) - (x < 0)": (a) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i]; s += (x > 0) - (x < 0); } return s; },
  "sign: x > 0 ? 1 : x < 0 ? -1 : 0": (a) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i]; s += x > 0 ? 1 : x < 0 ? -1 : 0; } return s; },
  // length
  "len2: Math.hypot(x, y)": (a, b) => { let s = 0; for (let i = 0; i < N; i++) s += Math.hypot(a[i], b[i]); return s; },
  "len2: Math.sqrt(x*x + y*y)": (a, b) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i], y = b[i]; s += Math.sqrt(x * x + y * y); } return s; },
  // float32 rounding
  "f32: Math.fround(x)": (a) => { let s = 0; for (let i = 0; i < N; i++) s += Math.fround(a[i]); return s; },
  // squaring / powers
  "pow: x ** 2": (a) => { let s = 0; for (let i = 0; i < N; i++) s += a[i] ** 2; return s; },
  "pow: Math.pow(x, 2)": (a) => { let s = 0; for (let i = 0; i < N; i++) s += Math.pow(a[i], 2); return s; },
  "pow: x * x": (a) => { let s = 0; for (let i = 0; i < N; i++) { const x = a[i]; s += x * x; } return s; },
  // integer division / modulo by a power of two (non-negative ints)
  "mod8: (x | 0) % 8": (a) => { let s = 0; for (let i = 0; i < N; i++) s += (a[i] | 0) % 8; return s; },
  "mod8: (x | 0) & 7": (a) => { let s = 0; for (let i = 0; i < N; i++) s += (a[i] | 0) & 7; return s; },
  "div8: Math.floor(x / 8)": (a) => { let s = 0; for (let i = 0; i < N; i++) s += Math.floor(a[i] / 8); return s; },
  "div8: (x | 0) >> 3": (a) => { let s = 0; for (let i = 0; i < N; i++) s += (a[i] | 0) >> 3; return s; },
};
const inputOf = (name) => (name.startsWith("nan") || name.startsWith("-0") ? sparse : /^(floor\+|round\+|index|mod8|div8)/.test(name) ? nonneg : mixed);
const table = new Float64Array(1024).map((_, i) => i * 0.5);
const now = typeof performance !== "undefined" ? () => performance.now() : () => Date.now();
const best = {}, sums = {};
const names = Object.keys(cases);
for (let w = 0; w < 3; w++) for (const n of names) cases[n](inputOf(n), B, table); // warm up
for (let r = 0; r < REPS; r++) {
  for (const n of names) {
    const t0 = now();
    sums[n] = cases[n](inputOf(n), B, table);
    const dt = now() - t0;
    if (!(best[n] <= dt)) best[n] = dt;
  }
}
const out = names.map((n) => `${((best[n] * 1e6) / N).toFixed(2).padStart(6)} ns  ${n}   [sum ${Number(sums[n]).toPrecision(8)}]`).join("\n");
if (typeof console !== "undefined") console.log(out);
globalThis.__numhacks = out;
