import { IMPRINT_NONE } from "../deform/load-crush.ts";
import { INF_K } from "../deform/deform-build.ts";
import { cageAxis } from "../deform/deform-state.ts";
import { archKeep, RES_SLOTS, SKIN_COUNT_BITS, SKIN_COUNT_MASK, SKIN_K, SKIN_LEVER_STEPS } from "../deform/deform-rig.ts";
import { interiorPose } from "./part-pose.ts";
import { decimate, upFacing } from "./cage-mesh.ts";
import { planFieldOf, rasterise } from "./cage-fields.ts";
import { makeChassisGeometry } from "./car-chassis-mesh.ts";
import { cageGateHold, makeTrunkGeometry } from "./car-mesh.ts";
import { wellHumpGeometry } from "./car-well-mesh.ts";
import { carFrame } from "./car-rig.ts";
import { rockerAt } from "./car-lines.ts";
import { CAR_STYLE_IDS, CAR_STYLES, type BodyStyle } from "./car-variants.ts";

/**
 * The car's contact shape is its drawn body (docs/UNIFIED_CONTACT.md stage 3): the cage.
 *
 * About a hundred of the drawn body mesh's own vertices (`decimate`, once per style), each skinned from the car's 20 masses
 * and 16 cluster maps by the weights the drawn mesh uses (`skinCage`: the skin's shape-mode loop over those vertices, in
 * the same order of operations, less the accordion folds, which are `Math.sin`/`Math.exp` and visual), joined by the
 * decimated mesh's 150-330 triangles. Fitted in the body's own frame on every slice the masses moved (`refitCage`), the
 * cage is three fields on a lattice of nodes (`CAGE_STEP`, the grid `Surface.setGridData` takes): the highest and the
 * lowest drawn height over each node (NaN where the cage has none) and the signed plan distance to its outline. The
 * vertices are the rigid step's hull points. Heights are in the body mesh's frame: the class's body lift (a plain y offset)
 * goes on at the car's frame, as `CarSurfaces.sync` adds it today.
 *
 * A pristine car shares its style's fields (one build per style); a car that has crushed owns its own, allocated once, and
 * refitted into in place: a refit allocates nothing. Nothing here knows a car, a world or a pose.
 *
 * @internal Imported by nothing until the Stage 3 lane wires it in (`armTops`, `HULL`, `satCars`, the ragdoll proxies).
 */

/** Node spacing (m) of the fields. */
export const CAGE_STEP = 0.05;
/** The decimation's vertex target: the body and its panels (lids, glass), which keeps the cage near 300 triangles. */
export const CAGE_VERTICES = 220;
/** A style's cage build, counted: its sill candidates (`cageSourceOf`: welded, under its rocker line, between its axles) and loft stations. */
function cageBuildCounts(style: BodyStyle): { sill: number; stations: number; kept: number } {
  const geo = makeChassisGeometry(style, "cage");
  const pos = geo.getAttribute("position").array;
  let axleR = Infinity;
  let axleF = -Infinity;
  for (const [, , z] of carFrame(style).wheels) {
    axleR = Math.min(axleR, z);
    axleF = Math.max(axleF, z);
  }
  const welded = new Set<string>();
  for (let i = 0; i < pos.length; i += 3) {
    const z = pos[i + 2]!;
    const y = Math.round(pos[i + 1]! * 1e4);
    if (y >= rockerAt(z, style) * 1e4 || z <= axleR || z >= axleF) continue;
    welded.add(`${Math.round(pos[i]! * 1e4)},${y},${Math.round(z * 1e4)}`);
  }
  const stations = (geo.userData.loft as { slices: number }).slices;
  const gate = makeTrunkGeometry(style, "cage");
  const kept = (geo.userData.hold as number[]).length + cageGateHold(style, gate).length;
  gate.dispose();
  geo.dispose();
  return { sill: welded.size, stations, kept };
}
const BUILD_COUNTS = CAR_STYLE_IDS.map((id) => cageBuildCounts(CAR_STYLES[id]));
/** Room for a style's sill samples past the hull (`CageSource.sill`): every sample is one of its style's sill candidates, so the most any style has. */
export const SILL_CAPACITY = Math.max(...BUILD_COUNTS.map((c) => c.sill));
/** Room for the underside points the decimation holds over its target (`decimate`'s `held`): at most a station's lowest on each side, every station. */
export const CAGE_HELD_VERTICES = Math.max(...BUILD_COUNTS.map((c) => 2 * c.stations));
/** Room for the vertices a style's cage build keeps through the decimation (`hold`: its C-post's crown points), which cost the hull none of its target: the most any style keeps. */
export const CAGE_KEPT_VERTICES = Math.max(...BUILD_COUNTS.map((c) => c.kept));
/** Room for a style's bed wheel tubs past its decimated hull (`CageSource.tubs`, kept whole): the most any style's cage build carries. */
export const CAGE_TUB_VERTICES = Math.max(...CAR_STYLE_IDS.map((id) => wellHumpGeometry(CAR_STYLES[id], "cage")?.getAttribute("position").count ?? 0));
/** A part decimated on a budget of its own (`CageSource.apart`: a bumper or a door standing on the body), its held points within it: its vertex target. */
const PART_VERTICES = 12;
/** Room for the parts decimated apart past the hull: the two bumpers and the two doors. */
export const CAGE_PART_VERTICES = 4 * PART_VERTICES;
/** Room for a push bar's box, a part apart of its own (`pushBarBox`, its eight corners all held): the cruiser's. */
export const CAGE_BAR_VERTICES = 8;
/** The interior's vertex target: what shows through a gone pane (the dash, the headliner, the seats), a few boxes. */
const INTERIOR_VERTICES = 32;

/** `SkinDynamic.params` slots the shape-mode skin reads that the cage honours (kernels/skin/src/lib.rs, streamed-deform.ts `skin`). */
export const P_CAP = 3;
export const P_ROOF_CLAMP = 4;
export const P_CUT_Y = 9;
export const P_CUT_X = 10;
export const P_CUT_Z = 11;
/** How far a vertex of the rest roof, over the clamp height, may rise and sink (streamed-deform.ts `skin`). */
const ROOF_DOWN = 0.1;
const ROOF_UP = 0.08;
/** The wheel arch's share of the hub's own offset it plants the paint at, with the wheel on and off (streamed-deform.ts `skin`). */
const ARCH_ON = 0.82;
const ARCH_OFF = 0.15;
/** `SkinDynamic.hubs`: 5 numbers per mass. */
const HUB_STRIDE = 5;

/** What the rig hands the cage once per style: the drawn body's rest mesh and the skin's rest-only tables over it. */
export interface CageSource {
  /** The body mesh's rest positions, x, y, z per vertex, and its triangle indices. */
  readonly rest: Float32Array;
  readonly index: ArrayLike<number>;
  /** Per vertex: cluster count, `clusterXf` offsets and weights (`SKIN_K` each); parent masses (`RES_SLOTS` each: offsets into `massPos`, weights) and their rest centroid; the hub mass planting an arch vertex (-1 none). */
  readonly skinN: Uint8Array;
  readonly skinXf: Int32Array;
  readonly skinW: Float64Array;
  readonly resJ: Int32Array;
  readonly resW: Float64Array;
  readonly resC: Float64Array;
  readonly skinHub: Int32Array;
  /** The masses' rest positions, x, y, z each, and the cluster count: the inputs of a pristine car. */
  readonly massRest: Float64Array;
  readonly clusterCount: number;
  /** `cageCoeffs` of the cages at rest. */
  readonly restCo: Float64Array;
  /** Per vertex: cage influences (`INF_K` each): count, `cageCo` offset, (u, v, w, weight). */
  readonly infN: Uint8Array;
  readonly infCo: Int32Array;
  readonly infUvw: Float64Array;
  /** Per source vertex: 0 the body mesh, k + 1 panel k; and the number of panels (at most 255). */
  readonly group: Uint8Array;
  readonly panelCount: number;
  /** Per source vertex: 1 where the decimation may never collapse it (a bumper's face points, a door's slab corners: `cagePanelsOf`). */
  readonly held: Uint8Array;
  /** Ranges of `rest`, its tail, each decimated alone to `PART_VERTICES` and appended past the hull: a part on the body (a bumper, a door) costs the hull none of its budget. */
  readonly apart: readonly { readonly from: number; readonly count: number }[];
  /** Per panel, the origin its mesh is skinned about (`skinPanel`'s), x, y, z. */
  readonly panelOrigin: Float64Array;
  /** A rest vertex over this height (m) is roof: the skin's roof clamp holds it (the rig's `roofClampY`). */
  readonly roofClampY: number;
  /** Per panel: 1 for a glass pane, 0 for a lid, the light bar, a bumper or a door. */
  readonly panelGlass: Uint8Array;
  /** The interior mesh's rest positions (x, y, z per vertex) and triangle indices: seen through a gone pane, so part of the body drawn. */
  readonly interiorRest: Float32Array;
  readonly interiorIndex: ArrayLike<number>;
  /** Offsets into `massPos` (3 each) of the masses `fitInterior` places it by: `INTERIOR_MASSES`, in that order. */
  readonly interiorMass: Int32Array;
  /**
   * Body vertices (indices into `rest`) the cage carries as sill samples: the underside rows under the rocker between the axles, at
   * each row's ends and wherever the lattice can bend the row between two samples (`sillSamples`). A wreck's hull points, on no triangle.
   */
  readonly sill: Int32Array;
  /** The lattice's half extents (m), the body's frame's. */
  readonly lattice: { readonly x: number; readonly z: number };
  /** The body's bed wheel tubs (`BodyStyle.wheelTub`): `count` vertices of `rest` from `from`, kept out of the decimation and whole past the hull. */
  readonly tubs: { readonly from: number; readonly count: number };
  /** The body loft's vertices: the first `loft` of `rest`, one ring a station (the underside the decimation holds where it rises). */
  readonly loft: number;
}

/** What a fit reads of the car now: a `SkinDynamic`, less its lattice coefficients (the cage is the shape-mode skin). */
export interface CageLive {
  /** Per cluster, its skin map (row-major 9): `StreamedDeformation.clusterXf`. */
  readonly X: Float64Array;
  /** Per mass, its particle in the body frame as of the last skin bake (x, y, z): `massPos`. */
  readonly pos: Float64Array;
  /** Per mass: popped (0/1), local x, rest x, local z, rest z. */
  readonly hubs: Float64Array;
  /** `SkinDynamic.params` (12). */
  readonly params: Float64Array;
  /** `cageCoeffs` of every cage (24 each): the cages the lattice vertices ride. */
  readonly co: Float64Array;
  /** Per panel: 1 while its mesh is on the car (a torn-off hood or a shattered pane is not drawn, so it is not the cage). */
  readonly panelOn: Uint8Array;
  /** 1 for a car whose panels follow the cage (`DeformableCar.panelsFollow`: a wreck, or a car carrying a load crush; `skinPanels` runs only then); 0 for a car whose panels stand at rest. */
  panelsFollow: number;
  /** Per panel, where its mesh stands: position (x, y, z), then rotation (x, y, z, w) about it (a bonnet's hinge). */
  readonly panelPose: Float64Array;
}

/** One fit's results: what a pristine style shares among its cars and a crushed car owns. */
export interface CageFields {
  /** The vertices in the body frame, x, y, z each: the hull's (`vertexCount`, the rigid step's hull points), the sill samples (`sillCount`), then the interior's. */
  readonly pos: Float64Array;
  /** Per vertex: its height before the roof imprint's cut (the cut is laid over the nodes by `rasterise`; `pos` carries it for the hull points). */
  readonly rawY: Float64Array;
  /** Per node (row-major, `nu` × `nv`): the highest and the lowest height of the cage over it, NaN where it has none. */
  readonly top: Float32Array;
  readonly bottom: Float32Array;
  /** Per node: 1 where the cage's plan strictly covers it. */
  readonly covered: Uint8Array;
  /** Per node: the panel group (`vertexGroup`) of the part apart (a bumper) that alone covers it; 0 where the body, a lid or a pane covers it, or nothing does. */
  readonly part: Uint8Array;
  /** Per node: signed distance (m) to the plan outline, negative inside. Current only while `planFresh` (`CarCage.planField` makes it so). */
  readonly plan: Float32Array;
  planFresh: boolean;
  /** The drawn triangles' bounds in the body frame: x min, x max, z min, z max (m): the plan extent every box-shaped reader of a car (a prop's footprint, a ramp's width, the lab) takes. */
  readonly planBox: Float64Array;
  /** Bounds on |top| and |bottom| (m): what `Surface.setGridData` takes as `hmax`. */
  heightMax: number;
  /** Per panel (`CageStyle.vertexGroup` k + 1): 1 while its mesh is on the car as of the fit; a torn-off or shattered panel's vertices stay in `pos` but are no part of the drawn body. */
  readonly panelOn: Uint8Array;
}

/** A style's cage: built once from the rig, never changes. */
export interface CageStyle {
  readonly step: number;
  readonly nu: number;
  readonly nv: number;
  /** Frame x and z of node (0, 0). */
  readonly u0: number;
  readonly v0: number;
  readonly vertexCount: number;
  /** Of `vertexCount`, the `heldCount` underside points `decimate` held over `CAGE_VERTICES`, from `heldFrom` on: a wreck's alone (`loadPoints`). */
  readonly heldCount: number;
  readonly heldFrom: number;
  /**
   * The sill samples (`CageSource.sill`) follow the hull's vertices in the per-vertex tables and in `pos`: skinned as they are, on no
   * triangle, so no field reads them. A wreck's rigid step rests on them too (`loadPoints`): a crushed sill bends between the hull's
   * vertices at the arches, under the straight span the hull draws there.
   */
  readonly sillCount: number;
  readonly triCount: number;
  /** The drawn mesh's vertex each cage vertex is: the hull's, then the sill samples. */
  readonly source: Int32Array;
  /** Triangles, three vertex indices each. */
  readonly tris: Uint16Array;
  readonly rest: Float64Array;
  readonly skinN: Uint8Array;
  readonly skinXf: Int32Array;
  readonly skinW: Float64Array;
  readonly resJ: Int32Array;
  readonly resW: Float64Array;
  readonly resC: Float64Array;
  readonly skinHub: Int32Array;
  /** Per vertex: cage influences (`INF_K` each): count, `cageCo` offset, (u, v, w, weight): the skin of a vertex no cluster holds. */
  readonly infN: Uint8Array;
  readonly infCo: Int32Array;
  readonly infUvw: Float64Array;
  /** The rig's mass and cluster counts (the layout of `Fit.last`). */
  readonly massCount: number;
  readonly clusterCount: number;
  /** The inputs of a pristine car, laid out as `Fit.last`: masses, clusters, hubs. */
  readonly restInputs: Float64Array;
  /** Per triangle: 0 the body, k + 1 panel k (a hood, a boot lid, a glass pane: a mesh of its own over the body). */
  readonly triGroup: Uint8Array;
  /** Per cage vertex: 0 the body, k + 1 panel k. */
  readonly vertexGroup: Uint8Array;
  readonly panelCount: number;
  /** The first panel group of the parts apart (`CageSource.apart`, the last panels); `panelCount + 1` where there are none. */
  readonly partGroup: number;
  /** Per panel, the origin its mesh is skinned about (`skinPanel`'s), x, y, z. */
  readonly panelOrigin: Float64Array;
  /** Every panel on, the fit of a pristine car. */
  readonly panelsOn: Uint8Array;
  /** Per panel: 1 for a glass pane, 0 for a lid, a bumper or a door (`CageSource.panelGlass`). */
  readonly panelGlass: Uint8Array;
  /** The interior's vertices follow the sill samples in `pos` (`vertexCount` is the body's alone: the rigid step's hull points are those), and its triangles the body's, in group `panelCount + 1`: never a lid, never cut by the roof imprint. */
  readonly interiorCount: number;
  /** A rest vertex over this height (m) is roof: the skin's roof clamp holds it (the rig's `roofClampY`). */
  readonly roofClampY: number;
  /** The interior's rest positions as `fitInterior` places them with the masses at rest, x, y, z each. */
  readonly interiorRest: Float32Array;
  readonly interiorMass: Int32Array;
  /** The fields of a pristine car, shared by every car of the style. */
  readonly pristine: CageFields;
}

// ---- the skin over the cage's vertices -----------------------------------------------------------------------------

/**
 * The cage's vertices skinned from `live` into `out` (x, y, z each): `StreamedDeformation.skin`'s shape-mode loop over these
 * vertices (parents' particles plus the clusters' maps on the offset from their rest centroid; the travel cap, the roof
 * clamp, the imprint's cut, the wheel arch), in its order of operations, so a vertex lands where the drawn mesh puts it.
 * The accordion folds (sin/exp, visual) are not here: a fold is at most `extraCap` (0.11 m) of drawn paint, not a shape.
 */
function skinCage(style: CageStyle, live: CageLive, out: CageFields): void {
  const { rest, skinN, skinXf, skinW, resJ, resW, resC, skinHub, infN, infCo, infUvw, vertexGroup } = style;
  const X = live.X;
  const co = live.co;
  const pos = live.pos;
  const hubs = live.hubs;
  const cap = live.params[P_CAP]!;
  const roofClamp = live.params[P_ROOF_CLAMP]! !== 0;
  const roofY = style.roofClampY;
  const cutY = live.params[P_CUT_Y]!;
  const cutX = live.params[P_CUT_X]!;
  const cutZ = live.params[P_CUT_Z]!;
  const follow = live.panelsFollow !== 0;
  const panelOrigin = style.panelOrigin;
  for (let i = 0, r = 0, end = style.vertexCount + style.sillCount; i < end; i++, r += 3) {
    const rx = rest[r]!;
    const ry = rest[r + 1]!;
    const rz = rest[r + 2]!;
    let px = 0;
    let py = 0;
    let pz = 0;
    const dx = rx - resC[r]!;
    const dy = ry - resC[r + 1]!;
    const dz = rz - resC[r + 2]!;
    const packed = skinN[i]!;
    const n = packed & SKIN_COUNT_MASK;
    if (n > 0) {
      for (let k = i * SKIN_K, e = k + n; k < e; k++) {
        const o = skinXf[k]!;
        const w = skinW[k]!;
        px += (X[o]! * dx + X[o + 1]! * dy + X[o + 2]! * dz) * w;
        py += (X[o + 3]! * dx + X[o + 4]! * dy + X[o + 5]! * dz) * w;
        pz += (X[o + 6]! * dx + X[o + 7]! * dy + X[o + 8]! * dz) * w;
      }
      const lever = (packed >> SKIN_COUNT_BITS) / SKIN_LEVER_STEPS;
      px = lever * px + (1 - lever) * dx;
      py = lever * py + (1 - lever) * dy;
      pz = lever * pz + (1 - lever) * dz;
      for (let k = i * RES_SLOTS, e = k + RES_SLOTS; k < e; k++) {
        const j = resJ[k]!;
        const w = resW[k]!;
        px += pos[j]! * w;
        py += pos[j + 1]! * w;
        pz += pos[j + 2]! * w;
      }
    } else {
      for (let k = i * INF_K, e = k + infN[i]!; k < e; k++) {
        const o = infCo[k]!;
        const u = infUvw[k * 4]!;
        const v = infUvw[k * 4 + 1]!;
        const w = infUvw[k * 4 + 2]!;
        const wt = infUvw[k * 4 + 3]!;
        px += cageAxis(co, o, u, v, w) * wt;
        py += cageAxis(co, o + 8, u, v, w) * wt;
        pz += cageAxis(co, o + 16, u, v, w) * wt;
      }
    }
    const g = vertexGroup[i]!;
    if (g > 0) {
      // A torn-off lid's mesh is gone and flies as a part of its own: its vertices stay where it sat at rest on the body (the cage's
      // points are the body's, never a part's pose). A shattered pane's vertices stay where the frame holds its opening.
      if (live.panelOn[g - 1] === 0 && style.panelGlass[g - 1] === 0) {
        out.pos[r] = rx;
        out.pos[r + 1] = ry;
        out.pos[r + 2] = rz;
        out.rawY[i] = ry;
        continue;
      }
      // A panel's skin (`skinPanel`) is its lattice alone, and runs only for a crashed car (the cap, the clamp and the cut are the
      // body's); the mesh then stands where its own pose puts it (a bonnet's hinge): that pose about the panel's origin.
      const o = (g - 1) * 7;
      const pose = live.panelPose;
      const pivot = (g - 1) * 3;
      const lx = (follow ? px : rx) - panelOrigin[pivot]!;
      const ly = (follow ? py : ry) - panelOrigin[pivot + 1]!;
      const lz = (follow ? pz : rz) - panelOrigin[pivot + 2]!;
      const qx = pose[o + 3]!;
      const qy = pose[o + 4]!;
      const qz = pose[o + 5]!;
      const qw = pose[o + 6]!;
      const cx = qy * lz - qz * ly;
      const cy = qz * lx - qx * lz;
      const cz = qx * ly - qy * lx;
      out.pos[r] = pose[o]! + lx + 2 * (qw * cx + qy * cz - qz * cy);
      out.pos[r + 1] = pose[o + 1]! + ly + 2 * (qw * cy + qz * cx - qx * cz);
      out.pos[r + 2] = pose[o + 2]! + lz + 2 * (qw * cz + qx * cy - qy * cx);
      out.rawY[i] = out.pos[r + 1]!;
      continue;
    }
    const tx = px - rx;
    const ty = py - ry;
    const tz = pz - rz;
    const travel2 = tx * tx + ty * ty + tz * tz;
    if (travel2 > cap * cap) {
      const t = cap / Math.sqrt(travel2);
      px = rx + tx * t;
      py = ry + ty * t;
      pz = rz + tz * t;
    }
    if (roofClamp && ry > roofY) py = Math.min(Math.max(py, ry - ROOF_DOWN), ry + ROOF_UP);
    const rawHeight = py;
    const cut = cutY + cutX * px + cutZ * pz;
    if (py > cut) py = cut;
    const h = skinHub[i]!;
    if (h >= 0) {
      const o = h * HUB_STRIDE;
      const popped = hubs[o]! !== 0;
      const hx = popped ? rx + hubs[o + 1]! - hubs[o + 2]! : rx;
      const hz = popped ? rz + hubs[o + 3]! - hubs[o + 4]! : rz;
      const keep = archKeep(popped ? ARCH_OFF : ARCH_ON, px - hx, pz - hz);
      px = px * (1 - keep) + hx * keep;
      pz = pz * (1 - keep) + hz * keep;
    }
    out.pos[r] = px;
    out.pos[r + 1] = py;
    out.pos[r + 2] = pz;
    out.rawY[i] = rawHeight;
  }
  placeInterior(style, pos, out);
}

const _pose = new Float64Array(4);

/** The interior's vertices placed into `out` by the masses `massPos` (`interiorPose`: where the drawn interior stands). Not cut by the roof imprint, never a lid. */
function placeInterior(style: CageStyle, massPos: ArrayLike<number>, out: CageFields): void {
  const { interiorMass, interiorRest, interiorCount } = style;
  const vertexCount = style.vertexCount + style.sillCount;
  interiorPose(massPos[interiorMass[0]!]!, massPos[interiorMass[1]!]!, massPos[interiorMass[2]! + 1]!, massPos[interiorMass[2]! + 2]!, _pose);
  for (let i = 0, r = vertexCount * 3; i < interiorCount; i++, r += 3) {
    out.pos[r] = interiorRest[i * 3]! * _pose[0]! + _pose[1]!;
    out.pos[r + 1] = interiorRest[i * 3 + 1]! + _pose[2]!;
    out.pos[r + 2] = interiorRest[i * 3 + 2]! + _pose[3]!;
    out.rawY[vertexCount + i] = out.pos[r + 1]!;
  }
}

// ---- the fields ----------------------------------------------------------------------------------------------------

/** Empty fields over `style`'s lattice. */
function allocateFields(vertexCount: number, nu: number, nv: number, panelCount: number): CageFields {
  return {
    pos: new Float64Array(vertexCount * 3),
    rawY: new Float64Array(vertexCount),
    top: new Float32Array(nu * nv),
    bottom: new Float32Array(nu * nv),
    covered: new Uint8Array(nu * nv),
    part: new Uint8Array(nu * nv),
    plan: new Float32Array(nu * nv),
    planFresh: false,
    planBox: new Float64Array(4),
    heightMax: 0,
    panelOn: new Uint8Array(panelCount),
  };
}

// ---- the car's cage ------------------------------------------------------------------------------------------------

/** `into` ← `live`'s inputs in `last`'s layout, each as the float32 it rounds to: a fit reads exactly these (`unpackInputs`), so a keyframe holds them in half the bytes and restores the same fit. */
function packInputs(live: CageLive, into: Float64Array): void {
  let o = 0;
  for (let k = 0; k < live.pos.length; k++) into[o++] = Math.fround(live.pos[k]!);
  for (let k = 0; k < live.X.length; k++) into[o++] = Math.fround(live.X[k]!);
  for (let k = 0; k < live.hubs.length; k++) into[o++] = Math.fround(live.hubs[k]!);
  for (let k = 0; k < live.co.length; k++) into[o++] = Math.fround(live.co[k]!);
  for (let k = 0; k < live.panelOn.length; k++) into[o++] = live.panelOn[k]!;
  for (let k = 0; k < live.panelPose.length; k++) into[o++] = Math.fround(live.panelPose[k]!);
  into[o++] = live.panelsFollow;
  into[o++] = Math.fround(live.params[P_CAP]!);
  into[o++] = Math.fround(live.params[P_ROOF_CLAMP]!);
  into[o++] = Math.fround(live.params[P_CUT_Y]!);
  into[o++] = Math.fround(live.params[P_CUT_X]!);
  into[o] = Math.fround(live.params[P_CUT_Z]!);
}

/** Empty inputs of a car of `style` (`unpackInputs` fills them). */
function allocateLive(style: CageStyle): CageLive {
  const n = style.massCount;
  const p = style.panelCount;
  return {
    X: new Float64Array(style.clusterCount * 9),
    pos: new Float64Array(n * 3),
    hubs: new Float64Array(n * HUB_STRIDE),
    params: new Float64Array(P_CUT_Z + 1),
    co: new Float64Array(style.restInputs.length - (n * 3 + style.clusterCount * 9 + n * HUB_STRIDE + p * 8 + 6)),
    panelOn: new Uint8Array(p),
    panelsFollow: 0,
    panelPose: new Float64Array(p * 7),
  };
}

/** `out` ← the inputs `packInputs` laid out in `inputs`. */
function unpackInputs(inputs: Float64Array, out: CageLive): void {
  let o = 0;
  for (let k = 0; k < out.pos.length; k++) out.pos[k] = inputs[o++]!;
  for (let k = 0; k < out.X.length; k++) out.X[k] = inputs[o++]!;
  for (let k = 0; k < out.hubs.length; k++) out.hubs[k] = inputs[o++]!;
  for (let k = 0; k < out.co.length; k++) out.co[k] = inputs[o++]!;
  for (let k = 0; k < out.panelOn.length; k++) out.panelOn[k] = inputs[o++]!;
  for (let k = 0; k < out.panelPose.length; k++) out.panelPose[k] = inputs[o++]!;
  out.panelsFollow = inputs[o++]!;
  out.params[P_CAP] = inputs[o++]!;
  out.params[P_ROOF_CLAMP] = inputs[o++]!;
  out.params[P_CUT_Y] = inputs[o++]!;
  out.params[P_CUT_X] = inputs[o++]!;
  out.params[P_CUT_Z] = inputs[o]!;
}

/**
 * How far (m) a mass or hub may be from where the last raster saw it before the cage is re-skinned and re-rasterised: a fifth of the
 * 5 cm fit bar (`CAGE_STEP`'s), so the cage never stands more than 1 cm off what the last raster read, well inside the bar.
 */
const REFIT_EPSILON = CAGE_STEP / 5;

/**
 * Whether `now` differs from `last` (same layout) enough to refit: a mass or a hub more than `epsilon` away, or any panel flag,
 * panel pose, roof clamp or imprint cut at all. The cluster maps and cage coefficients are fitted from the masses, so they move
 * only when a mass does and are not read here.
 */
function movedSince(style: CageStyle, last: Float64Array, now: Float64Array, epsilon: number): boolean {
  const massEnd = style.massCount * 3;
  const hubStart = massEnd + style.clusterCount * 9;
  const hubEnd = hubStart + style.massCount * HUB_STRIDE;
  const tailStart = last.length - (style.panelCount * 8 + 6);
  for (let k = 0; k < massEnd; k++) if (Math.abs(now[k]! - last[k]!) > epsilon) return true;
  for (let k = hubStart; k < hubEnd; k++) if (Math.abs(now[k]! - last[k]!) > epsilon) return true;
  for (let k = tailStart; k < last.length; k++) if (now[k] !== last[k]) return true;
  return false;
}

/** A car's cage: the style it shares, the fields it stands on now, and what it was last fitted from. */
export class CarCage {
  readonly style: CageStyle;
  /** The fields as of the last fit: the style's shared ones while the car is pristine, else the car's own. */
  fields: CageFields;
  /** Counts every fit that changed `fields` (or switched which it is): a consumer pointing at `fields.top` re-points when it moves. */
  serial = 0;
  private own: CageFields | null = null;
  private fitted = false;
  /** How many fits changed the fields (the cost row: a refit is about 160-190 µs at 5 cm). */
  refits = 0;

  /** The car is whole again (a reset, or its skin never baked): back on the style's shared fields, the next `refit` fits afresh. True when that changed `fields`. */
  reset(): boolean {
    this.fitted = false;
    const changed = this.fields !== this.style.pristine;
    if (changed) this.serial++;
    this.fields = this.style.pristine;
    return changed;
  }
  private readonly last: Float64Array;
  private readonly now: Float64Array;
  /** `last` unpacked, for the fit to read (allocated at the first fit of a car off its rest shape). */
  private read: CageLive | null = null;

  constructor(style: CageStyle) {
    this.style = style;
    this.fields = style.pristine;
    this.last = new Float64Array(style.restInputs.length);
    this.now = new Float64Array(style.restInputs.length);
  }

  /** Whether the cage is its style's pristine one (every car of the style standing on the same fields). */
  get pristine(): boolean {
    return this.fields === this.style.pristine;
  }

  /** A car's cage for `key` (its body style: cars of one style share a build) on a lattice of `step`-metre nodes; `source` is read only on the style's first use. */
  static shared(key: object, source: () => CageSource, step: number = CAGE_STEP): CarCage {
    return cageFor(key, source, step);
  }

  /** The plan distance field of the fields as of the last fit (see `planFieldOf`): made current on the first ask after a fit. */
  planField(): Float32Array {
    return planFieldOf(this.style, this.fields);
  }

  /**
   * Fits the cage to `live`: a no-op (false) while every mass and hub is within `REFIT_EPSILON` of where the last fit saw it (and no
   * panel or imprint input changed), else the cage's vertices re-skinned and its fields re-rasterised (true, `serial` and `refits` up).
   * With `exact`, any change of an input refits (the bake a crush window ends on, which a client fits fresh). A car back at rest goes back to
   * its style's shared fields. Allocates once, the first time a car leaves rest (its own fields); never again.
   */
  refit(live: CageLive, exact = false): boolean {
    packInputs(live, this.now);
    if (this.fitted && !movedSince(this.style, this.last, this.now, exact ? 0 : REFIT_EPSILON)) return false;
    this.last.set(this.now);
    this.fit(this.last);
    return true;
  }

  /** `fields` ← the cage fitted to `inputs` (a `packInputs` layout: what the last fit read, whole): the style's shared ones for a pristine car, else the car's own, re-skinned and re-rasterised. */
  private fit(inputs: Float64Array): void {
    const style = this.style;
    this.fitted = true;
    this.refits++;
    if (isPristine(style, inputs)) {
      this.fields = style.pristine;
    } else {
      const live = (this.read ??= allocateLive(style));
      unpackInputs(inputs, live);
      const own = (this.own ??= allocateFields(style.vertexCount + style.sillCount + style.interiorCount, style.nu, style.nv, style.panelCount));
      skinCage(style, live, own);
      own.panelOn.set(live.panelOn);
      rasterise(style, own, live.panelOn, live.params[P_CUT_Y]!, live.params[P_CUT_X]!, live.params[P_CUT_Z]!);
      this.fields = own;
    }
    this.serial++;
  }

  /**
   * The refit history a keyframe carries (the cage is a function of the sim's bakes, but a bake within `REFIT_EPSILON` of the last fit is
   * not fitted, so what it stands on depends on that fit): 1 if the cage was fitted, then the inputs of its last fit as float32 (they are
   * single-precision already: `packInputs`), two to a number, `stateSize()` numbers.
   */
  stateSize(): number {
    return 1 + Math.ceil(this.last.length / 2);
  }

  writeState(buf: Float64Array): void {
    buf[0] = this.fitted ? 1 : 0;
    const into = new Float32Array(buf.buffer, buf.byteOffset + 8, 2 * (this.stateSize() - 1));
    into.set(this.last);
    into.fill(0, this.last.length);
  }

  /** The cage as `writeState` left it: refitted from the recorded inputs (so its fields are the recorded ones, bit for bit), or back on the style's shared fields if it was never fitted. Allocates once (a restore is cold). */
  readState(buf: Float64Array): void {
    if (buf[0] === 0) {
      this.reset();
      return;
    }
    this.last.set(new Float32Array(buf.buffer, buf.byteOffset + 8, this.last.length));
    this.fit(this.last);
  }
}

/** Whether `inputs` (`packInputs`' layout) are a pristine car's: every particle and map at rest, the wheels on, no roof imprint. */
function isPristine(style: CageStyle, inputs: Float64Array): boolean {
  const rest = style.restInputs;
  const n = rest.length - 5;
  for (let k = 0; k < n; k++) if (Math.abs(inputs[k]! - rest[k]!) > REST_TOLERANCE) return false;
  return inputs[n + 2] === IMPRINT_NONE && inputs[n + 3] === 0 && inputs[n + 4] === 0;
}

/**
 * How far (m, or per metre for the cluster maps and cage coefficients) an input may be from rest and still be the pristine car:
 * a car at rest sits a fraction of a millimetre off its rest particles (the maps are least-squares fits to them).
 */
const REST_TOLERANCE = 2e-3;


// ---- building a style's cage -----------------------------------------------------------------------------------------

const STYLES = new WeakMap<object, Map<number, CageStyle>>();

/** `CarCage.shared`. */
function cageFor(key: object, source: () => CageSource, step: number): CarCage {
  let byStep = STYLES.get(key);
  if (!byStep) STYLES.set(key, (byStep = new Map()));
  let style = byStep.get(step);
  if (!style) byStep.set(step, (style = buildStyle(source(), step)));
  return new CarCage(style);
}

/** The skin tables `CageStyle` holds per vertex, taken from `src` for the cage vertices `source` (indices into its vertices), in that order. */
type VertexTables = Pick<CageStyle, "rest" | "skinN" | "skinXf" | "skinW" | "resJ" | "resW" | "resC" | "skinHub" | "infN" | "infCo" | "infUvw">;

function vertexTables(src: CageSource, source: Int32Array): VertexTables {
  const n = source.length;
  const t = {
    rest: new Float64Array(n * 3),
    skinN: new Uint8Array(n),
    skinXf: new Int32Array(n * SKIN_K),
    skinW: new Float64Array(n * SKIN_K),
    resJ: new Int32Array(n * RES_SLOTS),
    resW: new Float64Array(n * RES_SLOTS),
    resC: new Float64Array(n * 3),
    skinHub: new Int32Array(n),
    infN: new Uint8Array(n),
    infCo: new Int32Array(n * INF_K),
    infUvw: new Float64Array(n * INF_K * 4),
  };
  for (let i = 0; i < n; i++) {
    const v = source[i]!;
    for (let k = 0; k < 3; k++) {
      t.rest[i * 3 + k] = src.rest[v * 3 + k]!;
      t.resC[i * 3 + k] = src.resC[v * 3 + k]!;
    }
    t.skinN[i] = src.skinN[v]!;
    t.skinHub[i] = src.skinHub[v]!;
    for (let k = 0; k < SKIN_K; k++) {
      t.skinXf[i * SKIN_K + k] = src.skinXf[v * SKIN_K + k]!;
      t.skinW[i * SKIN_K + k] = src.skinW[v * SKIN_K + k]!;
    }
    for (let k = 0; k < RES_SLOTS; k++) {
      t.resJ[i * RES_SLOTS + k] = src.resJ[v * RES_SLOTS + k]!;
      t.resW[i * RES_SLOTS + k] = src.resW[v * RES_SLOTS + k]!;
    }
    t.infN[i] = src.infN[v]!;
    for (let k = 0; k < INF_K; k++) {
      t.infCo[i * INF_K + k] = src.infCo[v * INF_K + k]!;
      for (let c = 0; c < 4; c++) t.infUvw[(i * INF_K + k) * 4 + c] = src.infUvw[(v * INF_K + k) * 4 + c]!;
    }
  }
  return t;
}

/** The inputs of a pristine car of `src`, laid out as `Fit.last`: the masses at rest, identity cluster maps, the hubs at rest, the cages at rest, every panel on at its origin, no roof imprint. */
function restInputsOf(src: CageSource): Float64Array {
  const massCount = src.massRest.length / 3;
  const restInputs = new Float64Array(massCount * 3 + src.clusterCount * 9 + massCount * HUB_STRIDE + src.restCo.length + src.panelCount * 8 + 1 + 5);
  let o = 0;
  for (let k = 0; k < src.massRest.length; k++) restInputs[o++] = src.massRest[k]!;
  for (let c = 0; c < src.clusterCount; c++) {
    restInputs[o] = 1;
    restInputs[o + 4] = 1;
    restInputs[o + 8] = 1;
    o += 9;
  }
  for (let j = 0; j < massCount; j++) {
    restInputs[o++] = 0;
    restInputs[o++] = src.massRest[j * 3]!;
    restInputs[o++] = src.massRest[j * 3]!;
    restInputs[o++] = src.massRest[j * 3 + 2]!;
    restInputs[o++] = src.massRest[j * 3 + 2]!;
  }
  for (let k = 0; k < src.restCo.length; k++) restInputs[o++] = src.restCo[k]!;
  restInputs.fill(1, o, o + src.panelCount);
  o += src.panelCount;
  for (let k = 0; k < src.panelCount; k++) {
    restInputs[o] = src.panelOrigin[k * 3]!;
    restInputs[o + 1] = src.panelOrigin[k * 3 + 1]!;
    restInputs[o + 2] = src.panelOrigin[k * 3 + 2]!;
    restInputs[o + 6] = 1;
    o += 7;
  }
  o += 1;
  restInputs[o + 2] = IMPRINT_NONE;
  return restInputs;
}

/** `src.sill` less the samples the decimation kept: a hull vertex at the same rest position already carries that point. */
function sillOffHull(src: CageSource, hull: Int32Array): Int32Array {
  const at = (v: number): string => `${Math.round(src.rest[v * 3]! * 1e4)},${Math.round(src.rest[v * 3 + 1]! * 1e4)},${Math.round(src.rest[v * 3 + 2]! * 1e4)}`;
  const kept = new Set(Array.from(hull, at));
  const sill = src.sill.filter((v) => !kept.has(at(v)));
  if (sill.length > SILL_CAPACITY) throw new Error(`${sill.length} sill samples, room for ${SILL_CAPACITY}`);
  return sill;
}

/**
 * The hull: `src`'s body and panels decimated to `CAGE_VERTICES` (and the underside points it holds over that) exactly as the same body
 * without its wheel tubs and its parts apart (`CageSource.apart`), then the tubs' vertices (welded) and triangles, then each part decimated
 * alone to `PART_VERTICES`, so neither costs the hull any of its budget.
 */
function hullOf(src: CageSource): { source: Int32Array; tris: Uint16Array; triGroup: Uint8Array; held: number; heldFrom: number } {
  const { from, count } = src.tubs;
  const to = from + count;
  const end = src.apart[0]?.from ?? src.group.length;
  const rest = new Float32Array((end - count) * 3);
  rest.set(src.rest.subarray(0, from * 3));
  rest.set(src.rest.subarray(to * 3, end * 3), from * 3);
  const group = new Uint8Array(end - count);
  group.set(src.group.subarray(0, from));
  group.set(src.group.subarray(to, end), from);
  const held = new Uint8Array(end - count);
  held.set(src.held.subarray(0, from));
  held.set(src.held.subarray(to, end), from);
  const index: number[] = [];
  const tubTris: number[] = [];
  for (let t = 0; t + 2 < src.index.length; t += 3) {
    const tri = [src.index[t]!, src.index[t + 1]!, src.index[t + 2]!];
    if (tri[0]! >= end) continue;
    if (tri.every((v) => v >= from && v < to)) tubTris.push(...tri);
    else index.push(...tri.map((v) => (v < from ? v : v - count)));
  }
  const kept = held.reduce((n, h) => n + h, 0);
  const hull = decimate(rest, index, group, CAGE_VERTICES + kept, Math.min(src.loft, from), held);
  const source = Array.from(hull.source, (v) => (v < from ? v : v + count));
  const slots = new Map<string, number>();
  const slotOf = new Int32Array(count);
  for (let v = from; v < to; v++) {
    const key = `${Math.round(src.rest[v * 3]! * 1e4)},${Math.round(src.rest[v * 3 + 1]! * 1e4)},${Math.round(src.rest[v * 3 + 2]! * 1e4)}`;
    let slot = slots.get(key);
    if (slot === undefined) {
      slot = source.length;
      slots.set(key, slot);
      source.push(v);
    }
    slotOf[v - from] = slot;
  }
  const tris = Array.from(hull.tris);
  const triGroup = Array.from(hull.triGroup);
  for (let k = 0; k < tubTris.length; k += 3) {
    const [a, b, c] = [slotOf[tubTris[k]! - from]!, slotOf[tubTris[k + 1]! - from]!, slotOf[tubTris[k + 2]! - from]!];
    if (a === b || b === c || a === c) continue;
    tris.push(a, b, c);
    triGroup.push(src.group[tubTris[k]!]!);
  }
  appendParts(src, end, source, tris, triGroup);
  const room = CAGE_VERTICES + CAGE_HELD_VERTICES + CAGE_KEPT_VERTICES + CAGE_TUB_VERTICES + CAGE_PART_VERTICES + CAGE_BAR_VERTICES;
  if (source.length > room) throw new Error(`${source.length} hull vertices, room for ${room}`);
  return { source: Int32Array.from(source), tris: Uint16Array.from(tris), triGroup: Uint8Array.from(triGroup), held: hull.held, heldFrom: hull.heldFrom };
}

/** Each of `src`'s parts apart (`CageSource.apart`: the source's tail from `end`) decimated alone to `PART_VERTICES`, appended to a hull's `source`, `tris` and `triGroup`. */
function appendParts(src: CageSource, end: number, source: number[], tris: number[], triGroup: number[]): void {
  let next = end;
  for (const part of src.apart) {
    if (part.from !== next) throw new Error(`a part apart at ${part.from} is not the source's tail (${next})`);
    next = part.from + part.count;
    const own: number[] = [];
    for (let t = 0; t + 2 < src.index.length; t += 3) {
      if (src.index[t]! < part.from || src.index[t]! >= next) continue;
      own.push(src.index[t]! - part.from, src.index[t + 1]! - part.from, src.index[t + 2]! - part.from);
    }
    const sub = decimate(src.rest.subarray(part.from * 3, next * 3), own, src.group.subarray(part.from, next), PART_VERTICES, 0, src.held.subarray(part.from, next));
    if (sub.source.length > PART_VERTICES) throw new Error(`${sub.source.length} vertices of a part apart, room for ${PART_VERTICES}`);
    const base = source.length;
    for (const v of sub.source) source.push(v + part.from);
    for (const v of sub.tris) tris.push(v + base);
    triGroup.push(...sub.triGroup);
  }
}

function buildStyle(src: CageSource, step: number): CageStyle {
  const body = hullOf(src);
  const top = upFacing(src.interiorRest, src.interiorIndex);
  const inner = decimate(top.rest, top.index, new Uint8Array(top.rest.length / 3), INTERIOR_VERTICES);
  const n = body.source.length;
  const source = Int32Array.from([...body.source, ...sillOffHull(src, body.source)]);
  const points = source.length;
  const ni = inner.source.length;
  const bodyTris = body.tris.length / 3;
  const tris = new Uint16Array(body.tris.length + inner.tris.length);
  tris.set(body.tris);
  for (let k = 0; k < inner.tris.length; k++) tris[body.tris.length + k] = inner.tris[k]! + points;
  const interiorRest = new Float32Array(ni * 3);
  for (let i = 0; i < ni; i++) for (let k = 0; k < 3; k++) interiorRest[i * 3 + k] = top.rest[inner.source[i]! * 3 + k]!;
  const tables = vertexTables(src, source);
  const nu = 2 * Math.round(src.lattice.x / step) + 1;
  const nv = 2 * Math.round(src.lattice.z / step) + 1;
  const style: CageStyle = {
    step,
    nu,
    nv,
    u0: -src.lattice.x,
    v0: -src.lattice.z,
    vertexCount: n,
    heldCount: body.held,
    heldFrom: body.heldFrom,
    sillCount: points - n,
    triCount: tris.length / 3,
    source,
    tris,
    ...tables,
    restInputs: restInputsOf(src),
    massCount: src.massRest.length / 3,
    clusterCount: src.clusterCount,
    pristine: allocateFields(points + ni, nu, nv, src.panelCount),
    triGroup: Uint8Array.from({ length: tris.length / 3 }, (_, t) => (t < bodyTris ? body.triGroup[t]! : src.panelCount + 1)),
    vertexGroup: Uint8Array.from(source, (v) => src.group[v]!),
    panelCount: src.panelCount,
    partGroup: src.apart.length > 0 ? src.group[src.apart[0]!.from]! : src.panelCount + 1,
    interiorCount: ni,
    interiorRest,
    interiorMass: src.interiorMass,
    panelsOn: new Uint8Array(src.panelCount).fill(1),
    panelGlass: src.panelGlass,
    panelOrigin: src.panelOrigin,
    roofClampY: src.roofClampY,
  };
  style.pristine.pos.set(tables.rest);
  style.pristine.panelOn.fill(1);
  for (let i = 0; i < points; i++) style.pristine.rawY[i] = tables.rest[i * 3 + 1]!;
  placeInterior(style, src.massRest, style.pristine);
  rasterise(style, style.pristine, style.panelsOn, IMPRINT_NONE, 0, 0);
  return style;
}

/**
 * `sampleAt`'s query and answer: frame x and z in `SAMPLE[0]`, `SAMPLE[1]`, the value out in `SAMPLE[2]`. A call V8 does not inline
 * boxes every double it takes or returns, and the per-node loops of `satCars` make thousands of them a frame.
 */
export const SAMPLE = new Float64Array(3);

/** `field` (a per-node lattice field of `style`) bilinear at frame (`SAMPLE[0]`, `SAMPLE[1]`) → `SAMPLE[2]`; NaN outside the lattice. */
export function sampleAt(field: Float32Array, style: CageStyle): void {
  const fu = (SAMPLE[0]! - style.u0) / style.step;
  const fv = (SAMPLE[1]! - style.v0) / style.step;
  const i = Math.floor(fu);
  const j = Math.floor(fv);
  if (i < 0 || j < 0 || i + 1 >= style.nu || j + 1 >= style.nv) {
    SAMPLE[2] = NaN;
    return;
  }
  const a = fu - i;
  const b = fv - j;
  const k = j * style.nu + i;
  SAMPLE[2] = (field[k]! * (1 - a) + field[k + 1]! * a) * (1 - b) + (field[k + style.nu]! * (1 - a) + field[k + style.nu + 1]! * a) * b;
}
