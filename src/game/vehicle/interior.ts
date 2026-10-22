import * as THREE from "three";
import type { StreamedDeformation } from "../deform/streamed-deform.ts";
import { detAtan2, detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import type { MassName } from "../kernel/rig-spec.ts";
import type { DetachPart } from "./car-core.ts";
import { beltX, floorY } from "./car-lines.ts";
import { bayTub, roofAt, sampleSlice } from "./car-mesh.ts";
import { carFrame } from "./car-rig.ts";
import type { BodyStyle } from "./car-variants.ts";
import { BUMPER_F, DRIVER_SIDE, INNER_PANEL, LID, PRIMER_ATTRIBUTE } from "./constants.ts";
import { AXLE_HALF_SPAN, REF_BAY, REF_CABIN, SEAT_RECLINE, WHEEL_AT, WHEEL_GRIP, WHEEL_TILT } from "./interior-geometry.ts";
import { PART_KIND, type PartSeat } from "./part-geometry.ts";
import { activeGround, NO_FLOOR } from "../world/ground.ts";

/** Gap (m) between a seated head's top and the roof line over it (the roof skin, the headliner its inner face). */
const HEAD_CLEAR = 0.05;
/** The seated dummy's head centre along his back from the H-point, its radius, and his shoulders along his back (m): `PARTS`/`JOINTS` over the hips' 0.84. */
const HEAD = { up: 0.79, r: 0.11 } as const;
const SHOULDER_UP = 0.51;
/** The most a seat leans back past `SEAT_RECLINE` (rad) to keep a head under a low roof, and the step it tries. */
const RECLINE_MAX = 0.35;
const RECLINE_STEP = 0.01;
/** The driver's soles: across from his H-point (his hips' half-spread), ahead of it, and over the cabin floor (m). */
const FEET = { x: 0.09, ahead: 0.8, lift: 0.04 } as const;
/** The cabin's sides stand this far (m) inside the side glass sill, the top of its `REF_CABIN` box this far under the roof line at the B-pillar. */
const CABIN_INSET = 0.05;
const HEADLINER_DROP = 0.03;
/** The bay's sides stand this far (m) inside the nose's narrowest station over it; its top this far under the deck line (the hood lid's underside). */
const BAY_INSET = 0.06;
const HOOD_UNDER = 0.024;
/** The bay shows once the hood hinges open past this (or is shown open); a crash bar once its bumper hangs past this. */
const BAY_OPEN = 0.05;
const BAR_OPEN = 0.5;
/** A gone bumper bares the body from this far (m) inside its seat out, up to this far over it. */
const BARE_REACH = { inward: 0.25, up: 0.14 } as const;

/** Where the driver sits (car space, m): his H-point, his back's lean from upright (rad), the wheel's centre, his grips on it and his soles, [his right (-x), his left]. */
interface DriverPlace {
  hip: THREE.Vector3;
  recline: number;
  wheel: THREE.Vector3;
  grips: readonly [THREE.Vector3, THREE.Vector3];
  feet: readonly [THREE.Vector3, THREE.Vector3];
}

const driverSeats = new WeakMap<BodyStyle, DriverPlace>();

/** The lean that keeps a head on a back from `hip` under `style`'s roof: `SEAT_RECLINE`, or more under a low roof. */
function reclineUnder(style: BodyStyle, hip: THREE.Vector3): number {
  for (let r = SEAT_RECLINE; r < SEAT_RECLINE + RECLINE_MAX; r += RECLINE_STEP) {
    const crown = hip.y + HEAD.up * detCos(r) + HEAD.r;
    if (crown <= roofAt(hip.z - HEAD.up * detSin(r), style).y - HEAD_CLEAR) return r;
  }
  return SEAT_RECLINE + RECLINE_MAX;
}

/** `style`'s driver seat (`BodyStyle.seats.front`), built once per style. */
export function driverSeat(style: BodyStyle): DriverPlace {
  const known = driverSeats.get(style);
  if (known) return known;
  const [across, up, along] = style.seats.front;
  const hip = new THREE.Vector3(DRIVER_SIDE * across, up, along);
  const recline = reclineUnder(style, hip);
  // The wheel follows his shoulders as a lower roof leans him back.
  const wheel = new THREE.Vector3(...WHEEL_AT)
    .add(hip)
    .add(new THREE.Vector3(0, detCos(recline) - detCos(SEAT_RECLINE), detSin(SEAT_RECLINE) - detSin(recline)).multiplyScalar(SHOULDER_UP));
  const tilt = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), WHEEL_TILT);
  const grip = (side: number) => new THREE.Vector3(side * WHEEL_GRIP[0], WHEEL_GRIP[1], WHEEL_GRIP[2]).applyQuaternion(tilt).add(wheel);
  const floor = style.tubs[0]![2];
  const foot = (side: number) => new THREE.Vector3(hip.x + side * FEET.x, floor + FEET.lift, hip.z + FEET.ahead);
  const seat: DriverPlace = { hip, recline, wheel, grips: [grip(-1), grip(1)], feet: [foot(-1), foot(1)] };
  driverSeats.set(style, seat);
  return seat;
}

/** Seat `seat` at `p`, leaned back `lean` past the seat's own recline (rad), scaled `sx` across and `sz` deep. */
function place(seat: PartSeat, x: number, y: number, z: number, lean = 0, sx = 1, sz = 1): void {
  seat.position.set(x, y, z);
  seat.rotation.set(-lean, 0, 0);
  seat.scale.set(sx, 1, sz);
  seat.updateMatrix();
}

/** `seat` mapping `ref`'s box onto [x0..x1, y0..y1, z0..z1] half-width `halfX`. */
function fitBox(seat: PartSeat, ref: { halfX: number; y0: number; y1: number; z0: number; z1: number }, halfX: number, y0: number, y1: number, z0: number, z1: number): void {
  const sy = (y1 - y0) / (ref.y1 - ref.y0);
  const sz = (z1 - z0) / (ref.z1 - ref.z0);
  seat.scale.set(halfX / ref.halfX, sy, sz);
  seat.position.set(0, y0 - ref.y0 * sy, z0 - ref.z0 * sz);
  seat.updateMatrix();
}

/** Half the cab's back wall (m): its drawn box is 4.5 cm deep about `rearBulkhead.z`. */
const WALL_HALF = 0.0225;
/** Air (m) between the bench and the wall's face or the roof line, so they never z-fight. */
const BENCH_GAP = 0.01;
/** The step (m) the roof line is read back from the bench's H-point at: as fine as the gap. */
const BENCH_STEP = 0.01;

/**
 * The depth (z) scale, at most 1, that keeps the bench seated at `back` ([y, z]) in the cab: ahead of the back wall under its top, ahead
 * of the rear glass over it (a crew cab's back glass leans forward over the wall), and under the roof line over it (a pickup cab's ends at
 * its back glass, the bed's wall top behind it). A 2+2's or a crew cab's shallow bench.
 */
function benchDepth(bench: THREE.BufferGeometry, [y, z]: readonly [number, number], style: BodyStyle): number {
  const wall = style.rearBulkhead;
  const { base, top } = style.rearGlass;
  const pos = bench.getAttribute("position");
  let depth = 1;
  for (let i = 0; i < pos.count; i++) {
    const behind = -pos.getZ(i);
    if (behind <= 0) continue;
    const at = y + pos.getY(i);
    let room = at < wall.yTop ? z - wall.z - WALL_HALF - BENCH_GAP : behind;
    if (at >= wall.yTop && at > base[0] && at < top[0]) room = Math.min(room, z - (base[1] + ((at - base[0]) / (top[0] - base[0])) * (top[1] - base[1])) - BENCH_GAP);
    for (let r = 0; r < room; r += BENCH_STEP) {
      if (roofAt(z - r, style).y >= at + BENCH_GAP) continue;
      room = Math.max(0, r - BENCH_STEP);
      break;
    }
    depth = Math.min(depth, Math.max(0, room) / behind);
  }
  return depth;
}

const _bay = new THREE.Vector3();
const _mass = new THREE.Vector3();

/**
 * A car's interior kit and engine bay, all `PartBatch` seats of the shared props, placed by its style: the cabin shell, both front
 * seats, the rear bench (none on a regular cab), the wheel on the driver's side, the bay under the hood and a crash bar at each end.
 */
export class CarCabin {
  /** The cabin's pose (`car.interior`): `fitInterior` moves it with the crushed cell. */
  readonly pose = new THREE.Group();
  /** The bay, then the front and rear crash bars. */
  private readonly under: readonly PartSeat[];
  private readonly rests: readonly THREE.Vector3[];
  /** Rest positions of the masses the bay and bars ride: engine, front bumper, rear bumper, each pair [left, right]. */
  private readonly massRest: readonly (readonly [MassName, THREE.Vector3])[];
  /** The cabin shell, its floor and top (car space, m) at rest, and the roof mass's rest height: the shell squeezes under the roof. */
  private readonly shell: PartSeat;
  private readonly shellY: readonly [floor: number, top: number];
  private readonly roofRest: number;
  /** The bay's rear and front at rest (m, car z), and each of `under`'s z drift this frame. */
  private readonly bayZ: readonly [rear: number, front: number];
  private readonly driftZ = new Float64Array(3);

  constructor(style: BodyStyle, seats: readonly PartSeat[], group: THREE.Object3D) {
    const of = (kind: number) => seats.filter((s) => s.kind === kind);
    const [cabin] = of(PART_KIND.interior);
    const [driver, passenger] = of(PART_KIND.seatFront);
    const [rear] = of(PART_KIND.seatRear);
    const [wheel] = of(PART_KIND.wheel);
    const [bay] = of(PART_KIND.engineBay);
    const bars = of(PART_KIND.crashBar);
    const seat = driverSeat(style);
    const lean = seat.recline - SEAT_RECLINE;
    const bMid = (style.bPillar.rear + style.bPillar.front) * 0.5;
    const roof = roofAt(bMid, style).y - HEADLINER_DROP;
    const halfX = beltX(bMid, style) - CABIN_INSET;
    const floor = style.tubs[0]![2];
    fitBox(cabin!, { halfX: REF_CABIN.halfX, y0: REF_CABIN.floor, y1: REF_CABIN.roof, z0: REF_CABIN.rear, z1: REF_CABIN.front }, halfX, floor, roof, style.rearBulkhead.z, style.windshield.base[1]);
    this.shell = cabin!;
    this.shellY = [floor, roof];
    place(driver!, seat.hip.x, seat.hip.y, seat.hip.z, lean);
    place(passenger!, -seat.hip.x, seat.hip.y, seat.hip.z, lean);
    wheel!.position.copy(seat.wheel);
    wheel!.rotation.set(WHEEL_TILT, 0, 0);
    wheel!.updateMatrix();
    this.pose.add(cabin!, driver!, passenger!, wheel!);
    const back = style.seats.rear;
    if (back) {
      place(rear!, 0, back[0], back[1], 0, halfX / REF_CABIN.halfX, benchDepth(rear!.geometry, back, style));
      this.pose.add(rear!);
    }

    const [zRear, zFront, troughFloor] = bayTub(style);
    let bayHalf = Infinity;
    for (let z = zRear; z <= zFront; z += 0.1) bayHalf = Math.min(bayHalf, sampleSlice(z, style.profile).hw - BAY_INSET);
    // On the floor pan where it rides over the trough's floor, as the drawn trough is (`tubAt`); over a bay the pan only rises toward the nose.
    const bayFloor = Math.max(troughFloor, floorY(zRear, style), floorY(zFront, style));
    const bayTop = sampleSlice((zRear + zFront) * 0.5, style.profile).yBelt - HOOD_UNDER;
    fitBox(bay!, { halfX: REF_BAY.halfX, y0: REF_BAY.floor, y1: REF_BAY.top, z0: REF_BAY.rear, z1: REF_BAY.front }, bayHalf, bayFloor, bayTop, zRear, zFront);
    this.bayZ = [zRear, zFront];
    const { front, rear: tail } = style.bumpers;
    bars[0]!.position.set(0, front.seat.y, front.seat.z);
    bars[1]!.position.set(0, tail.seat.y, -tail.seat.z);
    bars[1]!.rotation.set(0, Math.PI, 0);
    bars[0]!.updateMatrix();
    bars[1]!.updateMatrix();
    group.add(this.pose, bay!, ...bars);

    this.under = [bay!, ...bars];
    this.rests = this.under.map((s) => s.position.clone());
    const rig = carFrame(style).rig.masses;
    const restOf = (name: MassName): readonly [MassName, THREE.Vector3] => [name, new THREE.Vector3(...rig.find((m) => m.name === name)!.rest)];
    this.massRest = (["engineL", "engineR", "bumperFL", "bumperFR", "bumperRL", "bumperRR"] as const).map(restOf);
    this.roofRest = restOf("roof")[1].y;
  }

  /** The bay shows while the hood is off or open, each crash bar while its bumper is off or hanging: `parts` are the car's own. */
  watch(parts: readonly DetachPart[]): void {
    const hood = parts.find((p) => p.name === LID.hood)!;
    const front = parts.find((p) => p.name === BUMPER_F)!;
    const rear = parts.find((p) => p.bumper && p !== front)!;
    this.under[0]!.showIf = () => hood.detached || hood.shown || hood.hingeT > BAY_OPEN;
    this.under[1]!.showIf = () => front.detached || front.hingeT > BAR_OPEN;
    this.under[2]!.showIf = () => rear.detached || rear.hingeT > BAR_OPEN;
  }

  /** The bay rides the engine masses through a crush, its front no further out than the nose (the front bumper's masses), and each bar its bumper's: once a frame on a crashed car, at rest without (`deform` null). */
  fit(deform: StreamedDeformation | null): void {
    for (let k = 0; k < this.under.length; k++) {
      const seat = this.under[k]!;
      seat.position.copy(this.rests[k]!);
      this.driftZ[k] = 0;
      if (deform === null) continue;
      const [l, lRest] = this.massRest[2 * k]!;
      const [r, rRest] = this.massRest[2 * k + 1]!;
      _bay.copy(deform.massLocal(l)).sub(lRest);
      _mass.copy(deform.massLocal(r)).sub(rRest);
      seat.position.add(_bay.add(_mass).multiplyScalar(0.5));
      this.driftZ[k] = _bay.z;
    }
    const [zRear, zFront] = this.bayZ;
    const [engine, nose] = this.driftZ;
    const bay = this.under[0]!;
    const sz = (zFront + Math.min(engine!, nose!) - zRear - engine!) / (REF_BAY.front - REF_BAY.rear);
    bay.scale.z = sz;
    bay.position.z = zRear + engine! - REF_BAY.rear * sz;
    for (let k = 0; k < this.under.length; k++) this.under[k]!.updateMatrix();
  }

  /** The shell squeezes by the roof mass's drop to `roofY` (car space; null: at rest), a load's crush too: its dash and screen stand 0.3 m under the roof line, less than a 0.4 m crush. */
  squeezeUnderRoof(roofY: number | null): void {
    const [floor, top] = this.shellY;
    // The pose already moved the shell by the cell's y; only the roof's further drop squeezes it.
    const sink = roofY === null ? 0 : Math.min(0, roofY - this.roofRest - this.pose.position.y);
    const sy = (top + sink - floor) / (REF_CABIN.roof - REF_CABIN.floor);
    this.shell.scale.y = sy;
    this.shell.position.y = floor - REF_CABIN.floor * sy;
    this.shell.updateMatrix();
  }
}

/** Each axle's wheels (`car.wheels` order FL, FR, RL, RR) from its −x end to its +x end: turned half round, the front one's +z points back, to the car's middle as the rear one's does. */
const AXLE_ENDS = [[1, 0, Math.PI], [2, 3, 0]] as const;
/** A gone wheel's axle end stands at least this far (m) over the ground under it: the tube's 6.5 cm radius and its tip 5 cm inboard of the hub. */
const STUB_CLEAR = 0.08;
/** The ground under a gone wheel's axle end is looked up from this far (m) over it: a stub already in a slope finds no floor under itself. */
// ponytail: under a bridge deck within this of the stub, the lookup finds the deck; fine for a wreck's side.
const STUB_PROBE = 1.5;
const _p = new THREE.Vector3();
const _q = new THREE.Vector3();

/** A lifted truck's undercarriage, `PartBatch` seats: the ladder frame rides the body, an axle rides each pair of wheels where they are drawn. */
export class CarUnderbody {
  /** Front, rear; they ride with the wheels (`assignClass` hangs them in the hub group). */
  readonly axles: readonly PartSeat[];
  private readonly wheels: readonly THREE.Object3D[];
  /** Each wheel's rest hub: where a popped wheel's end of its axle stays. */
  private readonly rests: readonly THREE.Vector3[];

  constructor(seats: readonly PartSeat[], group: THREE.Object3D, wheels: readonly THREE.Object3D[]) {
    const frame = seats.find((s) => s.kind === PART_KIND.ladderFrame)!;
    this.axles = seats.filter((s) => s.kind === PART_KIND.axle);
    this.wheels = wheels;
    this.rests = wheels.map((w) => w.position.clone());
    group.add(frame, ...this.axles);
    this.follow();
  }

  /** Each axle onto its wheels' hubs, tilted with them; a wheel that left the car leaves its end on its rest hub, lifted clear of the ground (`stub`). */
  follow(): void {
    for (let k = 0; k < 2; k++) {
      const axle = this.axles[k]!;
      const [from, to, turn] = AXLE_ENDS[k]!;
      const a = this.wheels[from]!;
      const b = this.wheels[to]!;
      const p = a.parent === axle.parent ? a.position : this.stub(from, axle.parent!, _p);
      const q = b.parent === axle.parent ? b.position : this.stub(to, axle.parent!, _q);
      const across = hypot2(q.x - p.x, q.z - p.z);
      axle.position.addVectors(p, q).multiplyScalar(0.5);
      axle.rotation.set(0, turn, detAtan2(q.y - p.y, across));
      axle.scale.set(hypot2(across, q.y - p.y) / (2 * AXLE_HALF_SPAN), 1, 1);
      axle.updateMatrixWorld();
    }
  }

  /** A gone wheel's axle end in `hubs`' frame (into `out`): its rest hub, raised along the world's up until the tube clears the ground by `STUB_CLEAR` (the monster's hubs stand 0.34 m outside its side, so a wreck lying on it drew the stub in the road). */
  // ponytail: it rises along the world's up, not the tube, so a tilted wreck's tip lands a hair off clear; second order (0.5 cm at 10°).
  private stub(i: number, hubs: THREE.Object3D, out: THREE.Vector3): THREE.Vector3 {
    const e = hubs.matrixWorld.elements;
    const { x, y, z } = out.copy(this.rests[i]!);
    const wy = e[1]! * x + e[5]! * y + e[9]! * z + e[13]!;
    const ground = activeGround().heightAt(e[0]! * x + e[4]! * y + e[8]! * z + e[12]!, e[2]! * x + e[6]! * y + e[10]! * z + e[14]!, wy + STUB_PROBE);
    const rise = ground === NO_FLOOR ? 0 : ground + STUB_CLEAR - wy;
    // The world's up in the hubs' frame: the matrix's row 1 (the hub group carries no scale).
    if (rise > 0) out.set(x + rise * e[1]!, y + rise * e[5]!, z + rise * e[9]!);
    return out;
  }
}

/** The painted body's vertices a gone bumper bares (`front` or rear): from `BARE_REACH.inward` inside its seat out to the end, up to `BARE_REACH.up` over it; never an inner panel's. */
export function bumperBare(style: BodyStyle, body: THREE.BufferGeometry, front: boolean): Int32Array {
  const { seat } = front ? style.bumpers.front : style.bumpers.rear;
  const pos = body.getAttribute("position");
  const paint = body.getAttribute(PRIMER_ATTRIBUTE);
  const from = seat.z - BARE_REACH.inward;
  const out: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const z = front ? pos.getZ(i) : -pos.getZ(i);
    if (z >= from && pos.getY(i) <= seat.y + BARE_REACH.up && paint.getX(i) === 0) out.push(i);
  }
  return Int32Array.from(out);
}

/** The body at `verts` the unpainted inner panel a torn bumper bares (`on`), or paint again, by the paint's `primer` attribute. */
export function setBare(verts: Int32Array, body: THREE.BufferGeometry, on: boolean): void {
  const attr = body.getAttribute(PRIMER_ATTRIBUTE) as THREE.BufferAttribute;
  for (let k = 0; k < verts.length; k++) attr.setX(verts[k]!, on ? INNER_PANEL : 0);
  attr.needsUpdate = true;
}
