import * as THREE from "three";
import type { StreamedDeformation } from "../deform/streamed-deform.ts";
import { detCos, detSin } from "../kernel/physics-core.js";
import type { MassName } from "../kernel/rig-spec.ts";
import type { DetachPart } from "./car-core.ts";
import { roofAt, sampleSlice } from "./car-mesh.ts";
import { carFrame } from "./car-rig.ts";
import type { BodyStyle } from "./car-variants.ts";
import { BUMPER_F, LID, PRIMER_ATTRIBUTE } from "./constants.ts";
import { bayTub, REF_BAY, REF_CABIN, SEAT_RECLINE, WHEEL_AT, WHEEL_GRIP, WHEEL_TILT } from "./interior-geometry.ts";
import { PART_KIND, type PartSeat } from "./part-geometry.ts";

/** Gap (m) between a seated head's top and the roof line over it: the roof skin and the headliner. */
const HEAD_CLEAR = 0.05;
/** The seated dummy's head centre along his back from the H-point, its radius, and his shoulders along his back (m): `PARTS`/`JOINTS` over the hips' 0.84. */
const HEAD = { up: 0.79, r: 0.11 } as const;
const SHOULDER_UP = 0.51;
/** The most a seat leans back past `SEAT_RECLINE` (rad) to keep a head under a low roof, and the step it tries. */
const RECLINE_MAX = 0.35;
const RECLINE_STEP = 0.01;
/** The driver's soles: across from his H-point (his hips' half-spread), ahead of it, and over the cabin floor (m). */
const FEET = { x: 0.09, ahead: 0.8, lift: 0.04 } as const;
/** The cabin's sides stand this far (m) inside the side glass sill, its headliner this far under the roof line at the B-pillar. */
const CABIN_INSET = 0.05;
const HEADLINER_DROP = 0.03;
/** The bay's sides stand this far (m) inside the nose's narrowest station over it; its top this far under the deck line (the hood lid's underside). */
const BAY_INSET = 0.06;
const HOOD_UNDER = 0.024;
/** The bay shows once the hood hinges open past this; a crash bar once its bumper hangs past this. */
const BAY_OPEN = 0.05;
const BAR_OPEN = 0.5;
/** A gone bumper bares the body from this far (m) inside its seat out, up to this far over it. */
const BARE_REACH = { inward: 0.25, up: 0.14 } as const;

/** Where the driver sits (car space, m): his H-point, his back's lean from upright (rad), the wheel's centre, his grips on it and his soles, [his right (-x), his left]. */
export interface DriverPlace {
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
  const hip = new THREE.Vector3(...style.seats.front);
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

/** Seat `seat` at `p`, leaned back `lean` past the seat's own recline (rad), scaled `sx` across. */
function place(seat: PartSeat, x: number, y: number, z: number, lean = 0, sx = 1): void {
  seat.position.set(x, y, z);
  seat.rotation.set(-lean, 0, 0);
  seat.scale.set(sx, 1, 1);
}

/** `seat` mapping `ref`'s box onto [x0..x1, y0..y1, z0..z1] half-width `halfX`. */
function fitBox(seat: PartSeat, ref: { halfX: number; y0: number; y1: number; z0: number; z1: number }, halfX: number, y0: number, y1: number, z0: number, z1: number): void {
  const sy = (y1 - y0) / (ref.y1 - ref.y0);
  const sz = (z1 - z0) / (ref.z1 - ref.z0);
  seat.scale.set(halfX / ref.halfX, sy, sz);
  seat.position.set(0, y0 - ref.y0 * sy, z0 - ref.z0 * sz);
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
    const roof = roofAt((style.bPillar.rear + style.bPillar.front) * 0.5, style).y - HEADLINER_DROP;
    const halfX = style.belt.x - CABIN_INSET;
    const floor = style.tubs[0]![2];
    fitBox(cabin!, { halfX: REF_CABIN.halfX, y0: REF_CABIN.floor, y1: REF_CABIN.roof, z0: REF_CABIN.rear, z1: REF_CABIN.front }, halfX, floor, roof, style.rearBulkhead.z, style.windshield.base[1]);
    place(driver!, seat.hip.x, seat.hip.y, seat.hip.z, lean);
    place(passenger!, -seat.hip.x, seat.hip.y, seat.hip.z, lean);
    wheel!.position.copy(seat.wheel);
    wheel!.rotation.set(WHEEL_TILT, 0, 0);
    this.pose.add(cabin!, driver!, passenger!, wheel!);
    const back = style.seats.rear;
    if (back) {
      place(rear!, 0, back[0], back[1], 0, halfX / REF_CABIN.halfX);
      this.pose.add(rear!);
    }

    const [zRear, zFront, bayFloor] = bayTub(style);
    let bayHalf = Infinity;
    for (let z = zRear; z <= zFront; z += 0.1) bayHalf = Math.min(bayHalf, sampleSlice(z, style.profile).hw - BAY_INSET);
    const bayTop = sampleSlice((zRear + zFront) * 0.5, style.profile).yBelt - HOOD_UNDER;
    fitBox(bay!, { halfX: REF_BAY.halfX, y0: REF_BAY.floor, y1: REF_BAY.top, z0: REF_BAY.rear, z1: REF_BAY.front }, bayHalf, bayFloor, bayTop, zRear, zFront);
    const { front, rear: tail } = style.bumpers;
    bars[0]!.position.set(0, front.seat.y, front.seat.z);
    bars[1]!.position.set(0, tail.seat.y, -tail.seat.z);
    bars[1]!.rotation.set(0, Math.PI, 0);
    group.add(this.pose, bay!, ...bars);

    this.under = [bay!, ...bars];
    this.rests = this.under.map((s) => s.position.clone());
    const rig = carFrame(style).rig.masses;
    const restOf = (name: MassName): readonly [MassName, THREE.Vector3] => [name, new THREE.Vector3(...rig.find((m) => m.name === name)!.rest)];
    this.massRest = (["engineL", "engineR", "bumperFL", "bumperFR", "bumperRL", "bumperRR"] as const).map(restOf);
  }

  /** The bay shows while the hood is off or open, each crash bar while its bumper is off or hanging: `parts` are the car's own. */
  watch(parts: readonly DetachPart[]): void {
    const hood = parts.find((p) => p.name === LID.hood)!;
    const front = parts.find((p) => p.name === BUMPER_F)!;
    const rear = parts.find((p) => p.bumper && p !== front)!;
    this.under[0]!.showIf = () => hood.detached || hood.hingeT > BAY_OPEN;
    this.under[1]!.showIf = () => front.detached || front.hingeT > BAR_OPEN;
    this.under[2]!.showIf = () => rear.detached || rear.hingeT > BAR_OPEN;
  }

  /** The bay rides the engine masses through a crush and each bar its bumper's: once a frame on a crashed car, at rest without (`deform` null). */
  fit(deform: StreamedDeformation | null): void {
    for (let k = 0; k < this.under.length; k++) {
      const seat = this.under[k]!;
      seat.position.copy(this.rests[k]!);
      if (deform === null) continue;
      const [l, lRest] = this.massRest[2 * k]!;
      const [r, rRest] = this.massRest[2 * k + 1]!;
      _bay.copy(deform.massLocal(l)).sub(lRest);
      _mass.copy(deform.massLocal(r)).sub(rRest);
      seat.position.add(_bay.add(_mass).multiplyScalar(0.5));
    }
  }
}

/** The body's vertices a gone bumper bares (`front` or rear): from `BARE_REACH.inward` inside its seat out to the end, up to `BARE_REACH.up` over it. */
export function bumperBare(style: BodyStyle, body: THREE.BufferGeometry, front: boolean): Int32Array {
  const { seat } = front ? style.bumpers.front : style.bumpers.rear;
  const pos = body.getAttribute("position");
  const from = seat.z - BARE_REACH.inward;
  const out: number[] = [];
  for (let i = 0; i < pos.count; i++) {
    const z = front ? pos.getZ(i) : -pos.getZ(i);
    if (z >= from && pos.getY(i) <= seat.y + BARE_REACH.up) out.push(i);
  }
  return Int32Array.from(out);
}

/** The body at `verts` bare metal (`on`) or paint again, by the paint's `primer` attribute. */
export function setBare(verts: Int32Array, body: THREE.BufferGeometry, on: boolean): void {
  const attr = body.getAttribute(PRIMER_ATTRIBUTE) as THREE.BufferAttribute;
  for (let k = 0; k < verts.length; k++) attr.setX(verts[k]!, on ? 1 : 0);
  attr.needsUpdate = true;
}
