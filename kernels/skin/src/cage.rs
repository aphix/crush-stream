// The cage fit's plan raster and plan field: the JS's operations in its order (f64 arithmetic, f32 stores, JS's Math.min / Math.max
// NaN and -0 rules), so the bits are the JS's. Nothing lives here between calls.

// The JS's LID_GROUPS, REACH_TIE and FAR2.
const LID_GROUPS: usize = 2;
const REACH_TIE: f64 = -1e-6;
const FAR2: f64 = 1e12;

#[inline(always)]
unsafe fn f(p: *const f64, i: usize) -> f64 {
    *p.add(i)
}

/// Math.min of two numbers: NaN if either is, -0 below +0.
#[inline(always)]
fn jmin(a: f64, b: f64) -> f64 {
    if a != a || b != b {
        f64::NAN
    } else if a < b {
        a
    } else if a > b {
        b
    } else if a.is_sign_negative() {
        a
    } else {
        b
    }
}

/// Math.max of two numbers: NaN if either is, +0 above -0.
#[inline(always)]
fn jmax(a: f64, b: f64) -> f64 {
    if a != a || b != b {
        f64::NAN
    } else if a > b {
        a
    } else if a < b {
        b
    } else if a.is_sign_positive() {
        a
    } else {
        b
    }
}

/// Whether plan point (x, z) lies within `margin` of one of the first `n` openings (x min, x max, z min, z max each).
#[inline(always)]
unsafe fn in_opening(open: *const f64, n: usize, x: f64, z: f64, margin: f64) -> bool {
    let mut o = 0usize;
    while o < n * 4 {
        if x >= f(open, o) - margin && x <= f(open, o + 1) + margin && z >= f(open, o + 2) - margin && z <= f(open, o + 3) + margin {
            return true;
        }
        o += 4;
    }
    false
}

/// `rasterise`: top, bottom, covered and part (nu x nv nodes) from the fit's `pos` (3 f64 a vertex) and `raw_y`.
/// params: [cutY, cutX, cutZ]; res out: [heightMax, xMin, xMax, zMin, zMax] (JS's `heightMax` and `planBox`).
#[no_mangle]
pub unsafe extern "C" fn cage_rasterise(
    nu: usize,
    nv: usize,
    step: f64,
    u0: f64,
    v0: f64,
    margin: f64,
    lid_margin: f64,
    tri_count: usize,
    interior_group: usize,
    part_group: usize,
    opens: usize,
    tris: *const u16,
    tri_group: *const u8,
    pos: *const f64,
    raw_y: *const f64,
    panel_on: *const u8,
    open: *const f64,
    params: *const f64,
    top: *mut f32,
    bottom: *mut f32,
    covered: *mut u8,
    part: *mut u8,
    res: *mut f64,
) {
    let n = nu * nv;
    for k in 0..n {
        *top.add(k) = f32::NAN;
        *bottom.add(k) = f32::NAN;
        *covered.add(k) = 0;
        *part.add(k) = 0;
    }
    let (cut_y, cut_x, cut_z) = (f(params, 0), f(params, 1), f(params, 2));
    let mut height_max = 0.0f64;
    let mut x_min = f64::INFINITY;
    let mut x_max = f64::NEG_INFINITY;
    let mut z_min = f64::INFINITY;
    let mut z_max = f64::NEG_INFINITY;
    for t in 0..tri_count {
        let group = *tri_group.add(t) as usize;
        let skip = if group == interior_group { opens == 0 } else { group > 0 && *panel_on.add(group - 1) == 0 };
        if skip {
            continue;
        }
        let ia = *tris.add(t * 3) as usize;
        let ib = *tris.add(t * 3 + 1) as usize;
        let ic = *tris.add(t * 3 + 2) as usize;
        let (ax, ay, az) = (f(pos, ia * 3), f(raw_y, ia), f(pos, ia * 3 + 2));
        let (bx, by, bz) = (f(pos, ib * 3), f(raw_y, ib), f(pos, ib * 3 + 2));
        let (cx, cy, cz) = (f(pos, ic * 3), f(raw_y, ic), f(pos, ic * 3 + 2));
        let area2 = (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
        if area2.abs() < 1e-9 {
            continue;
        }
        let sign = if area2 > 0.0 { 1.0 } else { -1.0 };
        let len_ab = ((bx - ax) * (bx - ax) + (bz - az) * (bz - az)).sqrt();
        let len_bc = ((cx - bx) * (cx - bx) + (cz - bz) * (cz - bz)).sqrt();
        let len_ca = ((ax - cx) * (ax - cx) + (az - cz) * (az - cz)).sqrt();
        if len_ab < 1e-9 || len_bc < 1e-9 || len_ca < 1e-9 {
            continue;
        }
        let y_low = jmin(jmin(ay, by), cy);
        let y_high = jmax(jmax(ay, by), cy);
        x_min = jmin(jmin(jmin(x_min, ax), bx), cx);
        x_max = jmax(jmax(jmax(x_max, ax), bx), cx);
        z_min = jmin(jmin(jmin(z_min, az), bz), cz);
        z_max = jmax(jmax(jmax(z_max, az), bz), cz);
        let reach = (if group >= 1 && group <= LID_GROUPS { lid_margin } else { margin }) + REACH_TIE;
        let x_lo = jmin(jmin(ax, bx), cx) - reach;
        let x_hi = jmax(jmax(ax, bx), cx) + reach;
        let z_lo = jmin(jmin(az, bz), cz) - reach;
        let z_hi = jmax(jmax(az, bz), cz) + reach;
        let i0 = jmax(0.0, ((x_lo - u0) / step).ceil());
        let i1 = jmin((nu - 1) as f64, ((x_hi - u0) / step).floor());
        let j0 = jmax(0.0, ((z_lo - v0) / step).ceil());
        let j1 = jmin((nv - 1) as f64, ((z_hi - v0) / step).floor());
        let nx_ab = (-(bz - az) * sign) / len_ab;
        let nz_ab = ((bx - ax) * sign) / len_ab;
        let k_ab = -(nx_ab * ax + nz_ab * az);
        let nx_bc = (-(cz - bz) * sign) / len_bc;
        let nz_bc = ((cx - bx) * sign) / len_bc;
        let k_bc = -(nx_bc * bx + nz_bc * bz);
        let nx_ca = (-(az - cz) * sign) / len_ca;
        let nz_ca = ((ax - cx) * sign) / len_ca;
        let k_ca = -(nx_ca * cx + nz_ca * cz);
        let scale = 1.0 / area2.abs();
        let w_a = len_bc * scale;
        let w_b = len_ca * scale;
        let w_c = len_ab * scale;
        // A NaN bound fails these tests as it fails JS's loop tests.
        if i0 <= i1 && j0 <= j1 {
            for j in (j0 as usize)..=(j1 as usize) {
                let z = v0 + j as f64 * step;
                let row_ab = nz_ab * z + k_ab;
                let row_bc = nz_bc * z + k_bc;
                let row_ca = nz_ca * z + k_ca;
                for i in (i0 as usize)..=(i1 as usize) {
                    let x = u0 + i as f64 * step;
                    let e_ab = nx_ab * x + row_ab;
                    let e_bc = nx_bc * x + row_bc;
                    let e_ca = nx_ca * x + row_ca;
                    if e_ab < -reach || e_bc < -reach || e_ca < -reach {
                        continue;
                    }
                    if group == interior_group && !in_opening(open, opens, x, z, margin) {
                        continue;
                    }
                    let mut y = e_bc * w_a * ay + e_ca * w_b * by + e_ab * w_c * cy;
                    if y < y_low {
                        y = y_low;
                    } else if y > y_high {
                        y = y_high;
                    }
                    if group == 0 {
                        y = jmin(y, cut_y + cut_x * x + cut_z * z);
                    }
                    let k = j * nu + i;
                    if !(*top.add(k) as f64 >= y) {
                        *top.add(k) = y as f32;
                    }
                    if !(*bottom.add(k) as f64 <= y) {
                        *bottom.add(k) = y as f32;
                    }
                    if e_ab >= 0.0 && e_bc >= 0.0 && e_ca >= 0.0 {
                        if group < part_group || group == interior_group {
                            *part.add(k) = 0;
                        } else if *covered.add(k) == 0 {
                            *part.add(k) = group as u8;
                        }
                        *covered.add(k) = 1;
                    }
                }
            }
        }
        height_max = jmax(jmax(height_max, y_low.abs()), y_high.abs());
    }
    *res = height_max;
    *res.add(1) = x_min;
    *res.add(2) = x_max;
    *res.add(3) = z_min;
    *res.add(4) = z_max;
}

/// One line of the exact squared-distance transform (Felzenszwalb and Huttenlocher 2012): d[q] <- min over p of (q - p)^2 + f[p].
/// v and z are the lower envelope's scratch (z holds n + 1). JS never reads z below 0 either: s > -FAR2 always.
unsafe fn transform_line(n: usize, fl: *const f64, d: *mut f64, v: *mut i32, z: *mut f64) {
    let mut k = 0usize;
    *v = 0;
    *z = -FAR2;
    *z.add(1) = FAR2;
    for q in 1..n {
        let qf = q as f64;
        let mut vk = *v.add(k) as f64;
        let mut s = (f(fl, q) + qf * qf - (f(fl, *v.add(k) as usize) + vk * vk)) / (2.0 * qf - 2.0 * vk);
        while s <= *z.add(k) && k > 0 {
            k -= 1;
            vk = *v.add(k) as f64;
            s = (f(fl, q) + qf * qf - (f(fl, *v.add(k) as usize) + vk * vk)) / (2.0 * qf - 2.0 * vk);
        }
        k += 1;
        *v.add(k) = q as i32;
        *z.add(k) = s;
        *z.add(k + 1) = FAR2;
    }
    k = 0;
    for q in 0..n {
        while *z.add(k + 1) < q as f64 {
            k += 1;
        }
        let dq = q as f64 - *v.add(k) as f64;
        *d.add(q) = dq * dq + f(fl, *v.add(k) as usize);
    }
}

/// `g` <- the column pass of the squared-distance transform of the image whose seeds are the nodes with (covered == 1) == inside:
/// the squared distance to the nearest seed in the column, FAR2 where it has none. With `with_box`, `bx` gets the seeds' extent
/// [ci0, ci1, cj0, cj1] (bx[1] < 0 when there is no seed).
unsafe fn seed_columns(nu: usize, nv: usize, covered: *const u8, inside: bool, g: *mut f64, with_box: bool, bx: &mut [i32; 4]) {
    if with_box {
        *bx = [nu as i32, -1, nv as i32, -1];
    }
    for i in 0..nu {
        let mut last: i32 = -1;
        let mut first: i32 = -1;
        for j in 0..nv {
            let k = j * nu + i;
            if (*covered.add(k) == 1) == inside {
                last = j as i32;
                if first < 0 {
                    first = j as i32;
                }
            }
            *g.add(k) = if last < 0 { FAR2 } else { ((j as i32 - last) * (j as i32 - last)) as f64 };
        }
        if with_box && first >= 0 {
            if (i as i32) < bx[0] {
                bx[0] = i as i32;
            }
            bx[1] = i as i32;
            if first < bx[2] {
                bx[2] = first;
            }
            if last > bx[3] {
                bx[3] = last;
            }
        }
        last = -1;
        for j in (0..nv).rev() {
            let k = j * nu + i;
            if (*covered.add(k) == 1) == inside {
                last = j as i32;
            }
            if last >= 0 {
                let dd = ((last - j as i32) * (last - j as i32)) as f64;
                if dd < *g.add(k) {
                    *g.add(k) = dd;
                }
            }
        }
    }
}

/// `g` (nu x nv) <- the row pass over rows j0..=j1 and nodes i0..=i1 (each row's sub-range is its own line).
unsafe fn transform_rows(nu: usize, g: *mut f64, j0: usize, j1: usize, i0: usize, i1: usize, lf: *mut f64, ld: *mut f64, lz: *mut f64, lv: *mut i32) {
    let n = i1 - i0 + 1;
    for j in j0..=j1 {
        let row = g.add(j * nu + i0);
        for i in 0..n {
            *lf.add(i) = *row.add(i);
        }
        transform_line(n, lf, ld, lv, lz);
        for i in 0..n {
            *row.add(i) = *ld.add(i);
        }
    }
}

/// `planFieldOf`: plan <- the signed distance (m) to the outline, negative inside, 5 mm of it between a covered node and its
/// uncovered neighbour. to_covered and to_uncovered are nu x nv f64 scratch; lf and ld max(nu, nv) f64, lz one more, lv max(nu, nv) i32.
#[no_mangle]
pub unsafe extern "C" fn plan_field(
    nu: usize,
    nv: usize,
    step: f64,
    covered: *const u8,
    plan: *mut f32,
    to_covered: *mut f64,
    to_uncovered: *mut f64,
    lf: *mut f64,
    ld: *mut f64,
    lz: *mut f64,
    lv: *mut i32,
) {
    let mut bx = [0i32; 4];
    let mut unused = [0i32; 4];
    seed_columns(nu, nv, covered, true, to_covered, true, &mut bx);
    seed_columns(nu, nv, covered, false, to_uncovered, false, &mut unused);
    transform_rows(nu, to_covered, 0, nv - 1, 0, nu - 1, lf, ld, lz, lv);
    if bx[1] >= 0 {
        // Outside the covered nodes' extent every node is uncovered (0) and the ring around the extent is all uncovered, so the row
        // pass over the uncovered image runs over the ring box alone.
        let j0 = (bx[2] - 1).max(0) as usize;
        let j1 = (bx[3] + 1).min(nv as i32 - 1) as usize;
        let i0 = (bx[0] - 1).max(0) as usize;
        let i1 = (bx[1] + 1).min(nu as i32 - 1) as usize;
        transform_rows(nu, to_uncovered, j0, j1, i0, i1, lf, ld, lz, lv);
    }
    for k in 0..nu * nv {
        *plan.add(k) = if *covered.add(k) == 1 { (-(f(to_uncovered, k).sqrt() - 0.5) * step) as f32 } else { ((f(to_covered, k).sqrt() - 0.5) * step) as f32 };
    }
}
