/**
 * The landing shots' one view definition: a camera spec in car space (metres, +z forward, +x the car's left, y up) that
 * trace-car's overlay and headless-frame's shot of the real engine both build their camera from, so the two line up pixel
 * for pixel. Orthographic for side and top (a trace frame), perspective for the isos (stored per car, solved from the wheels).
 *
 *   { view, W, H, kind: "orthographic", position, target, up, halfWidth, halfHeight, near, far }
 *   { view, W, H, kind: "perspective", position, target, up, fov, near, far }
 */

/** How far (m) the orthographic camera stands off its target: behind every part of any car. */
const ORTHO_STANDOFF = 20;
const ORTHO_NEAR = 0.1;
const ORTHO_FAR = 40;
/** The perspective camera's depth range (m): a car seen whole sits well inside it. */
const PERSPECTIVE_NEAR = 0.1;
const PERSPECTIVE_FAR = 200;
/**
 * The fields of view (degrees) the wheel solve tries, each settled by the silhouette. The AI renders lean toward a long lens (their
 * silhouettes fit a little better near 2°), but narrower than ~12° the camera stands beyond the detail map's bump fade (15-25 m)
 * and the engine shot loses its panel lines; a car's landing entry may pin a narrower `fov` by hand.
 */
const SOLVE_FOVS = [12, 15, 18, 22, 26, 30, 35, 40, 50];
/**
 * Each field of view is solved from several starts round the brief's framing (pitch and angle offsets, rad): one side's wheels
 * are four points near one plane, which pin the view up to a tilt about the wheel line, so the starts reach the tilts the
 * silhouette then chooses between.
 */
const SOLVE_PITCHES = [0.25, 0.4, 0.55, 0.7, 0.85, 1.0];
const SOLVE_TURNS = [-0.3, 0, 0.3];
/** Solves within this (px RMS on the output canvas) of the best, or under SOLVE_GOOD_PX, are ties, settled by the silhouette. */
const SOLVE_TIE_PX = 2;
const SOLVE_GOOD_PX = 3;
/** Levenberg–Marquardt: rounds, starting damping, and the finite-difference steps (m for position, rad for angles). */
const LM_ROUNDS = 200;
const LM_DAMPING = 1e-3;
const STEP = [1e-4, 1e-4, 1e-4, 1e-5, 1e-5, 1e-5];
/**
 * The renders stand their camera upright (no dutch angle): roll costs this many pixels per radian in the solve (1° ≈ 3.5 px). One
 * side's wheels are a thin strip that leaves the tilt about the wheel line nearly free; holding the camera upright pins it.
 */
const ROLL_PX_PER_RAD = 200;
/** The solve starts from the cars brief's iso framing (pitch rad, angle rad, distance m) round the car's centre at this height (m). */
const START = { pitch: 0.55, angle: 0.8, distance: 6, lookY: 0.6 };

/** The orthographic spec of a trace frame (`trace-core.makeFrame`): the frame's centre, its view axis, its extents. */
export function orthoSpec(frame, axes) {
  const { R, U } = axes;
  const target = add(scale(R, frame.sxc), scale(U, frame.syc));
  return {
    view: frame.view,
    W: frame.W,
    H: frame.H,
    kind: "orthographic",
    position: add(target, scale(cross(R, U), ORTHO_STANDOFF)),
    target,
    up: U,
    halfWidth: frame.W / 2 / frame.ppm,
    halfHeight: frame.H / 2 / frame.ppm,
    near: ORTHO_NEAR,
    far: ORTHO_FAR,
  };
}

/** A perspective spec looking from `position` at `target` with `up` and a vertical `fov` (degrees). */
export function perspectiveSpec(view, W, H, { position, target, up, fov }) {
  return { view, W, H, kind: "perspective", position, target, up, fov, near: PERSPECTIVE_NEAR, far: PERSPECTIVE_FAR };
}

/** The spec's camera, in car space (apply the car's world matrix for a car that is not at the origin). */
export function makeCamera(THREE, spec, matrixWorld = null) {
  const v = (a) => (matrixWorld === null ? new THREE.Vector3(...a) : new THREE.Vector3(...a).applyMatrix4(matrixWorld));
  const camera =
    spec.kind === "orthographic"
      ? new THREE.OrthographicCamera(-spec.halfWidth, spec.halfWidth, spec.halfHeight, -spec.halfHeight, spec.near, spec.far)
      : new THREE.PerspectiveCamera(spec.fov, spec.W / spec.H, spec.near, spec.far);
  camera.up.copy(matrixWorld === null ? new THREE.Vector3(...spec.up) : new THREE.Vector3(...spec.up).transformDirection(matrixWorld));
  camera.position.copy(v(spec.position));
  camera.lookAt(v(spec.target));
  camera.updateMatrixWorld();
  camera.updateProjectionMatrix();
  return camera;
}

/** A perspective spec's camera basis: right, up, and back (the camera looks down -back). */
function basis(position, target, up) {
  const back = norm(sub(position, target));
  const right = norm(cross(up, back));
  return { right, up: cross(back, right), back };
}

/** The pixel (u right, v down) a car-space point lands on through a perspective spec. */
export function project(spec, X) {
  const { right, up, back } = basis(spec.position, spec.target, spec.up);
  const d = sub(X, spec.position);
  const depth = -dot(d, back);
  const f = spec.H / 2 / Math.tan((spec.fov * Math.PI) / 360);
  return [spec.W / 2 + (f * dot(d, right)) / depth, spec.H / 2 - (f * dot(d, up)) / depth];
}

/**
 * The perspective cameras that put the car-space `points` on their picked `pixels` ([u, v] on a W x H image): for each field of view
 * in `fovs` (default SOLVE_FOVS; a car's landing entry may pin one) and each start in SOLVE_PITCHES x SOLVE_TURNS round the brief's
 * framing (`rear`: from behind), Levenberg–Marquardt over the camera's position and its yaw, pitch and roll. Returns the ties
 * (SOLVE_TIE_PX / SOLVE_GOOD_PX) with their RMS pixel error, best first; the caller settles them by the silhouette.
 */
export function solveCamera(view, W, H, points, pixels, rear, fovs = SOLVE_FOVS) {
  const candidates = fovs.flatMap((fov) =>
    SOLVE_PITCHES.flatMap((pitch) =>
      SOLVE_TURNS.map((turn) => {
        const start = startParams(W, H, fov, points, pixels, START.angle + turn + (rear ? Math.PI : 0), pitch);
        const params = levenbergMarquardt(start, (p) => [...residuals(p, W, H, fov, points, pixels), ROLL_PX_PER_RAD * p[5]]);
        return { spec: perspectiveSpec(view, W, H, { ...poseOf(params), fov }), rmsPx: rms(residuals(params, W, H, fov, points, pixels)) };
      }),
    ),
  );
  const best = Math.min(...candidates.map((c) => c.rmsPx));
  return candidates.filter((c) => c.rmsPx <= Math.max(best + SOLVE_TIE_PX, SOLVE_GOOD_PX)).sort((a, b) => a.rmsPx - b.rmsPx);
}

/** Pose params [x, y, z, angle, pitch, roll]: the camera stands at (x, y, z) looking along the orbit direction (angle, pitch), rolled. */
function poseOf([x, y, z, angle, pitch, roll]) {
  const back = [Math.sin(angle) * Math.cos(pitch), Math.sin(pitch), Math.cos(angle) * Math.cos(pitch)];
  const right = norm(cross([0, 1, 0], back));
  const up0 = cross(back, right);
  const up = add(scale(up0, Math.cos(roll)), scale(right, -Math.sin(roll)));
  const position = [x, y, z];
  return { position, target: sub(position, back), up };
}

function residuals(params, W, H, fov, points, pixels) {
  const spec = perspectiveSpec("solve", W, H, { ...poseOf(params), fov });
  return points.flatMap((X, i) => {
    const [u, v] = project(spec, X);
    return [u - pixels[i][0], v - pixels[i][1]];
  });
}

/** The brief's framing at the distance that makes the picked points' spread match. */
function startParams(W, H, fov, points, pixels, angle, pitch) {
  const at = (distance) => {
    const back = [Math.sin(angle) * Math.cos(pitch), Math.sin(pitch), Math.cos(angle) * Math.cos(pitch)];
    return [...add([0, START.lookY, 0], scale(back, distance)), angle, pitch, 0];
  };
  const spread = (params) => {
    const r = residuals(params, W, H, fov, points, pixels.map(() => [0, 0]));
    const xs = r.filter((_, k) => k % 2 === 0);
    const ys = r.filter((_, k) => k % 2 === 1);
    return Math.hypot(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys));
  };
  const picked = Math.hypot(Math.max(...pixels.map((p) => p[0])) - Math.min(...pixels.map((p) => p[0])), Math.max(...pixels.map((p) => p[1])) - Math.min(...pixels.map((p) => p[1])));
  const distance = (START.distance * spread(at(START.distance))) / picked;
  return at(distance);
}

function levenbergMarquardt(start, f) {
  let p = start;
  let r = f(p);
  let cost = sumSq(r);
  let lambda = LM_DAMPING;
  for (let k = 0; k < LM_ROUNDS; k++) {
    const J = p.map((_, j) => {
      const q = p.slice();
      q[j] += STEP[j];
      return f(q).map((ri, i) => (ri - r[i]) / STEP[j]);
    });
    const n = p.length;
    const A = Array.from({ length: n }, (_, a) => Array.from({ length: n }, (_, b) => J[a].reduce((s, Ja, i) => s + Ja * J[b][i], 0)));
    const g = J.map((Ja) => Ja.reduce((s, x, i) => s + x * r[i], 0));
    for (let a = 0; a < n; a++) A[a][a] *= 1 + lambda;
    const delta = solveLinear(A, g);
    const q = p.map((x, j) => x - delta[j]);
    const rq = f(q);
    const cq = sumSq(rq);
    if (cq < cost) {
      const done = cost - cq < 1e-9 * cost;
      [p, r, cost, lambda] = [q, rq, cq, lambda / 3];
      if (done) break;
    } else lambda *= 4;
  }
  return p;
}

/** Gaussian elimination with partial pivoting. */
function solveLinear(A, b) {
  const n = b.length;
  const M = A.map((row, i) => [...row, b[i]]);
  for (let c = 0; c < n; c++) {
    let pivot = c;
    for (let r = c + 1; r < n; r++) if (Math.abs(M[r][c]) > Math.abs(M[pivot][c])) pivot = r;
    [M[c], M[pivot]] = [M[pivot], M[c]];
    for (let r = c + 1; r < n; r++) {
      const k = M[r][c] / M[c][c];
      for (let j = c; j <= n; j++) M[r][j] -= k * M[c][j];
    }
  }
  const x = new Array(n).fill(0);
  for (let r = n - 1; r >= 0; r--) x[r] = (M[r][n] - M[r].slice(r + 1, n).reduce((s, v, j) => s + v * x[r + 1 + j], 0)) / M[r][r];
  return x;
}

function rms(r) {
  return Math.sqrt(sumSq(r) / (r.length / 2));
}
function sumSq(r) {
  return r.reduce((s, x) => s + x * x, 0);
}
function add(a, b) {
  return a.map((x, i) => x + b[i]);
}
function sub(a, b) {
  return a.map((x, i) => x - b[i]);
}
function scale(a, k) {
  return a.map((x) => x * k);
}
function dot(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a, b) {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function norm(a) {
  return scale(a, 1 / Math.hypot(...a));
}
