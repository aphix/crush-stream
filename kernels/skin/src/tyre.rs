// Rust -> WASM port of the tyre hold's sag pass (`TyreSkin.liftSaggingTriangles`, `sagTriangle`): the JS's operations in its order
// (f64 over f32 loads, f32 stores, `Math.min` / `Math.max` / `Math.hypot` as V8 has them), so the bits are the JS's.
// Nothing lives here between calls: the caller copies a call's inputs into a scratch arena and its results out.

// car-tyre-skin.ts: `FALL`, `SAG_CLEAR`, `SAG_STEP`, `SAG_FLOOR_SLACK`, `SAG_EDGE_FADE`, `SAG_LIFTABLE`, `SAG_LIFT_FROM`.
const FALL: f64 = 1.0;
const SAG_CLEAR: f64 = 0.01;
const SAG_STEP: f64 = 0.05;
const SAG_FLOOR_SLACK: f64 = 1e-9;
// car-tyre-skin.ts `ROW_SLOPE_MIN`.
const ROW_SLOPE_MIN: f64 = 1e-9;
// car-tyre-skin.ts `ROW_TOP_SLACK`.
const ROW_TOP_SLACK: f64 = 1e-6;
const SAG_EDGE_FADE: f64 = 0.1;
const SAG_LIFTABLE: f64 = 0.5;
const SAG_LIFT_FROM: f64 = 0.25;

// The job block (f64, `tyre-sag-kernel.ts` `SAG_JOB`): the wheel's axle and hub at the last hold, the tyre's radius and half width at
// scale 1, its hub and scale when the rest skin's clearances were read, the wheel's index (its bit in `liftable`), and the shares of the
// radius the top is read whole to and not past, and the share of its hold the wheel keeps (under 1 while a torn-off wheel leaves).
const JOB_HELD: usize = 0;
const JOB_TYRE_R: usize = 6;
const JOB_TYRE_HALF_W: usize = 7;
const JOB_REST_HUB: usize = 8;
const JOB_REST_SCALE: usize = 11;
const JOB_WHEEL: usize = 12;
const JOB_TOP_FULL: usize = 13;
const JOB_TOP_NONE: usize = 14;
const JOB_FADE: usize = 15;

#[inline(always)]
fn js_min(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_negative() { a } else { b };
    }
    if a < b {
        a
    } else {
        b
    }
}

#[inline(always)]
fn js_max(a: f64, b: f64) -> f64 {
    if a.is_nan() || b.is_nan() {
        return f64::NAN;
    }
    if a == 0.0 && b == 0.0 {
        return if a.is_sign_positive() { a } else { b };
    }
    if a > b {
        a
    } else {
        b
    }
}

// physics-core.js `hypot2` / `hypot3`: V8's MathHypot bit for bit (never libm's hypot).
fn hypot2(x: f64, y: f64) -> f64 {
    let x = x.abs();
    let y = y.abs();
    let mut max = 0.0;
    if x > max {
        max = x;
    }
    if y > max {
        max = y;
    }
    if max > f64::MAX {
        return max;
    }
    if x != x || y != y {
        return x + y;
    }
    if max == 0.0 {
        return 0.0;
    }
    let a = x / max;
    let b = y / max;
    (a * a + b * b).sqrt() * max
}

fn hypot3(x: f64, y: f64, z: f64) -> f64 {
    let x = x.abs();
    let y = y.abs();
    let z = z.abs();
    let mut max = 0.0;
    if x > max {
        max = x;
    }
    if y > max {
        max = y;
    }
    if z > max {
        max = z;
    }
    if max > f64::MAX {
        return max;
    }
    if x != x || y != y || z != z {
        return x + y + z;
    }
    if max == 0.0 {
        return 0.0;
    }
    let a = x / max;
    let b = y / max;
    let c = z / max;
    let s = a * a + b * b;
    let comp = s - a * a - b * b;
    (s + (c * c - comp)).sqrt() * max
}

#[inline(always)]
unsafe fn load(p: *const f32, i: usize) -> f64 {
    *p.add(i) as f64
}

// A tyre: hub, unit axle, and its radius and half width at its scale; the rest are the axle's derived terms `clearOver` computes per call,
// computed once here in its operations (so in its bits): the road's direction across the axle (`fx`, `fz`) and the up of the clearance (`u`).
struct Tyre {
    h: [f64; 3],
    a: [f64; 3],
    r: f64,
    half_w: f64,
    flat: f64,
    fx: f64,
    fz: f64,
    u: [f64; 3],
}

impl Tyre {
    fn new(h: [f64; 3], a: [f64; 3], scale: f64, r: f64, half_w: f64) -> Tyre {
        let flat = hypot2(a[0], a[2]);
        let fx = -a[2] / flat;
        let fz = a[0] / flat;
        Tyre { h, a, r: r * scale, half_w: half_w * scale, flat, fx, fz, u: [-fz * a[1], fz * a[0] - fx * a[2], fx * a[1]] }
    }
}

// car-tyre-skin.ts `clearOver`: how far (m) point `p` stands over the tyre's upper surface, less `gap`.
#[inline(always)]
fn clear_over(t: &Tyre, p: &[f64; 3], gap: f64) -> f64 {
    let dx = p[0] - t.h[0];
    let dy = p[1] - t.h[1];
    let dz = p[2] - t.h[2];
    let up = t.u[0] * dx + t.u[1] * dy + t.u[2] * dz;
    let ahead = dx * t.fx + dz * t.fz;
    let along = dx * t.a[0] + dy * t.a[1] + dz * t.a[2];
    let r = t.r;
    let top = js_max(0.0, r * r - ahead * ahead).sqrt() - FALL * (js_max(0.0, ahead.abs() - r) + js_max(0.0, along.abs() - t.half_w));
    up - top - gap
}

// car-tyre-skin.ts `sagLift`.
fn sag_lift(short: f64, share: f64) -> f64 {
    let ramp = js_min(1.0, (share - SAG_LIFT_FROM) / (SAG_LIFTABLE - SAG_LIFT_FROM));
    if ramp > 0.0 {
        (short * ramp) / share
    } else {
        0.0
    }
}

// What the pass reads and writes of the skin.
struct Skin {
    pos: *const f32,
    rest: *const f32,
    weld: *const i32,
    liftable: *const u8,
    lift: *const f32,
    bump: *mut f32,
    bit: u8,
}

// The wheel's tyre as held (`held`), as the rest skin's clearances read it (`rest`), and the shares of the radius the top is read whole to and not past.
struct Read {
    held: Tyre,
    rest: Tyre,
    full: f64,
    none: f64,
    fade: f64,
}

// car-tyre-skin.ts `sidesPast`: bits of the read's bounds the point (x, y, z) lies past.
fn sides_past(q: &Read, x: f64, y: f64, z: f64, reach: f64, edge: f64) -> u32 {
    let t = &q.held;
    let dx = x - t.h[0];
    let dz = z - t.h[2];
    let ahead = dx * t.fx + dz * t.fz;
    let along = dx * t.a[0] + (y - t.h[1]) * t.a[1] + dz * t.a[2];
    (if ahead > reach { 1 } else { 0 }) | (if ahead < -reach { 2 } else { 0 }) | (if along > edge { 4 } else { 0 }) | (if along < -edge { 8 } else { 0 })
}

// car-tyre-skin.ts `sagOffTop`: the triangle lies wholly where the read takes nothing.
fn off_top(q: &Read, pa: &[f64; 2], ya: f64, pb: &[f64; 2], yb: f64, pc: &[f64; 2], yc: f64) -> bool {
    let t = &q.held;
    if js_min(js_min(ya, yb), yc) > t.h[1] + t.a[1].abs() * t.half_w + t.flat * t.r + SAG_CLEAR {
        return true;
    }
    let reach = q.none * t.r;
    let edge = t.half_w * (1.0 + SAG_EDGE_FADE);
    sides_past(q, pa[0], ya, pa[1], reach, edge) & sides_past(q, pb[0], yb, pb[1], reach, edge) & sides_past(q, pc[0], yc, pc[1], reach, edge) != 0
}

// car-tyre-skin.ts `sagFloor`: under the clearance of every point of the triangle within the tyre's radius out along the road.
fn sag_floor(q: &Read, pa: &[f64; 2], ya: f64, pb: &[f64; 2], yb: f64, pc: &[f64; 2], yc: f64) -> f64 {
    let t = &q.held;
    let cx = (pa[0] + pb[0] + pc[0]) / 3.0;
    let cy = (ya + yb + yc) / 3.0;
    let cz = (pa[1] + pb[1] + pc[1]) / 3.0;
    let dx = cx - t.h[0];
    let dy = cy - t.h[1];
    let dz = cz - t.h[2];
    let ahead = dx * t.fx + dz * t.fz;
    if ahead.abs() >= t.r {
        return f64::NEG_INFINITY;
    }
    let along = dx * t.a[0] + dy * t.a[1] + dz * t.a[2];
    let root = (t.r * t.r - ahead * ahead).sqrt();
    let clear = t.u[0] * dx + t.u[1] * dy + t.u[2] * dz - root + FALL * js_max(0.0, along.abs() - t.half_w);
    let slope = ahead / root;
    let fall = if along.abs() > t.half_w {
        if along > 0.0 {
            FALL
        } else {
            -FALL
        }
    } else {
        0.0
    };
    let gx = t.u[0] + slope * t.fx + fall * t.a[0];
    let gy = t.u[1] + fall * t.a[1];
    let gz = t.u[2] + slope * t.fz + fall * t.a[2];
    let to_a = gx * (pa[0] - cx) + gy * (ya - cy) + gz * (pa[1] - cz);
    let to_b = gx * (pb[0] - cx) + gy * (yb - cy) + gz * (pb[1] - cz);
    let to_c = gx * (pc[0] - cx) + gy * (yc - cy) + gz * (pc[1] - cz);
    clear + js_min(js_min(to_a, to_b), to_c)
}

// car-tyre-skin.ts `narrowRow`: `row` (first and last `j`) narrowed to the points whose `q0 + j·qd` may lie strictly between `lo` and `hi`.
fn narrow_row(row: &mut (f64, f64), q0: f64, qd: f64, lo: f64, hi: f64, n: f64) {
    if qd.abs() < ROW_SLOPE_MIN {
        let spread = (n + 1.0) * ROW_SLOPE_MIN;
        if q0 + spread <= lo || q0 - spread >= hi {
            row.1 = -1.0;
        }
        return;
    }
    let j1 = (lo - q0) / qd;
    let j2 = (hi - q0) / qd;
    row.0 = js_max(row.0, js_min(j1, j2).floor() - 1.0);
    row.1 = js_min(row.1, js_max(j1, j2).ceil() + 1.0);
}

// car-tyre-skin.ts `sagTriangle` for the triangle of corners `va`, `vb`, `vc`; true when it asked any corner up (into `bump`).
unsafe fn sag_triangle(s: &Skin, q: &Read, va: usize, vb: usize, vc: usize) -> bool {
    let (a, b, c) = (va * 3, vb * 3, vc * 3);
    let ya = load(s.pos, a + 1) + *s.lift.add(*s.weld.add(va) as usize) as f64;
    let yb = load(s.pos, b + 1) + *s.lift.add(*s.weld.add(vb) as usize) as f64;
    let yc = load(s.pos, c + 1) + *s.lift.add(*s.weld.add(vc) as usize) as f64;
    let la = *s.liftable.add(va) & s.bit != 0;
    let lb = *s.liftable.add(vb) & s.bit != 0;
    let lc = *s.liftable.add(vc) & s.bit != 0;
    let pa = [load(s.pos, a), load(s.pos, a + 2)];
    let pb = [load(s.pos, b), load(s.pos, b + 2)];
    let pc = [load(s.pos, c), load(s.pos, c + 2)];
    if off_top(q, &pa, ya, &pb, yb, &pc, yc) || sag_floor(q, &pa, ya, &pb, yb, &pc, yc) >= SAG_CLEAR + SAG_FLOOR_SLACK {
        return false;
    }
    let t = &q.held;
    let longest = js_max(
        js_max(hypot3(pa[0] - pb[0], ya - yb, pa[1] - pb[1]), hypot3(pb[0] - pc[0], yb - yc, pb[1] - pc[1])),
        hypot3(pc[0] - pa[0], yc - ya, pc[1] - pa[1]),
    );
    let order = js_max(2.0, (longest / SAG_STEP).ceil());
    let mut asked = false;
    let mut p = [0.0f64; 3];
    let mut rp = [0.0f64; 3];
    let reach = q.none * t.r;
    let edge = t.half_w * (1.0 + SAG_EDGE_FADE);
    // car-tyre-skin.ts `sagTriangle`: along a row the share, the reach along the road and across the tread are linear (`narrow_row`).
    let sx = (pb[0] - pc[0]) / order;
    let sy = (yb - yc) / order;
    let sz = (pb[1] - pc[1]) / order;
    let ahead_step = sx * t.fx + sz * t.fz;
    let along_step = sx * t.a[0] + sy * t.a[1] + sz * t.a[2];
    let share_step = ((if lb { 1.0 } else { 0.0 }) - (if lc { 1.0 } else { 0.0 })) / order;
    // car-tyre-skin.ts `sagTriangle`: `clear_over`'s up is linear along a row too, read only under the top at the run's least reach.
    let up_step = sx * t.u[0] + sy * t.u[1] + sz * t.u[2];
    let mut i = 0.0f64;
    while i <= order {
        let n = order - i;
        let u1 = i / order;
        let u3 = n / order;
        let x0 = u1 * pa[0] + u3 * pc[0] - t.h[0];
        let y0 = u1 * ya + u3 * yc - t.h[1];
        let z0 = u1 * pa[1] + u3 * pc[1] - t.h[2];
        let mut row = (0.0f64, n);
        narrow_row(&mut row, (if la { u1 } else { 0.0 }) + (if lc { u3 } else { 0.0 }), share_step, SAG_LIFT_FROM, f64::INFINITY, n);
        let ahead0 = x0 * t.fx + z0 * t.fz;
        narrow_row(&mut row, ahead0, ahead_step, -reach, reach, n);
        narrow_row(&mut row, x0 * t.a[0] + y0 * t.a[1] + z0 * t.a[2], along_step, -edge, edge, n);
        if row.0 <= row.1 {
            let ahead_from = ahead0 + row.0 * ahead_step;
            let ahead_to = ahead0 + row.1 * ahead_step;
            let least = if ahead_from * ahead_to <= 0.0 { 0.0 } else { js_min(ahead_from.abs(), ahead_to.abs()) };
            narrow_row(&mut row, x0 * t.u[0] + y0 * t.u[1] + z0 * t.u[2], up_step, f64::NEG_INFINITY, js_max(0.0, t.r * t.r - least * least).sqrt() + SAG_CLEAR + ROW_TOP_SLACK, n);
        }
        let mut j = row.0;
        while j <= row.1 {
            let l1 = i / order;
            let l2 = j / order;
            let l3 = (order - i - j) / order;
            j += 1.0;
            let share = (if la { l1 } else { 0.0 }) + (if lb { l2 } else { 0.0 }) + (if lc { l3 } else { 0.0 });
            if share <= SAG_LIFT_FROM {
                continue;
            }
            p[0] = l1 * pa[0] + l2 * pb[0] + l3 * pc[0];
            p[1] = l1 * ya + l2 * yb + l3 * yc;
            p[2] = l1 * pa[1] + l2 * pb[1] + l3 * pc[1];
            let dx = p[0] - t.h[0];
            let dz = p[2] - t.h[2];
            let ahead = (dx * t.fx + dz * t.fz).abs();
            let along = (dx * t.a[0] + (p[1] - t.h[1]) * t.a[1] + dz * t.a[2]).abs();
            let on_top = js_min(1.0, js_max(0.0, (q.none * t.r - ahead) / ((q.none - q.full) * t.r)))
                * js_min(1.0, js_max(0.0, (t.half_w * (1.0 + SAG_EDGE_FADE) - along) / (SAG_EDGE_FADE * t.half_w)))
                * q.fade;
            if on_top <= 0.0 {
                continue;
            }
            let bare = clear_over(t, &p, 0.0);
            if bare >= SAG_CLEAR {
                continue;
            }
            for k in 0..3 {
                rp[k] = l1 * load(s.rest, a + k) + l2 * load(s.rest, b + k) + l3 * load(s.rest, c + k);
            }
            let clear = bare - js_min(SAG_CLEAR, clear_over(&q.rest, &rp, 0.0));
            if clear >= 0.0 {
                continue;
            }
            let by = on_top * sag_lift(-clear / t.flat, share);
            if by <= 0.0 {
                continue;
            }
            for (lifts, v) in [(la, va), (lb, vb), (lc, vc)] {
                let pt = *s.weld.add(v) as usize;
                if lifts && by > *s.bump.add(pt) as f64 {
                    *s.bump.add(pt) = by as f32;
                }
            }
            asked = true;
        }
        i += 1.0;
    }
    asked
}

// ---- liftSaggingTriangles: every triangle over a tyre read at points fixed on it ----------------------------------------
// `read` holds each corner's lift at the wheel's last read (`again`: an earlier pass of this hold) and takes its lift now; `lift` and `dirty`
// are written when a corner is lifted; `bump` is zero on entry and on return. `sag_free` (per vertex, 1: never read). Returns 1 when any corner was lifted.
#[no_mangle]
pub unsafe extern "C" fn sag_pass(
    pos: *const f32,
    rest: *const f32,
    weld: *const i32,
    liftable: *const u8,
    sag_free: *const u8,
    tris: *const i32,
    corners: usize,
    lift: *mut f32,
    bump: *mut f32,
    dirty: *mut u8,
    read: *mut f32,
    again: i32,
    job: *const f64,
) -> i32 {
    let e = |k: usize| *job.add(JOB_HELD + k);
    let scale = hypot3(e(0), e(1), e(2));
    let a = [e(0) / scale, e(1) / scale, e(2) / scale];
    let (tyre_r, tyre_half_w) = (*job.add(JOB_TYRE_R), *job.add(JOB_TYRE_HALF_W));
    let q = Read {
        held: Tyre::new([e(3), e(4), e(5)], a, scale, tyre_r, tyre_half_w),
        rest: Tyre::new([*job.add(JOB_REST_HUB), *job.add(JOB_REST_HUB + 1), *job.add(JOB_REST_HUB + 2)], [1.0, 0.0, 0.0], *job.add(JOB_REST_SCALE), tyre_r, tyre_half_w),
        full: *job.add(JOB_TOP_FULL),
        none: *job.add(JOB_TOP_NONE),
        fade: *job.add(JOB_FADE),
    };
    let t = &q.held;
    let mut lowest = f64::INFINITY;
    for k in 0..corners {
        let v = *tris.add(k) as usize;
        lowest = js_min(lowest, load(pos, v * 3 + 1) + *lift.add(*weld.add(v) as usize) as f64);
    }
    // A triangle's point is a blend of its corners': with every corner over the tyre's top and the clearance, none can stand short.
    let over_top = lowest > t.h[1] + t.a[1].abs() * t.half_w + t.flat * t.r + SAG_CLEAR;
    let s = Skin { pos, rest, weld, liftable, lift, bump, bit: 1u8 << (*job.add(JOB_WHEEL) as u32) };
    let mut raised = false;
    let mut k = 0;
    while k < corners {
        // Read again, a triangle whose corners kept the lifts of its last read asks what it asked then: nothing, or a corner would have risen.
        let mut rose = again == 0;
        for c in k..k + 3 {
            let now = *lift.add(*weld.add(*tris.add(c) as usize) as usize);
            if now != *read.add(c) {
                rose = true;
            }
            *read.add(c) = now;
        }
        let (va, vb, vc) = (*tris.add(k) as usize, *tris.add(k + 1) as usize, *tris.add(k + 2) as usize);
        k += 3;
        if !rose || over_top || *sag_free.add(va) as u32 + *sag_free.add(vb) as u32 + *sag_free.add(vc) as u32 > 0 {
            continue;
        }
        if sag_triangle(&s, &q, va, vb, vc) {
            raised = true;
        }
    }
    if !raised {
        return 0;
    }
    for k in 0..corners {
        let p = *weld.add(*tris.add(k) as usize) as usize;
        if *bump.add(p) > 0.0 {
            *dirty.add(p) = 1;
        }
        *lift.add(p) = (*lift.add(p) as f64 + *bump.add(p) as f64) as f32;
        *bump.add(p) = 0.0;
    }
    1
}
