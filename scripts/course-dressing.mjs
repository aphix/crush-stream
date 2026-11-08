/**
 * A course's dressing as a short program: `src/game/world/tracks/<id>.dressing.mjs` exports `(d: Dressing) => void` and starts with
 * `// base <key>: <n>` lines, the count of hand-authored entries of each array it appends to. `node --disable-warning=ExperimentalWarning
 * scripts/course-dressing.mjs <id> [--dry | --check]` truncates each array to its base and appends the program's output, as text
 * splices, so authored entries keep their index and formatting and a second run changes nothing.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { fileURLToPath, pathToFileURL } from "node:url";
import { PREFABS } from "../src/game/world/catalog.ts";
import { boxClear, mulberry32 } from "../src/game/world/placements.ts";
import { Track, blankPoint, blankProjection, pointOn, projectPath } from "../src/game/world/track.ts";
import { parseTrack } from "../src/game/world/track-schema.ts";

const TRACKS_DIR = fileURLToPath(new URL("../src/game/world/tracks/", import.meta.url));
/** Default clearance (m) from any road's wall line for everything but `onRoad`. */
const DEFAULT_ROAD_MARGIN = 6;
/** A healed prop lands this far (m) past its margin, so rounding to 0.1 m cannot take it back inside. */
const HEAL_SLACK = 0.1;
const HEAL_ROUNDS = 12;
/** A healed prop that still touches a neighbour slides along the road in steps of this many metres, up to SLIDE_STEPS each way. */
const SLIDE_STEP = 0.5;
const SLIDE_STEPS = 8;
const TRIES_PER_PROP = 40;
/** Default `fill` neighbour gap: this share of the new prop's own footprint radius. */
const PROP_GAP_SHARE = 1.2;
/** The prefabs that make sense standing on the road itself. */
const ON_ROAD = new Set(["lamp", "cone"]);

/** The arrays a program may append to, as paths into the track JSON. */
const ARRAYS = {
  props: ["props"],
  along: ["along"],
  scatter: ["scatter"],
  zones: ["scenery", "zones"],
  hills: ["environment", "hills"],
  plateaus: ["environment", "plateaus"],
  paint: ["environment", "paint"],
};

/** @typedef {{ prefab: string, x: number, z: number, yaw: number, scale: number, size?: number[] }} Placement */
/** @typedef {{ x: number, z: number, yaw: number, hw: number, hd: number, r: number }} Footprint */
/** @typedef {{ poly: number[][] } | { x: number, z: number, r: number }} Shape */
/** @typedef {number[] | number[][] | { x: number, z: number, r: number }} Region a rect [x0, z0, x1, z1], a polygon [[x, z], ...] or a circle */
/** @typedef {string | { prefab: string, weight?: number, scale?: number | number[], size?: number[] }} Item */
/** @typedef {{ deficit: number, nx: number, nz: number, why: string }} Violation */

const CATALOG = /** @type {Record<string, { size: readonly number[] }>} */ (PREFABS);
const scratch = blankProjection();

/** @param {number} v */
const r1 = (v) => Math.round(v * 10) / 10;
/** @param {number} v */
const r2 = (v) => Math.round(v * 100) / 100;
/** @param {number} v */
const r3 = (v) => Math.round(v * 1000) / 1000;
/** @param {string} id */
const hashOf = (id) => [...id].reduce((h, c) => (Math.imul(h, 31) + c.charCodeAt(0)) >>> 0, 7);

/** @param {{ prefab: string, x: number, z: number, yaw?: number, scale?: number, size?: number[] }} p @returns {Footprint} */
function footprint(p) {
  const dims = p.size ?? CATALOG[p.prefab]?.size;
  if (!dims) throw new Error(`unknown prefab ${p.prefab}`);
  const hw = (dims[0] * (p.scale ?? 1)) / 2;
  const hd = (dims[2] * (p.scale ?? 1)) / 2;
  return { x: p.x, z: p.z, yaw: p.yaw ?? 0, hw, hd, r: Math.hypot(hw, hd) };
}

/** The JSON a placement is written as: defaults left out. @param {Placement} p */
function entryOf(p) {
  const e = /** @type {Record<string, unknown>} */ ({ prefab: p.prefab, x: p.x, z: p.z });
  if (p.yaw) e.yaw = p.yaw;
  if (p.scale !== 1) e.scale = p.scale;
  if (p.size) e.size = p.size;
  return e;
}

/** @param {Region} region @returns {Shape} */
function toShape(region) {
  if (!Array.isArray(region)) return region;
  if (typeof region[0] === "number") {
    const [x0, z0, x1, z1] = /** @type {number[]} */ (region);
    return { poly: [[x0, z0], [x1, z0], [x1, z1], [x0, z1]] };
  }
  return { poly: /** @type {number[][]} */ (region) };
}

/** Signed distance (negative inside) from (x, z) to the shape's edge, and the unit normal there pointing out of the shape. @param {Shape} s @param {number} x @param {number} z */
function edge(s, x, z) {
  if (!("poly" in s)) {
    const d = Math.hypot(x - s.x, z - s.z);
    return { d: d - s.r, nx: d ? (x - s.x) / d : 1, nz: d ? (z - s.z) / d : 0 };
  }
  let best = Infinity;
  let qx = 0;
  let qz = 0;
  let inside = false;
  for (let i = 0; i < s.poly.length; i++) {
    const [ax, az] = s.poly[i];
    const [bx, bz] = s.poly[(i + 1) % s.poly.length];
    const ex = bx - ax;
    const ez = bz - az;
    const t = Math.max(0, Math.min(1, ((x - ax) * ex + (z - az) * ez) / (ex * ex + ez * ez || 1)));
    const d = Math.hypot(x - (ax + t * ex), z - (az + t * ez));
    if (d < best) {
      best = d;
      qx = ax + t * ex;
      qz = az + t * ez;
    }
    if (az > z !== bz > z && x < ax + ((z - az) / (bz - az)) * ex) inside = !inside;
  }
  const sign = inside ? -1 : 1;
  return { d: sign * best, nx: best ? (sign * (x - qx)) / best : 1, nz: best ? (sign * (z - qz)) / best : 0 };
}

/** @param {Shape} s */
function areaOf(s) {
  if (!("poly" in s)) return Math.PI * s.r * s.r;
  let twice = 0;
  for (let i = 0; i < s.poly.length; i++) {
    const [ax, az] = s.poly[i];
    const [bx, bz] = s.poly[(i + 1) % s.poly.length];
    twice += ax * bz - bx * az;
  }
  return Math.abs(twice) / 2;
}

/** @param {Shape} s @param {() => number} rng @returns {number[]} */
function randomIn(s, rng) {
  const pts = "poly" in s ? s.poly : [[s.x - s.r, s.z - s.r], [s.x + s.r, s.z + s.r]];
  const lo = [Math.min(...pts.map((p) => p[0])), Math.min(...pts.map((p) => p[1]))];
  const hi = [Math.max(...pts.map((p) => p[0])), Math.max(...pts.map((p) => p[1]))];
  for (let i = 0; i < 100; i++) {
    const x = lo[0] + rng() * (hi[0] - lo[0]);
    const z = lo[1] + rng() * (hi[1] - lo[1]);
    if (edge(s, x, z).d <= 0) return [x, z];
  }
  throw new Error("fill region has no area");
}

/** @param {any} v @returns {string} */
function inline(v) {
  if (Array.isArray(v)) return `[${v.map(inline).join(", ")}]`;
  if (v && typeof v === "object") return `{ ${Object.entries(v).map(([k, x]) => `${JSON.stringify(k)}: ${inline(x)}`).join(", ")} }`;
  return JSON.stringify(v);
}

const STRING = /"((?:[^"\\]|\\.)*)"\s*(:?)/y;

/** The `[...]` at `path` in JSON text: its bracket offsets and the offsets of each object element. @param {string} text @param {string[]} path */
function arrayAt(text, path) {
  const want = path.join("/");
  /** @type {(string | null)[]} */
  const stack = [];
  /** @type {number[]} */
  const starts = [];
  /** @type {number[]} */
  const ends = [];
  let key = null;
  let open = -1;
  let depth = -1;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      STRING.lastIndex = i;
      const m = /** @type {RegExpExecArray} */ (STRING.exec(text));
      if (m[2]) key = m[1];
      i = STRING.lastIndex - 1;
    } else if (c === "{" || c === "[") {
      stack.push(key);
      key = null;
      if (depth < 0 && c === "[" && stack.slice(1).join("/") === want) {
        open = i;
        depth = stack.length;
      } else if (depth >= 0 && c === "{" && stack.length === depth + 1) starts.push(i);
    } else if (c === "}" || c === "]") {
      if (depth >= 0 && stack.length === depth + 1) ends.push(i + 1);
      if (depth >= 0 && stack.length === depth && c === "]") return { open, close: i, starts, ends };
      stack.pop();
    } else if (c === ",") key = null;
  }
  throw new Error(`no array at ${want}`);
}

/** `text` with the array at `path` cut to its first `base` elements (verbatim) and `entries` appended in the array's own style. @param {string} text @param {string[]} path @param {number} base @param {unknown[]} entries @param {boolean} compactFile */
function spliceArray(text, path, base, entries, compactFile) {
  const { open, close, starts, ends } = arrayAt(text, path);
  if (base > starts.length) throw new Error(`${path.join(".")}: base ${base} but the course has ${starts.length}`);
  const indent = /^\s*/.exec(text.slice(text.lastIndexOf("\n", open) + 1, open))?.[0] ?? "";
  const lead = starts.length ? text.slice(open + 1, starts[0]) : `\n${indent}  `;
  const tail = starts.length ? text.slice(ends[ends.length - 1], close) : `\n${indent}`;
  const compact = starts.length ? !text.slice(starts[0], ends[0]).includes("\n") : compactFile;
  const elementIndent = lead.slice(lead.lastIndexOf("\n") + 1);
  const render = (/** @type {unknown} */ e) => (compact ? inline(e) : JSON.stringify(e, null, 2).replaceAll("\n", `\n${elementIndent}`));
  const kept = base > 0 ? [text.slice(starts[0], ends[base - 1])] : [];
  const body = [...kept, ...entries.map(render)].join(`,${lead}`);
  return text.slice(0, open + 1) + (body ? lead + body + tail : "") + text.slice(close);
}

export class Dressing {
  /** @param {string} courseId @param {{ base: Record<string, number>, dir?: string }} opts `base`: the authored entry count of each array the program appends to */
  constructor(courseId, { base, dir = TRACKS_DIR }) {
    this.courseId = courseId;
    this.base = base;
    this.text = readFileSync(`${dir}${courseId}.json`, "utf8");
    const json = JSON.parse(this.text);
    this.track = new Track(json);
    this.roadMargin = DEFAULT_ROAD_MARGIN;
    /** @type {{ name: string, shape: Shape }[]} */
    this.noGos = [];
    /** @type {Record<string, unknown[]>} */
    this.added = Object.fromEntries(Object.keys(ARRAYS).map((k) => [k, []]));
    /** @type {string[]} */
    this.notes = [];
    this.calls = 0;
    /** Every prop standing so far: the authored ones, then each placed. @type {Footprint[]} */
    this.placed = json.props.slice(0, base.props ?? json.props.length).map(footprint);
  }

  /** Default clearance (m) from every road, runoff and shortcut wall line. @param {number} margin */
  keepOutRoads(margin) {
    this.roadMargin = margin;
    return this;
  }

  /** A zone nothing is placed in from here on (a prop's footprint circle may not touch it). @param {string} name @param {Region} shape */
  noGo(name, shape) {
    this.noGos.push({ name, shape: toShape(shape) });
    return this;
  }

  /** One prop, pushed off a road or no-go and slid clear of its neighbours. @param {string} prefab @param {number} x @param {number} z @param {{ yaw?: number, scale?: number, size?: number[] }} [o] */
  prop(prefab, x, z, o = {}) {
    this.heal(`prop ${prefab}`, [{ prefab, x: r1(x), z: r1(z), yaw: r3(o.yaw ?? 0), scale: o.scale ?? 1, size: o.size }]);
    return this;
  }

  /**
   * A line of props, healed like `prop`: `every` m apart, or `count` spread evenly, else end to end with `gap` m between footprints.
   * @param {string} prefab @param {number[]} from @param {number[]} to
   * @param {{ every?: number, count?: number, gap?: number, yaw?: "along" | "perp" | number, jitter?: number, seed?: number, scale?: number, size?: number[] }} [o]
   */
  row(prefab, from, to, { every, count, gap = 0, yaw = "along", jitter = 0, seed = hashOf(this.courseId) + this.calls++, scale = 1, size } = {}) {
    const rng = mulberry32(seed);
    const len = Math.hypot(to[0] - from[0], to[1] - from[1]);
    const ux = (to[0] - from[0]) / len;
    const uz = (to[1] - from[1]) / len;
    const heading = typeof yaw === "number" ? yaw : Math.atan2(ux, uz) + (yaw === "perp" ? Math.PI / 2 : 0);
    const dims = size ?? CATALOG[prefab].size;
    const step = every ?? dims[yaw === "perp" ? 0 : 2] * scale + gap;
    const n = count ?? Math.floor(len / step) + 1;
    /** @type {Placement[]} */
    const list = [];
    for (let i = 0; i < n; i++) {
      const t = count ? (n > 1 ? (i * len) / (n - 1) : len / 2) : i * step;
      list.push({ prefab, x: r1(from[0] + ux * t + (rng() * 2 - 1) * jitter), z: r1(from[1] + uz * t + (rng() * 2 - 1) * jitter), yaw: r3(heading), scale, size });
    }
    this.heal(`row ${prefab}`, list);
    return this;
  }

  /**
   * The headline: sprinkle `items` on the band `near`..`far` m from the road wall lines, by rejection: nothing inside `near` of a road, runoff or
   * shortcut, of a no-go, or too close to another prop. `density` is props per 1000 m2 of band (default 1), or `count`.
   * @param {Item | Item[]} items a prefab id or a weighted `{ prefab, weight, scale: n | [lo, hi], size: [x, y, z] }`, or a list of them
   * @param {FillOptions} [o]
   */
  sprinkle(items, o = {}) {
    return this.fill("track", items, o);
  }

  /**
   * `sprinkle` bounded to a region (a rect, polygon or circle) or the band round the roads (`"track"`, using `near`..`far`).
   * `minProp` (m, default 1.2 x the new prop's footprint radius) is the gap between footprints; `noGo` lists extra zones for this call;
   * `seed` defaults to the course id's hash; `sizeJitter` stretches each axis of `size` (the prefab's own when the item has none) by up to that share;
   * `yaw`: `"random"`, `"road"` (along the nearest road) or radians.
   * @param {Region | "track"} region @param {Item | Item[]} items @param {FillOptions} [o]
   */
  fill(region, items, o = {}) {
    const { near = this.roadMargin, far = 60, minProp, noGo = [], sizeJitter = 0, yaw = "random" } = o;
    const rng = mulberry32(o.seed ?? hashOf(this.courseId) + this.calls++);
    const choices = [items].flat().map((i) => (typeof i === "string" ? { prefab: i } : i));
    const total = choices.reduce((sum, c) => sum + (/** @type {{ weight?: number }} */ (c).weight ?? 1), 0);
    const zones = [...this.noGos, ...noGo.map((s) => ({ name: "noGo", shape: toShape(s) }))];
    const shape = region === "track" ? null : toShape(region);
    const paths = this.track.paths();
    const lengthSum = paths.reduce((sum, p) => sum + p.length, 0);
    const area = shape ? areaOf(shape) : lengthSum * 2 * (far - near);
    const want = o.count ?? Math.round(((o.density ?? 1) * area) / 1000);
    /** @type {Record<string, number>} */
    const rejected = {};
    let got = 0;
    for (let tries = 0; got < want && tries < want * TRIES_PER_PROP; tries++) {
      let u = rng() * total;
      let item = choices[choices.length - 1];
      for (const c of choices) {
        u -= /** @type {{ weight?: number }} */ (c).weight ?? 1;
        if (u < 0) {
          item = c;
          break;
        }
      }
      const [x, z] = shape ? randomIn(shape, rng) : this.bandPoint(rng, lengthSum, near, far);
      const scaleSpec = /** @type {{ scale?: number | number[] }} */ (item).scale;
      const p = /** @type {Placement} */ ({ prefab: item.prefab, x: r1(x), z: r1(z), yaw: 0, scale: r2(Array.isArray(scaleSpec) ? scaleSpec[0] + rng() * (scaleSpec[1] - scaleSpec[0]) : (scaleSpec ?? 1)) });
      const baseSize = /** @type {{ size?: number[] }} */ (item).size ?? (sizeJitter ? CATALOG[item.prefab].size : undefined);
      if (baseSize) p.size = baseSize.map((v) => r1(v * (1 + sizeJitter * (2 * rng() - 1))));
      p.yaw = r3(yaw === "random" ? rng() * 2 * Math.PI : yaw === "road" ? Math.atan2(...this.tangent(p.x, p.z)) : yaw);
      const f = footprint(p);
      const w = this.worst(f, near, zones);
      const why = w.deficit > 0 ? w.why : this.crowded(f, minProp ?? PROP_GAP_SHARE * f.r) ? "prop" : null;
      if (why) rejected[why] = (rejected[why] ?? 0) + 1;
      else {
        this.register(p);
        got++;
      }
    }
    const names = choices.map((c) => c.prefab).join("/");
    this.notes.push(`fill ${names}: ${got}/${want} placed, rejected ${JSON.stringify(rejected)}`);
    return this;
  }

  /**
   * Props ON the main road (lamps, cones), the one thing allowed there: one every `every` m of the loop, `lane` m left of the centreline
   * (negative: right), facing along it. Only no-go zones and other props reject.
   * @param {string} prefab @param {{ every: number, lane?: number, jitter?: number, seed?: number, scale?: number }} o
   */
  onRoad(prefab, { every, lane = 0, jitter = 0, seed = hashOf(this.courseId) + this.calls++, scale = 1 }) {
    if (!ON_ROAD.has(prefab)) throw new Error(`${prefab} does not belong on a road (${[...ON_ROAD].join(", ")})`);
    const rng = mulberry32(seed);
    const path = this.track.path;
    const pt = blankPoint();
    let got = 0;
    let rejected = 0;
    for (let s = 0; s < path.length; s += every) {
      pointOn(path, s, pt);
      const x = r1(pt.x + pt.tz * lane + (rng() * 2 - 1) * jitter);
      const z = r1(pt.z - pt.tx * lane + (rng() * 2 - 1) * jitter);
      const p = { prefab, x, z, yaw: r3(Math.atan2(pt.tx, pt.tz)), scale };
      const f = footprint(p);
      if (this.worst(f, -Infinity, this.noGos).deficit > 0 || this.crowded(f, 0)) rejected++;
      else {
        this.register(p);
        got++;
      }
    }
    this.notes.push(`onRoad ${prefab}: ${got} placed, ${rejected} rejected`);
    return this;
  }

  /** Scenery biome box. @param {number} x0 @param {number} z0 @param {number} x1 @param {number} z1 @param {string} biome */
  zone(x0, z0, x1, z1, biome) {
    return this.add("zones", { x0, z0, x1, z1, biome });
  }

  /** @param {number} x @param {number} z @param {number} radius @param {number} height */
  hill(x, z, radius, height) {
    return this.add("hills", { x, z, radius, height });
  }

  /** @param {Record<string, unknown>} plateau as the track schema's `environment.plateaus` entry */
  plateau(plateau) {
    return this.add("plateaus", plateau);
  }

  /** @param {string} surface @param {number[][]} poly */
  paint(surface, poly) {
    return this.add("paint", { surface, poly });
  }

  /** A seeded `scatter` rule. @param {string} prefab @param {number} count @param {Record<string, unknown>} [o] */
  scatterRule(prefab, count, o = {}) {
    return this.add("scatter", { prefab, count, ...o });
  }

  /** An `along` rule. @param {string} prefab @param {number} every @param {Record<string, unknown>} [o] */
  alongRule(prefab, every, o = {}) {
    return this.add("along", { prefab, every, ...o });
  }

  /** The track JSON text with every array in `base` cut to its base and the program's entries appended. */
  serialize() {
    for (const [key, entries] of Object.entries(this.added)) {
      if (entries.length && !(key in this.base)) throw new Error(`${this.courseId}: add "// base ${key}: <n>" (the authored entries) to the sidecar's header`);
    }
    const compactFile = this.text.includes('{ "');
    let text = this.text;
    for (const [key, path] of Object.entries(ARRAYS)) {
      if (key in this.base) text = spliceArray(text, path, this.base[key], this.added[key], compactFile);
    }
    parseTrack(JSON.parse(text));
    return text;
  }

  /** @param {string} key @param {unknown} entry */
  add(key, entry) {
    this.added[key].push(entry);
    return this;
  }

  /** @param {Placement} p */
  register(p) {
    this.added.props.push(entryOf(p));
    this.placed.push(footprint(p));
  }

  /** @param {string} label @param {Placement[]} list */
  heal(label, list) {
    let moved = 0;
    let removed = 0;
    /** @type {Placement[]} */
    const kept = [];
    for (const p of list) {
      const home = { x: p.x, z: p.z };
      const [tx, tz] = this.tangent(home.x, home.z);
      let ok = this.fits(p);
      for (let i = 1; !ok && i <= SLIDE_STEPS * 2; i++) {
        const along = (i % 2 ? 1 : -1) * Math.ceil(i / 2) * SLIDE_STEP;
        p.x = r1(home.x + tx * along);
        p.z = r1(home.z + tz * along);
        ok = this.fits(p);
      }
      if (!ok) removed++;
      else {
        if (p.x !== home.x || p.z !== home.z) moved++;
        kept.push(p);
      }
    }
    for (const p of kept) this.register(p);
    this.notes.push(`${label}: ${kept.length} placed, ${moved} healed, ${removed} removed`);
  }

  /** @param {Placement} p */
  fits(p) {
    return this.settle(p) && !this.crowded(footprint(p), 0);
  }

  /** Pushes `p` out of every road margin and no-go along the normal; whether it ended clear. @param {Placement} p */
  settle(p) {
    for (let round = 0; round < HEAL_ROUNDS; round++) {
      const w = this.worst(footprint(p), this.roadMargin, this.noGos);
      if (w.deficit <= 0) return true;
      p.x = r1(p.x + w.nx * (w.deficit + HEAL_SLACK));
      p.z = r1(p.z + w.nz * (w.deficit + HEAL_SLACK));
    }
    return false;
  }

  /** The deepest intrusion of `f` into a road's margin or a no-go: `deficit` m (> 0: too close) and the unit direction that leaves it. @param {Footprint} f @param {number} minRoad @param {{ name: string, shape: Shape }[]} zones @returns {Violation} */
  worst(f, minRoad, zones) {
    /** @type {Violation} */
    let w = { deficit: 0, nx: 0, nz: 0, why: "" };
    for (const path of this.track.paths()) {
      const deficit = minRoad - boxClear(path, f.x, f.z, f.yaw, f.hw, f.hd);
      if (deficit <= w.deficit) continue;
      projectPath(path, f.x, f.z, -1, scratch);
      const d = Math.hypot(f.x - scratch.cx, f.z - scratch.cz) || 1;
      w = { deficit, nx: (f.x - scratch.cx) / d, nz: (f.z - scratch.cz) / d, why: "road" };
    }
    for (const { name, shape } of zones) {
      const e = edge(shape, f.x, f.z);
      if (f.r - e.d > w.deficit) w = { deficit: f.r - e.d, nx: e.nx, nz: e.nz, why: name };
    }
    return w;
  }

  /** @param {Footprint} f @param {number} gap */
  crowded(f, gap) {
    return this.placed.some((o) => Math.hypot(o.x - f.x, o.z - f.z) < o.r + f.r + gap);
  }

  /** Unit tangent (x, z) of the road nearest (x, z). @param {number} x @param {number} z */
  tangent(x, z) {
    let best = Infinity;
    let t = [0, 1];
    for (const path of this.track.paths()) {
      projectPath(path, x, z, -1, scratch);
      if (scratch.dist2 < best) {
        best = scratch.dist2;
        t = [path.tx[scratch.k], path.tz[scratch.k]];
      }
    }
    return /** @type {[number, number]} */ (t);
  }

  /** A random point `near`..`far` m beyond the wall line of a random road (paths weighted by length). @param {() => number} rng @param {number} lengthSum @param {number} near @param {number} far */
  bandPoint(rng, lengthSum, near, far) {
    let u = rng() * lengthSum;
    const paths = this.track.paths();
    let path = paths[paths.length - 1];
    for (const candidate of paths) {
      u -= candidate.length;
      if (u < 0) {
        path = candidate;
        break;
      }
    }
    const k = Math.floor(rng() * path.count);
    const side = rng() < 0.5 ? 1 : -1;
    const off = path.half[k] + (side > 0 ? path.runL[k] : path.runR[k]) + near + rng() * (far - near);
    return [path.x[k] + side * path.tz[k] * off, path.z[k] - side * path.tx[k] * off];
  }
}

/** @typedef {{ near?: number, far?: number, density?: number, count?: number, minProp?: number, noGo?: Region[], seed?: number, sizeJitter?: number, yaw?: "random" | "road" | number }} FillOptions */

/**
 * Runs `program` on `courseId`'s JSON under `dir`.
 * @param {string} courseId @param {Record<string, number>} base @param {(d: Dressing) => void} program @param {string} [dir]
 */
export function dress(courseId, base, program, dir = TRACKS_DIR) {
  const d = new Dressing(courseId, { base, dir });
  program(d);
  const text = d.serialize();
  return { text, notes: d.notes, appended: Object.fromEntries(Object.entries(d.added).filter(([, e]) => e.length).map(([k, e]) => [k, e.length])), changed: text !== d.text, file: `${dir}${courseId}.json` };
}

/** @param {string[]} args */
async function main(args) {
  const [courseId, ...flags] = args;
  if (!courseId) throw new Error("usage: course-dressing.mjs <course id> [--dry | --check]");
  const sidecar = `${TRACKS_DIR}${courseId}.dressing.mjs`;
  const base = Object.fromEntries([...readFileSync(sidecar, "utf8").matchAll(/^\/\/ base (\w+): (\d+)$/gm)].map((m) => [m[1], Number(m[2])]));
  const { default: program } = await import(pathToFileURL(sidecar).href);
  const { text, notes, appended, changed, file } = dress(courseId, base, program);
  console.log(`${notes.join("\n")}\nappended ${JSON.stringify(appended)}`);
  if (flags.includes("--check")) {
    if (changed) {
      console.error(`${file} differs from ${sidecar}'s output: rerun without --check`);
      process.exitCode = 1;
    }
  } else if (!flags.includes("--dry") && changed) writeFileSync(file, text);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) await main(process.argv.slice(2));
