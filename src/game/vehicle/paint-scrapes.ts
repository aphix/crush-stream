import * as THREE from "three";
import { CAR_SPRAY, sprayFace, sprayPlace } from "./spray-box.ts";

/** Strokes a car keeps (6 bytes each): a full list merges its two nearest strokes on one face to make room, so a new scrape always shows. */
export const SCRAPE_MAX = 32;
export const STROKE_BYTES = 6;
/** A stroke's bytes: texel column and row of each end on its face, the face (3 bits) with the width quantum (5 bits above it), and the severity. */
const U0 = 0;
const U1 = 1;
const V0 = 2;
const V1 = 3;
const FACE_WIDTH = 4;
const SEVERITY = 5;
const FACE_BITS = 3;
const FACE_MASK = 7;
const WIDTH_QUANTA = 31;
/** A width quantum (m): a stroke `q` wide is `(q + 1)` of them, 6.5 to 208 mm (a flank texel is 18 mm, so a hairline's width below one is the stamp's minimum either way). */
const WIDTH_STEP = 0.0065;

/** A slide pressing softer than this (m/s of strength × cut) only rubs: a lean leaves the paint as it was. */
const STRENGTH_MIN = 0.75;
/** Band widths (m): a press up to `S_HAIR` cuts hairlines `W_MIN` wide, a harder one a band `W_PER_STRENGTH` wider per m/s past it, to `W_MAX` (sideswipe estimates: a light brush 5-30 mm, a firm sideswipe 20-100 mm, a hard grind 50-200 mm): the owner's "deeper slides scrape off a wider line". */
const W_MIN = WIDTH_STEP;
const W_MAX = 0.2;
const S_HAIR = 1.85;
const W_PER_STRENGTH = 0.25;
/** A slide's severity at the softest press, as a share of a hard one's, and the strength (m/s) at which it is full; the striker's cut scales it (a black bumper's 0.4 leaves faint primer where chrome cuts to steel). */
const V_MIN = 0.35;
const S_FULL = 3;
/** Two commits of one face's episode within this many width quanta and severity steps of each other are one stroke, at the harder of the two. */
const SAME_WIDTH = 2;
const SAME_SEVERITY = 32;
/** An episode's patch ends lie at most this far (m) either side of the contact point along the slide. */
const EPISODE_HALF_MAX = 0.3;
/** Sim seconds between commits of an open episode: a straight 1 s sideswipe changes the list at most about 5 times. */
const SCRATCH_COMMIT_S = 0.2;
/** A commit extends the face's last stroke in place when its new end runs within this angle of it: cos 15°. */
const CONTINUE_COS = 0.9659258262890683;

/** Per face tracker doubles: whether an episode is open, the last committed end and the pending end (texels), the sums of its slices' strength × cut and severity share and their count since the last commit, the clock since the last commit, whether it was scraped this slice, and the stroke it extends (-1 none). */
const OPEN = 0;
const LAST_U = 1;
const LAST_V = 2;
const PEND_U = 3;
const PEND_V = 4;
const PRESS_SUM = 5;
const SEVERITY_SUM = 6;
const PRESSES = 7;
const CLOCK = 8;
const SEEN = 9;
const STROKE = 10;
const TRACK_EACH = 11;
const FACES = CAR_SPRAY.faces.length;
/** The tracker's doubles: replay state (`partState`), never the net's. */
export const SCRAPE_TRACK = FACES * TRACK_EACH;

/** Metres per texel across (`2 × face`) and up (`2 × face + 1`) each face: `CAR_SPRAY`'s box over its faces' texels; flat, so the hot reads destructure nothing. */
const FACE_METRES = Float64Array.from(
  CAR_SPRAY.faces.flatMap(([, , w, h], face) => {
    const span = (axis: number) => CAR_SPRAY.max[axis]! - CAR_SPRAY.min[axis]!;
    const [across, up] = face < 2 ? [2, 1] : face === 2 ? [2, 0] : [0, 1];
    return [span(across) / w, span(up) / h];
  }),
);

const _uv = new Float64Array(2);
const _end = new THREE.Vector3();
/** `gap`'s out: returned, its double was boxed on every pair of the merge loop (`gap` is past the inlining budget). */
const _gap = new Float64Array(1);

/**
 * A car's paint scratches as data: at most `SCRAPE_MAX` strokes on the faces of its `CAR_SPRAY` box, each two texel ends, a
 * width and a severity, made by slides (`scrape`) and committed by `slice`, plus the per-face episode tracker. Sim state: it
 * rides the wreck section and the keyframe; nothing in physics reads it. `version` moves on every change of the list.
 */
export class PaintScrapes {
  readonly list = new Uint8Array(SCRAPE_MAX * STROKE_BYTES);
  count = 0;
  version = 0;
  readonly track = new Float64Array(SCRAPE_TRACK);

  /** A slide at rest point `p` (outward rest normal `n`) along unit plan direction `dir` (x, z), patch `half` m either side, pressing at `strength` m/s with cut `cut`: feeds that face's episode. Vectors in: a call TurboFan doesn't inline boxes every double argument. */
  scrape(p: THREE.Vector3, n: THREE.Vector3, dir: THREE.Vector3, half: number, strength: number, cut: number): void {
    const press = strength * cut;
    if (press < STRENGTH_MIN) return;
    const reach = Math.min(half, EPISODE_HALF_MAX);
    // The face is the normal's alone, so one call finds it and places the pending end: each call site spends the inlining budget.
    _end.x = p.x + dir.x * reach;
    _end.y = p.y;
    _end.z = p.z + dir.z * reach;
    const face = sprayFace(CAR_SPRAY, _end, n, _uv);
    if (face < 0) return;
    const t = this.track;
    const o = face * TRACK_EACH;
    t[o + PEND_U] = texelOf(_uv[0]!, CAR_SPRAY.faces[face]![2]);
    t[o + PEND_V] = texelOf(_uv[1]!, CAR_SPRAY.faces[face]![3]);
    t[o + SEEN] = 1;
    t[o + PRESS_SUM] = t[o + PRESS_SUM]! + press;
    // The severity share (`V_MIN` to 1 by strength, before the cut) inline: an uninlined helper's double return is boxed.
    const x = Math.min(1, Math.max(0, (strength - STRENGTH_MIN) / (S_FULL - STRENGTH_MIN)));
    t[o + SEVERITY_SUM] = t[o + SEVERITY_SUM]! + cut * (V_MIN + (1 - V_MIN) * x * x * (3 - 2 * x));
    t[o + PRESSES] = t[o + PRESSES]! + 1;
    if (t[o + OPEN] !== 0) return;
    _end.x = p.x - dir.x * reach;
    _end.z = p.z - dir.z * reach;
    sprayPlace(CAR_SPRAY, face, _end, _uv);
    t[o + OPEN] = 1;
    t[o + LAST_U] = texelOf(_uv[0]!, CAR_SPRAY.faces[face]![2]);
    t[o + LAST_V] = texelOf(_uv[1]!, CAR_SPRAY.faces[face]![3]);
    t[o + CLOCK] = 0;
    t[o + STROKE] = -1;
  }

  /** The end of a slice of `h` s: an episode scraped in it commits once its clock passes `SCRATCH_COMMIT_S`; one not scraped commits and closes. */
  slice(h: number): void {
    const t = this.track;
    for (let face = 0; face < FACES; face++) {
      const o = face * TRACK_EACH;
      if (t[o + OPEN] === 0) continue;
      if (t[o + SEEN] === 0) {
        this.commit(face);
        t[o + OPEN] = 0;
        continue;
      }
      t[o + SEEN] = 0;
      t[o + CLOCK] = t[o + CLOCK]! + h;
      if (t[o + CLOCK]! < SCRATCH_COMMIT_S) continue;
      this.commit(face);
      t[o + CLOCK] = 0;
    }
  }

  /** No strokes and no episodes: a repaired car. */
  clear(): void {
    this.list.fill(0);
    this.count = 0;
    this.track.fill(0);
    this.version++;
  }

  /** The list as `count` strokes of `bytes` (a peer's or a record's): the version moves only if it differs. */
  load(bytes: Uint8Array, count: number): void {
    if (count > SCRAPE_MAX) throw new RangeError(`${count} paint strokes, past the ${SCRAPE_MAX} a car keeps`);
    const n = count * STROKE_BYTES;
    let same = count === this.count;
    for (let i = 0; same && i < n; i++) same = this.list[i] === bytes[i];
    if (same) return;
    this.list.set(bytes.subarray(0, n));
    this.list.fill(0, n);
    this.count = count;
    this.version++;
  }

  /** The pending end into the face's last stroke when it runs on from it, else a new stroke from the last end to it; one that slid no texel is a touch, no line. */
  private commit(face: number): void {
    const t = this.track;
    const o = face * TRACK_EACH;
    if (t[o + PRESSES] === 0) return;
    // The window's mean, not its peak: a press's first-touch closing spike would cut it as wide as a shove.
    const width = scrapeWidth(t[o + PRESS_SUM]! / t[o + PRESSES]!);
    const severity = Math.max(1, Math.round(255 * Math.min(1, t[o + SEVERITY_SUM]! / t[o + PRESSES]!)));
    t[o + PRESS_SUM] = 0;
    t[o + SEVERITY_SUM] = 0;
    t[o + PRESSES] = 0;
    const u = t[o + PEND_U]!;
    const v = t[o + PEND_V]!;
    const k = t[o + STROKE]!;
    if (k >= 0 && this.runsOn(k, face, u, v, width, severity)) {
      const s = k * STROKE_BYTES;
      const l = this.list;
      const wide = Math.max(l[s + FACE_WIDTH]! >> FACE_BITS, width);
      const hard = Math.max(l[s + SEVERITY]!, severity);
      if (l[s + U1] === u && l[s + V1] === v && l[s + FACE_WIDTH]! >> FACE_BITS === wide && l[s + SEVERITY] === hard) return;
      l[s + U1] = u;
      l[s + V1] = v;
      l[s + FACE_WIDTH] = face | (wide << FACE_BITS);
      l[s + SEVERITY] = hard;
      this.version++;
    } else if (u !== t[o + LAST_U] || v !== t[o + LAST_V]) {
      t[o + STROKE] = this.append(face, t[o + LAST_U]!, t[o + LAST_V]!, u, v, width, severity);
    }
    t[o + LAST_U] = u;
    t[o + LAST_V] = v;
  }

  /** Whether stroke `k` is on `face`, near `width` and `severity`, and the end (u, v) lies within `CONTINUE_COS` of its run from its start. */
  private runsOn(k: number, face: number, u: number, v: number, width: number, severity: number): boolean {
    const s = k * STROKE_BYTES;
    const l = this.list;
    if ((l[s + FACE_WIDTH]! & FACE_MASK) !== face) return false;
    if (Math.abs((l[s + FACE_WIDTH]! >> FACE_BITS) - width) > SAME_WIDTH || Math.abs(l[s + SEVERITY]! - severity) > SAME_SEVERITY) return false;
    const mu = FACE_METRES[2 * face]!;
    const mv = FACE_METRES[2 * face + 1]!;
    const ax = (l[s + U1]! - l[s + U0]!) * mu;
    const ay = (l[s + V1]! - l[s + V0]!) * mv;
    const bx = (u - l[s + U0]!) * mu;
    const by = (v - l[s + V0]!) * mv;
    const aa = ax * ax + ay * ay;
    const bb = bx * bx + by * by;
    if (aa === 0 || bb === 0) return true;
    const dot = ax * bx + ay * by;
    return dot > 0 && dot * dot >= CONTINUE_COS * CONTINUE_COS * aa * bb;
  }

  /** A new stroke at the list's end, after merging the nearest two on one face when it is full; returns its index. */
  private append(face: number, u0: number, v0: number, u1: number, v1: number, width: number, severity: number): number {
    if (this.count === SCRAPE_MAX) this.mergeNearest();
    const k = this.count++;
    const s = k * STROKE_BYTES;
    const l = this.list;
    l[s + U0] = u0;
    l[s + U1] = u1;
    l[s + V0] = v0;
    l[s + V1] = v1;
    l[s + FACE_WIDTH] = face | (width << FACE_BITS);
    l[s + SEVERITY] = severity;
    this.version++;
    return k;
  }

  /** The two strokes on one face nearest each other become one, spanning both and wide enough to cover both, at the harder severity. */
  private mergeNearest(): void {
    let best = Infinity;
    let keep = -1;
    let gone = -1;
    for (let i = 0; i < this.count; i++) {
      for (let j = i + 1; j < this.count; j++) {
        this.gap(i, j);
        const gap = _gap[0]!;
        if (gap >= best) continue;
        best = gap;
        keep = i;
        gone = j;
      }
    }
    this.mergeInto(keep, gone);
    const last = --this.count;
    this.list.copyWithin(gone * STROKE_BYTES, last * STROKE_BYTES, (last + 1) * STROKE_BYTES);
    this.list.fill(0, last * STROKE_BYTES, (last + 1) * STROKE_BYTES);
    const t = this.track;
    for (let o = STROKE; o < SCRAPE_TRACK; o += TRACK_EACH) {
      if (t[o] === keep || t[o] === gone) t[o] = -1;
      else if (t[o] === last) t[o] = gone;
    }
  }

  /** The plan distance (m) between strokes `i` and `j` on one face, Infinity across faces, into `_gap[0]`. */
  private gap(i: number, j: number): void {
    const l = this.list;
    const a = i * STROKE_BYTES;
    const b = j * STROKE_BYTES;
    const face = l[a + FACE_WIDTH]! & FACE_MASK;
    if ((l[b + FACE_WIDTH]! & FACE_MASK) !== face) {
      _gap[0] = Infinity;
      return;
    }
    const mu = FACE_METRES[2 * face]!;
    const mv = FACE_METRES[2 * face + 1]!;
    _gap[0] = Math.min(
      pointToSegment(l[a + U0]! * mu, l[a + V0]! * mv, l[b + U0]! * mu, l[b + V0]! * mv, l[b + U1]! * mu, l[b + V1]! * mv),
      pointToSegment(l[a + U1]! * mu, l[a + V1]! * mv, l[b + U0]! * mu, l[b + V0]! * mv, l[b + U1]! * mu, l[b + V1]! * mv),
      pointToSegment(l[b + U0]! * mu, l[b + V0]! * mv, l[a + U0]! * mu, l[a + V0]! * mv, l[a + U1]! * mu, l[a + V1]! * mv),
      pointToSegment(l[b + U1]! * mu, l[b + V1]! * mv, l[a + U0]! * mu, l[a + V0]! * mv, l[a + U1]! * mu, l[a + V1]! * mv),
    );
  }

  /** Stroke `keep` as the farthest-apart two of both strokes' four ends, widened by how far the other's ends stand off that line. */
  private mergeInto(keep: number, gone: number): void {
    const l = this.list;
    const a = keep * STROKE_BYTES;
    const b = gone * STROKE_BYTES;
    const face = l[a + FACE_WIDTH]! & FACE_MASK;
    const mu = FACE_METRES[2 * face]!;
    const mv = FACE_METRES[2 * face + 1]!;
    let far = -1;
    let from = a;
    let to = a;
    let fromEnd = 0;
    let toEnd = 1;
    for (let p = 0; p < 4; p++) {
      for (let q = p + 1; q < 4; q++) {
        const ps = p < 2 ? a : b;
        const qs = q < 2 ? a : b;
        const du = (l[qs + (q & 1)]! - l[ps + (p & 1)]!) * mu;
        const dv = (l[qs + V0 + (q & 1)]! - l[ps + V0 + (p & 1)]!) * mv;
        const d = du * du + dv * dv;
        if (d <= far) continue;
        far = d;
        from = ps;
        fromEnd = p & 1;
        to = qs;
        toEnd = q & 1;
      }
    }
    const fu = l[from + fromEnd]!;
    const fv = l[from + V0 + fromEnd]!;
    const tu = l[to + toEnd]!;
    const tv = l[to + V0 + toEnd]!;
    let off = 0;
    for (let e = 0; e < 4; e++) {
      const s = e < 2 ? a : b;
      off = Math.max(off, pointToSegment(l[s + (e & 1)]! * mu, l[s + V0 + (e & 1)]! * mv, fu * mu, fv * mv, tu * mu, tv * mv));
    }
    const width = Math.min(WIDTH_QUANTA, Math.max(l[a + FACE_WIDTH]! >> FACE_BITS, l[b + FACE_WIDTH]! >> FACE_BITS) + Math.round((2 * off) / WIDTH_STEP));
    l[a + U0] = fu;
    l[a + V0] = fv;
    l[a + U1] = tu;
    l[a + V1] = tv;
    l[a + FACE_WIDTH] = (l[a + FACE_WIDTH]! & FACE_MASK) | (width << FACE_BITS);
    l[a + SEVERITY] = Math.max(l[a + SEVERITY]!, l[b + SEVERITY]!);
  }
}

/** The texel of `n` across a face that place `x` (0..1) falls in. */
function texelOf(x: number, n: number): number {
  return Math.min(n - 1, Math.floor(x * n));
}

/** The distance from (px, py) to the segment (ax, ay)-(bx, by). */
function pointToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const ll = dx * dx + dy * dy;
  const k = ll === 0 ? 0 : Math.min(1, Math.max(0, ((px - ax) * dx + (py - ay) * dy) / ll));
  const ex = px - ax - k * dx;
  const ey = py - ay - k * dy;
  return Math.sqrt(ex * ex + ey * ey);
}

/** The width quantum (`(q + 1) × WIDTH_STEP`) of a scrape pressing at `press` (strength × cut, m/s). */
function scrapeWidth(press: number): number {
  const width = Math.min(W_MAX, W_MIN + W_PER_STRENGTH * Math.max(0, press - S_HAIR));
  return Math.min(WIDTH_QUANTA, Math.round(width / WIDTH_STEP) - 1);
}
