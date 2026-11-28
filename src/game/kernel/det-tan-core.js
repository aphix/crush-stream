import { detCos, detSin } from "./physics-core.js";

// fdlibm's reduction by π/2 (Cody-Waite) and __kernel_tan, in + − × ÷ and Math.abs/floor, with a typed-array low-word clear: the same bits in every engine.
const INV_PIO2 = 2 / Math.PI;
const PIO4 = Math.PI / 4;
/** π/2 to 60 decimals, as an integer: the three Cody-Waite parts below come from it in BigInt, which is exact in every engine. */
const HALF_PI_DIGITS = 1570796326794896619231321691639751442098584699687552910487472n;
const HALF_PI_BITS = 200;
/** The 33 leading bits of the positive integer `rem` (a head whose product with a quarter-turn count below 2^20 is exact), the rest rounded to a double, and the rest. */
function splitHead(rem) {
  const shift = BigInt(rem.toString(2).length - 33);
  const head = (rem >> shift) << shift;
  return [Number(head >> shift) * 2 ** (Number(shift) - HALF_PI_BITS), Number(rem - head) * 2 ** -HALF_PI_BITS, rem - head];
}
const [PIO2_1, PIO2_1T, REST_1] = splitHead((HALF_PI_DIGITS * 2n ** BigInt(HALF_PI_BITS)) / 10n ** 60n);
const [PIO2_2, PIO2_2T, REST_2] = splitHead(REST_1);
const [PIO2_3, PIO2_3T] = splitHead(REST_2);
/** π/4 minus its double: what the shifted kernel adds back so tan(π/4 − x) keeps the bits a double cannot hold. */
const PIO4_LO = 3.06161699786838301793e-17;
/** fdlibm's switch (high word 0x3FE59428) to tan(π/4 − x) = (1 − t)/(1 + t). */
const SHIFT_AT = 0.6743354797363281;
/** Past this the quarter-turn count would leave the range where `n * PIO2_1` is exact; detSin/detCos take over. */
const REDUCE_LIMIT = 1.6e6;
const T0 = 3.33333333333334091986e-1;
const T1 = 1.33333333333201242699e-1;
const T2 = 5.39682539762260521377e-2;
const T3 = 2.18694882948595424599e-2;
const T4 = 8.86323982359930005737e-3;
const T5 = 3.59207910759131235356e-3;
const T6 = 1.45620945432529025516e-3;
const T7 = 5.88041240820264096874e-4;
const T8 = 2.46463134818469906812e-4;
const T9 = 7.81794442939557092300e-5;
const T10 = 7.14072491382608190305e-5;
const T11 = -1.85586374855275456654e-5;
const T12 = 2.59073051863633712884e-5;

/** The scratch pair `lowWordCleared` writes through: no allocation per call. */
const scratch = new Float64Array(1);
const scratchWords = new Uint32Array(scratch.buffer);
/** Index of a double's low 32-bit word in `scratchWords`, whatever the platform's byte order. */
const LOW_WORD = ((scratch[0] = 1), scratchWords[1] === 0x3ff00000 ? 0 : 1);

/** `v` with its low 32-bit word zeroed, as fdlibm's `SET_LOW_WORD(v, 0)`: exact in every engine. */
function lowWordCleared(v) {
  scratch[0] = v;
  scratchWords[LOW_WORD] = 0;
  return scratch[0];
}

/** tan(x) for x ≥ 0 (or -1/tan(x) when `odd`, the odd quarter turns), x = a + b with b the tail of a. */
function kernelTan(a, b, odd) {
  let x = a;
  let y = b;
  const shifted = Math.abs(x) >= SHIFT_AT;
  const negative = x < 0;
  if (shifted) {
    if (negative) {
      x = -x;
      y = -y;
    }
    x = PIO4 - x + (PIO4_LO - y);
    y = 0;
  }
  const z = x * x;
  const w = z * z;
  const s = z * x;
  const r0 = T1 + w * (T3 + w * (T5 + w * (T7 + w * (T9 + w * T11))));
  const v = z * (T2 + w * (T4 + w * (T6 + w * (T8 + w * (T10 + w * T12)))));
  let r = y + z * (s * (r0 + v) + y);
  r += T0 * s;
  const t = x + r;
  if (shifted) {
    const k = odd ? -1 : 1;
    return (negative ? -1 : 1) * (k - 2 * (x - (t * t / (t + k) - r)));
  }
  if (!odd) return t;
  // -1/t with the quotient's head and tail split, so the odd quarter turns lose no bit to the division.
  const head = lowWordCleared(t);
  const tail = r - (head - x);
  const q = -1 / t;
  const qHead = lowWordCleared(q);
  const e = 1 + qHead * head;
  return qHead + q * (e + qHead * tail);
}

/** tan(x), the same bits in every engine; within 1 ulp of the correctly rounded value; NaN for non-finite x, ±0 as itself. */
export function detTan(x) {
  if (x === 0) return x;
  const ax = Math.abs(x);
  if (ax <= PIO4) return kernelTan(x, 0, false);
  if (!(ax < REDUCE_LIMIT)) return detSin(x) / detCos(x);
  const n = Math.floor(ax * INV_PIO2 + 0.5);
  let r = ax - n * PIO2_1;
  let w = n * PIO2_1T;
  let y0 = r - w;
  // fdlibm's exponent gaps (16 and 49 bits lost) as magnitudes: refine with the 2nd and 3rd parts of π/2 only after a cancellation.
  if (Math.abs(y0) < ax * 1.52587890625e-5) {
    let t = r;
    w = n * PIO2_2;
    r = t - w;
    w = n * PIO2_2T - ((t - r) - w);
    y0 = r - w;
    if (Math.abs(y0) < ax * 1.7763568394002505e-15) {
      t = r;
      w = n * PIO2_3;
      r = t - w;
      w = n * PIO2_3T - ((t - r) - w);
      y0 = r - w;
    }
  }
  const tan = kernelTan(y0, r - y0 - w, (n & 1) === 1);
  return x < 0 ? -tan : tan;
}
