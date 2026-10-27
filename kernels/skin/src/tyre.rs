// Rust -> WASM port of the tyre hold's plan grid and sag pass (`planGrid`, `TyreSkin.liftSaggingTriangles`): the JS's operations in
// its order (f64 over f32 loads, f32 stores, `Math.min` / `Math.max` / `Math.hypot` as V8 has them), so the bits are the JS's.
// Nothing lives here between calls: the caller copies a call's inputs into a scratch arena and its results out.

// car-tyre-skin.ts: `PLAN_CELL`, `SAG_CLEAR`, `SAG_STEP`, `SAG_AHEAD_COUNT`, `SAG_ALONG`, `SAG_LIFTABLE`.
const PLAN_CELL: f64 = 0.03;
const SAG_CLEAR: f64 = 0.01;
const SAG_STEP: f64 = 0.05;
const SAG_AHEAD_COUNT: usize = 39;
const SAG_ALONG: [f64; 5] = [-1.0, -0.5, 0.0, 0.5, 1.0];
const SAG_COUNT: usize = SAG_AHEAD_COUNT * 5;
const SAG_LIFTABLE: f64 = 0.5;

// A plan grid past these is no skin's: `plan_grid` declines it and the JS builds it.
const PLAN_CELLS_MAX: f64 = 4194304.0;
const PLAN_FILED_MAX: usize = 16777216;

// What a triangle's blend of its corner heights may stand over the highest of them (m), for the rounding of its weights.
const SAG_BLEND_SLACK: f64 = 1e-9;
// A sag record: the plan determinant, the plan terms of the two weights, the third corner's plan place, the corner heights and the highest.
const RECORD_LEN: usize = 11;
const REC_DEN: usize = 0;
const REC_C1: usize = 1;
const REC_C2: usize = 2;
const REC_C3: usize = 3;
const REC_C4: usize = 4;
const REC_CX: usize = 5;
const REC_CZ: usize = 6;
const REC_YA: usize = 7;
const REC_YB: usize = 8;
const REC_YC: usize = 9;
const REC_YMAX: usize = 10;

const PLAN_OK: i32 = 0;
const PLAN_SHORT: i32 = 1;
const PLAN_DECLINED: i32 = 2;

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

#[inline(always)]
fn plan_cell(v: f64, from: f64) -> f64 {
    ((v - from) / PLAN_CELL).floor()
}

// ---- planGrid: the triangles over a tyre filed by plan cell ----------------------------------------------------
// hdr (out, f64): x0, z0, nx, nz, filed length, then (PLAN_SHORT) the start length and filed length the grid needs.
// Returns PLAN_OK, PLAN_SHORT (`start` or `filed` too small: hdr says how big, call again) or PLAN_DECLINED (no
// triangles, or an extent that is not a finite grid of sane size: the JS builds it).
#[no_mangle]
pub unsafe extern "C" fn plan_grid(
    pos: *const f32,
    tris: *const i32,
    count: usize,
    box_: *mut f64,
    den: *mut f64,
    start: *mut i32,
    start_cap: usize,
    filed: *mut i32,
    filed_cap: usize,
    hdr: *mut f64,
) -> i32 {
    if count == 0 {
        return PLAN_DECLINED;
    }
    let mut x0 = f64::INFINITY;
    let mut z0 = f64::INFINITY;
    let mut x1 = f64::NEG_INFINITY;
    let mut z1 = f64::NEG_INFINITY;
    for i in 0..count {
        let a = *tris.add(i * 3) as usize * 3;
        let b = *tris.add(i * 3 + 1) as usize * 3;
        let c = *tris.add(i * 3 + 2) as usize * 3;
        *den.add(i) = (load(pos, b + 2) - load(pos, c + 2)) * (load(pos, a) - load(pos, c)) + (load(pos, c) - load(pos, b)) * (load(pos, a + 2) - load(pos, c + 2));
        *box_.add(i * 4) = js_min(js_min(load(pos, a), load(pos, b)), load(pos, c));
        *box_.add(i * 4 + 1) = js_max(js_max(load(pos, a), load(pos, b)), load(pos, c));
        *box_.add(i * 4 + 2) = js_min(js_min(load(pos, a + 2), load(pos, b + 2)), load(pos, c + 2));
        *box_.add(i * 4 + 3) = js_max(js_max(load(pos, a + 2), load(pos, b + 2)), load(pos, c + 2));
        x0 = js_min(x0, *box_.add(i * 4));
        x1 = js_max(x1, *box_.add(i * 4 + 1));
        z0 = js_min(z0, *box_.add(i * 4 + 2));
        z1 = js_max(z1, *box_.add(i * 4 + 3));
    }
    let nx_f = plan_cell(x1, x0) + 1.0;
    let nz_f = plan_cell(z1, z0) + 1.0;
    if !(nx_f >= 1.0 && nz_f >= 1.0 && nx_f * nz_f <= PLAN_CELLS_MAX) {
        return PLAN_DECLINED;
    }
    let nx = nx_f as usize;
    let nz = nz_f as usize;
    let cells = nx * nz;
    *hdr = x0;
    *hdr.add(1) = z0;
    *hdr.add(2) = nx_f;
    *hdr.add(3) = nz_f;
    if start_cap < cells + 1 {
        *hdr.add(5) = (cells + 1) as f64;
        *hdr.add(6) = filed_cap as f64;
        return PLAN_SHORT;
    }
    for k in 0..cells + 1 {
        *start.add(k) = 0;
    }
    for i in 0..count {
        if (*den.add(i)).abs() < 1e-12 {
            continue;
        }
        let cz_hi = plan_cell(*box_.add(i * 4 + 3), z0) as usize;
        let cx_hi = plan_cell(*box_.add(i * 4 + 1), x0) as usize;
        let mut cz = plan_cell(*box_.add(i * 4 + 2), z0) as usize;
        while cz <= cz_hi {
            let mut cx = plan_cell(*box_.add(i * 4), x0) as usize;
            while cx <= cx_hi {
                *start.add(cz * nx + cx + 1) += 1;
                cx += 1;
            }
            cz += 1;
        }
    }
    for k in 0..cells {
        *start.add(k + 1) += *start.add(k);
    }
    let total = *start.add(cells) as usize;
    if total > PLAN_FILED_MAX {
        return PLAN_DECLINED;
    }
    if filed_cap < total {
        *hdr.add(5) = (cells + 1) as f64;
        *hdr.add(6) = total as f64;
        return PLAN_SHORT;
    }
    // `start[cell]` is the cursor while filing, so each ends at the next cell's start; shifted back after.
    for i in 0..count {
        if (*den.add(i)).abs() < 1e-12 {
            continue;
        }
        let cz_hi = plan_cell(*box_.add(i * 4 + 3), z0) as usize;
        let cx_hi = plan_cell(*box_.add(i * 4 + 1), x0) as usize;
        let mut cz = plan_cell(*box_.add(i * 4 + 2), z0) as usize;
        while cz <= cz_hi {
            let mut cx = plan_cell(*box_.add(i * 4), x0) as usize;
            while cx <= cx_hi {
                let cursor = start.add(cz * nx + cx);
                *filed.add(*cursor as usize) = i as i32;
                *cursor += 1;
                cx += 1;
            }
            cz += 1;
        }
    }
    for k in (1..cells).rev() {
        *start.add(k) = *start.add(k - 1);
    }
    *start = 0;
    *hdr.add(4) = total as f64;
    PLAN_OK
}

// ---- liftSaggingTriangles: the tyre's top samples read against the skin's triangles -----------------------------
// job (f64): the wheel's axle (3) and hub (3) in the mesh's frame, the tyre's radius and half width at scale 1, the plan
// grid's x0, z0, nx, nz, then the wheel's index (its bit in `liftable`, per vertex: it rests over that tyre).
// `sag_look` takes each corner's lift into `read` and the samples (x, z, y) into `samples`, and returns 1 when every corner stands
// over the highest sample: no triangle can stand short, and the caller need not load the plan for `sag_pass`.
#[no_mangle]
pub unsafe extern "C" fn sag_look(pos: *const f32, weld: *const i32, tris: *const i32, corners: usize, lift: *const f32, read: *mut f32, samples: *mut f64, job: *const f64) -> i32 {
    let (e0, e1, e2) = (*job, *job.add(1), *job.add(2));
    let (h0, h1, h2) = (*job.add(3), *job.add(4), *job.add(5));
    let (tyre_r, tyre_half_w) = (*job.add(6), *job.add(7));
    let scale = hypot3(e0, e1, e2);
    let ax = e0 / scale;
    let ay = e1 / scale;
    let az = e2 / scale;
    let flat = hypot2(ax, az);
    let fx = -az / flat;
    let fz = ax / flat;
    let ux = fz * ay;
    let uy = fz * ax - fx * az;
    let uz = -fx * ay;
    let r = tyre_r * scale;
    let half_w = tyre_half_w * scale;
    let mut lowest = f64::INFINITY;
    for k in 0..corners {
        let v = *tris.add(k) as usize;
        let corner_lift = *lift.add(*weld.add(v) as usize);
        *read.add(k) = corner_lift;
        lowest = js_min(lowest, load(pos, v * 3 + 1) + corner_lift as f64);
    }
    let mut highest = f64::NEG_INFINITY;
    let mut n = 0usize;
    for i in 0..SAG_AHEAD_COUNT {
        let ahead = (i as f64 - (SAG_AHEAD_COUNT - 1) as f64 / 2.0) * SAG_STEP;
        let top = (1.0 - ahead * ahead).sqrt() * r;
        for k in 0..SAG_ALONG.len() {
            let across = SAG_ALONG[k] * half_w;
            let sample_y = h1 + ay * across + uy * top + SAG_CLEAR;
            *samples.add(n) = h0 + fx * ahead * r + ax * across + ux * top;
            *samples.add(SAG_COUNT + n) = h2 + fz * ahead * r + az * across + uz * top;
            *samples.add(2 * SAG_COUNT + n) = sample_y;
            highest = js_max(highest, sample_y);
            n += 1;
        }
    }
    // A triangle's height inside it is a blend of its corners': with every corner over the highest sample, none can stand short.
    (lowest > highest + 1e-9) as i32
}

// `lift` and `dirty` are written when a sample is short; `bump` is zero on entry and on return; `records` is scratch,
// `RECORD_LEN` f64 a triangle. Returns 1 when any corner was lifted.
#[no_mangle]
pub unsafe extern "C" fn sag_pass(
    pos: *const f32,
    weld: *const i32,
    liftable: *const u8,
    tris: *const i32,
    corners: usize,
    box_: *const f64,
    den: *const f64,
    start: *const i32,
    filed: *const i32,
    lift: *mut f32,
    bump: *mut f32,
    dirty: *mut u8,
    records: *mut f64,
    samples: *const f64,
    job: *const f64,
) -> i32 {
    let (x0, z0) = (*job.add(8), *job.add(9));
    let (nx_f, nz_f) = (*job.add(10), *job.add(11));
    let bit = 1u8 << (*job.add(12) as u32);
    // Each triangle's plan terms, corner heights (lift included) and highest of them, once for the many samples that read it.
    for i in 0..corners / 3 {
        let t = i * 3;
        let va = *tris.add(t) as usize;
        let vb = *tris.add(t + 1) as usize;
        let vc = *tris.add(t + 2) as usize;
        let (a, b, c) = (va * 3, vb * 3, vc * 3);
        let record = records.add(i * RECORD_LEN);
        *record.add(REC_DEN) = *den.add(i);
        *record.add(REC_C1) = load(pos, b + 2) - load(pos, c + 2);
        *record.add(REC_C2) = load(pos, c) - load(pos, b);
        *record.add(REC_C3) = load(pos, c + 2) - load(pos, a + 2);
        *record.add(REC_C4) = load(pos, a) - load(pos, c);
        *record.add(REC_CX) = load(pos, c);
        *record.add(REC_CZ) = load(pos, c + 2);
        let ya = load(pos, a + 1) + *lift.add(*weld.add(va) as usize) as f64;
        let yb = load(pos, b + 1) + *lift.add(*weld.add(vb) as usize) as f64;
        let yc = load(pos, c + 1) + *lift.add(*weld.add(vc) as usize) as f64;
        *record.add(REC_YA) = ya;
        *record.add(REC_YB) = yb;
        *record.add(REC_YC) = yc;
        *record.add(REC_YMAX) = js_max(js_max(ya, yb), yc);
    }
    let mut sample_skin = [f64::NEG_INFINITY; SAG_COUNT];
    let mut sample_corner = [-1i32; SAG_COUNT];
    let mut sample_share = [0.0f64; SAG_COUNT];
    let nx = nx_f as usize;
    for n in 0..SAG_COUNT {
        let x = *samples.add(n);
        let z = *samples.add(SAG_COUNT + n);
        let cx = plan_cell(x, x0);
        let cz = plan_cell(z, z0);
        // A NaN cell reads no triangle in the JS (its start entries are undefined), as out of the grid does.
        if !(cx >= 0.0 && cx < nx_f && cz >= 0.0 && cz < nz_f) {
            continue;
        }
        let cell = cz as usize * nx + cx as usize;
        let mut j = *start.add(cell);
        let end = *start.add(cell + 1);
        while j < end {
            let i = *filed.add(j as usize) as usize;
            j += 1;
            if (x < *box_.add(i * 4)) | (x > *box_.add(i * 4 + 1)) | (z < *box_.add(i * 4 + 2)) | (z > *box_.add(i * 4 + 3)) {
                continue;
            }
            let record = records.add(i * RECORD_LEN);
            // Its blend of the corner heights stands no higher than the highest of them (a rounding's width over): under the best so far, it cannot replace it.
            if *record.add(REC_YMAX) + SAG_BLEND_SLACK < sample_skin[n] {
                continue;
            }
            let to_x = x - *record.add(REC_CX);
            let to_z = z - *record.add(REC_CZ);
            let l1 = (*record.add(REC_C1) * to_x + *record.add(REC_C2) * to_z) / *record.add(REC_DEN);
            let l2 = (*record.add(REC_C3) * to_x + *record.add(REC_C4) * to_z) / *record.add(REC_DEN);
            let l3 = 1.0 - l1 - l2;
            if (l1 < 0.0) | (l2 < 0.0) | (l3 < 0.0) {
                continue;
            }
            let y = l1 * *record.add(REC_YA) + l2 * *record.add(REC_YB) + l3 * *record.add(REC_YC);
            if y <= sample_skin[n] {
                continue;
            }
            let t = i * 3;
            sample_skin[n] = y;
            sample_corner[n] = t as i32;
            sample_share[n] = (if *liftable.add(*tris.add(t) as usize) & bit != 0 { l1 } else { 0.0 })
                + (if *liftable.add(*tris.add(t + 1) as usize) & bit != 0 { l2 } else { 0.0 })
                + (if *liftable.add(*tris.add(t + 2) as usize) & bit != 0 { l3 } else { 0.0 });
        }
    }
    let mut raised = false;
    for n in 0..SAG_COUNT {
        let t = sample_corner[n];
        if t < 0 || sample_share[n] < SAG_LIFTABLE {
            continue;
        }
        let short = *samples.add(2 * SAG_COUNT + n) - sample_skin[n];
        if short <= 0.0 {
            continue;
        }
        let by = short / sample_share[n];
        for corner in 0..3 {
            let v = *tris.add(t as usize + corner) as usize;
            let p = *weld.add(v) as usize;
            if *liftable.add(v) & bit != 0 && by > *bump.add(p) as f64 {
                *bump.add(p) = by as f32;
            }
        }
        raised = true;
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
