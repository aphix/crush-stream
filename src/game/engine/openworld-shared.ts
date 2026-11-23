import { ACTIVITY } from "../ai/civilians/civilian-activity.ts";
import type { CrowdPoses } from "../ai/civilians/crowd-poses.ts";
import { FOOT_COP_COUNT } from "../ai/openworld-crime/crime-constants.ts";
import { detCos, detSin, hypot2 } from "../kernel/physics-core.js";
import { addBodyRecord, BODY_FRAME_MAX, BODY_KIND, BODY_FLAG, BODY_POSTURE, copyBodyFrame, makeBodyFrame, type BodyFrame, type BodyMotion } from "../net/body-codec.ts";
import { BODIES_SILENT_S } from "../net/net-constants.ts";
import type { DriverLook } from "../present/driver-look.ts";
import type { SightField } from "../present/openworld-sight.ts";
import { SPRINT_SPEED } from "../present/walker-locomotion.ts";
import { MAX_CARS } from "../scenes/fleet.ts";
import { FASTEST, recordTarget, TORSO_ABOVE_FEET } from "./body-follow.ts";
import { KEEP_RADIUS, NEAR_RADIUS, type BodyHost, type OpenWorldBodies } from "./openworld-bodies.ts";
import { kindOf, MEDICS_COUNT, PEOPLE_EXTRA, personOf } from "./people-index.ts";

/** What a person recorded in the host's frame is drawn as on this machine. */
export const DRAWN = { none: 0, body: 1, dummy: 2, figure: 3 } as const;

/** What the shared people need of the engine: the dress of a person by kind and id. */
type SharedPorts = { lookOf(kind: number, id: number, out: DriverLook): void };

/** What the shared people read and write: this machine's bodies and their world, each kind's pose table (null: that kind is not shared yet), what its eye sees, and the interiors whose floors a body stands on. */
type SharedWorld = {
  bodies: OpenWorldBodies | null;
  host: BodyHost | null;
  tables: readonly (CrowdPoses | null)[];
  sight: Pick<SightField, "seen">;
  floors: { holdFloorAt(x: number, z: number): void } | null;
  ports: SharedPorts;
};

/** A body's class in the budget: players first, then every other recorded person (this machine's own civilians are the last, `OWN_CLASS` in the bodies). */
const PLAYER_CLASS = 1;
const OTHER_CLASS = 2;

const _target: BodyMotion = { x: 0, y: 0, z: 0, vx: 0, vy: 0, vz: 0, heading: 0, posture: 0 };
const _look: DriverLook = { woman: false, shirt: 0, pants: 0, hair: 0, hat: null, mustache: false };
const _torso = { x: 0, z: 0 };
/** The records to place, nearest the eye first, and how far each is. */
const _order = new Int16Array(BODY_FRAME_MAX);
const _distance = new Float32Array(BODY_FRAME_MAX);

/**
 * The host's people as this machine draws them (`MSG.bodies`): each recorded person is followed by a body of this machine's ragdoll pool when she is near and seen, else drawn by her kind's pose
 * table as a figure at the host's place, laid flat while she is down. Made with the crowd; everything is per person (`people-index.ts`).
 */
export class OpenWorldShared {
  /** The newest frame heard (`hear`). */
  readonly frame = makeBodyFrame();
  private readonly capacity: number;
  private readonly world: SharedWorld;
  private heardAt = -Infinity;
  /** Per person: her record in the frame being placed (-1: none), whether her floor is held, what she was drawn as and where. */
  private readonly recordOf: Int16Array;
  private readonly floorHeld: Uint8Array;
  private readonly drawnAs: Uint8Array;
  private readonly drawnX: Float32Array;
  private readonly drawnZ: Float32Array;
  /** Per civilian: 1 when the last frame placed had a body record of her. */
  private readonly shared: Uint8Array;
  /** Per kind and row, the stride phase the pose records' rows walk with. */
  private readonly strides: Float32Array[];
  /** How many ids each kind has (by `BODY_KIND`): a record naming one past them is a peer's mistake. */
  private readonly idCounts: Uint16Array;
  /** The pose rows the last placing laid flat or wrote as figures (kind, id), to be given back. */
  private readonly overlaidKind = new Uint8Array(BODY_FRAME_MAX);
  private readonly overlaidId = new Uint16Array(BODY_FRAME_MAX);
  private overlaid = 0;

  constructor(capacity: number, world: SharedWorld) {
    this.capacity = capacity;
    this.world = world;
    this.recordOf = new Int16Array(capacity + PEOPLE_EXTRA).fill(-1);
    this.floorHeld = new Uint8Array(capacity + PEOPLE_EXTRA);
    this.drawnAs = new Uint8Array(capacity + PEOPLE_EXTRA);
    this.drawnX = new Float32Array(capacity + PEOPLE_EXTRA);
    this.drawnZ = new Float32Array(capacity + PEOPLE_EXTRA);
    this.shared = new Uint8Array(capacity);
    this.idCounts = Uint16Array.of(capacity, MAX_CARS, FOOT_COP_COUNT, MEDICS_COUNT);
    this.strides = world.tables.map((table) => new Float32Array(table?.count ?? 0));
  }

  /** The host's frame, heard at wall second `now`. */
  hear(frame: BodyFrame, now: number): void {
    copyBodyFrame(frame, this.frame);
    this.heardAt = now;
  }

  /** Whether a frame was heard within `BODIES_SILENT_S`: with none the link is down. */
  fresh(now: number): boolean {
    return now - this.heardAt <= BODIES_SILENT_S;
  }

  /**
   * Once a frame, after the crowd's step and before any art's update: every recorded person of `kinds` (a mask of `1 << BODY_KIND`) in `frame` (null: no fresh frame) is placed by the drawing rules of this machine,
   * her record read as of crowd second `crowdSeconds`, nearest `eyeX`, `eyeZ` first. The player of `ownCar` is this machine's own and is skipped.
   */
  bodyRecords(frame: BodyFrame | null, kinds: number, ownCar: number, crowdSeconds: number, eyeX: number, eyeZ: number): void {
    this.giveBackRows(kinds);
    if (frame === null) {
      this.unfollowRecorded(kinds, null);
      return;
    }
    for (let at = 0; at < frame.count; at++) {
      if (!this.placeable(frame, at, kinds, ownCar)) continue;
      this.recordOf[personOf(frame.kind[at]!, frame.id[at]!, this.capacity)] = at;
      if (frame.kind[at] === BODY_KIND.civilian) this.shared[frame.id[at]!] = 1;
    }
    this.unfollowRecorded(kinds, frame);
    const placed = this.sortByDistance(frame, kinds, ownCar, eyeX, eyeZ);
    for (let k = 0; k < placed; k++) this.place(frame, _order[k]!, crowdSeconds, eyeX, eyeZ);
    for (let at = 0; at < frame.count; at++) if (this.placeable(frame, at, kinds, ownCar)) this.recordOf[personOf(frame.kind[at]!, frame.id[at]!, this.capacity)] = -1;
  }

  /** Where person `person` was drawn by the last `bodyRecords` (`DRAWN`) and at (x, z) into `out`. */
  drawnAt(person: number, out: { x: number; z: number }): number {
    out.x = this.drawnX[person]!;
    out.z = this.drawnZ[person]!;
    return this.drawnAs[person]!;
  }

  /** Whether the last frame placed had a body record of civilian `civilian`: the host draws her, so this machine throws no ragdoll of its own for her. */
  shares(civilian: number): boolean {
    return this.shared[civilian] === 1;
  }

  /**
   * A guest draws the pose records of `kind` in `frame` in `table`: with `whole` every row is hidden first (the table is all the host's), then each record writes its row: shown, the feet at the record's place moved by its velocity for the age
   * (section 2.4), the facing, the pace, the activity, no partner, upright, and the stride advanced by pace x `wallDt`.
   */
  poseRows(frame: BodyFrame, kind: number, table: CrowdPoses, whole: boolean, crowdSeconds: number, wallDt: number): void {
    if (whole) table.shown.fill(0);
    const strides = this.strides[kind]!;
    for (let at = 0; at < frame.count; at++) {
      const id = frame.id[at]!;
      if (frame.kind[at] !== kind || (frame.state[at]! & BODY_FLAG.pose) === 0 || id >= table.count) continue;
      recordTarget(frame, at, crowdSeconds - frame.crowdTime, _target);
      const pace = hypot2(_target.vx, _target.vz);
      strides[id] = strides[id]! + pace * wallDt;
      table.shown[id] = 1;
      table.x[id] = _target.x;
      table.z[id] = _target.z;
      table.feetY[id] = _target.y;
      table.yaw[id] = _target.heading;
      table.speed[id] = pace;
      table.stride[id] = strides[id]!;
      table.activity[id] = frame.activity[at]!;
      table.activityClock[id] = frame.activityClock[at]!;
      table.activityLeft[id] = frame.activityLeft[at]!;
      table.partner[id] = -1;
      table.lying[id] = 0;
    }
  }

  /** Every civilian the host draws nowhere (its hidden list) is hidden in `table`. */
  hide(frame: BodyFrame, table: CrowdPoses): void {
    for (let at = 0; at < frame.hidden; at++) if (frame.hiddenId[at]! < table.count) table.shown[frame.hiddenId[at]!] = 0;
  }

  /** The rows laid flat or written last time are given back, and what was drawn by a kind in `kinds` is forgotten. */
  private giveBackRows(kinds: number): void {
    for (let k = 0; k < this.overlaid; k++) this.world.tables[this.overlaidKind[k]!]!.lying[this.overlaidId[k]!] = 0;
    this.overlaid = 0;
    for (let person = 0; person < this.drawnAs.length; person++) {
      const kind = kindOf(person, this.capacity);
      if (((kinds >> kind) & 1) === 0) continue;
      this.drawnAs[person] = DRAWN.none;
      if (kind === BODY_KIND.civilian) this.shared[person] = 0;
    }
  }

  /** Every followed body of a kind in `kinds` whose person has no record in `frame` (any, with no frame) is this machine's own again; a floor it held is let go. */
  private unfollowRecorded(kinds: number, frame: BodyFrame | null): void {
    const bodies = this.world.bodies;
    if (bodies === null) return;
    for (let at = bodies.followedCount() - 1; at >= 0; at--) {
      const person = bodies.followedPerson(at);
      if (((kinds >> kindOf(person, this.capacity)) & 1) === 0 || (frame !== null && this.recordOf[person]! >= 0)) continue;
      bodies.unfollow(person);
      this.floorHeld[person] = 0;
    }
    if (frame === null) this.floorHeld.fill(0);
  }

  /** Whether record `at` is one to place: a body record (not a pose record) of a kind in `kinds`, not the own player's, of a person this build has. */
  private placeable(frame: BodyFrame, at: number, kinds: number, ownCar: number): boolean {
    const kind = frame.kind[at]!;
    const id = frame.id[at]!;
    return (frame.state[at]! & BODY_FLAG.pose) === 0 && ((kinds >> kind) & 1) !== 0 && !(kind === BODY_KIND.player && id === ownCar) && id < this.idCounts[kind]!;
  }

  /** `_order` filled with the records to place by their distance to the eye, nearest first: how many. */
  private sortByDistance(frame: BodyFrame, kinds: number, ownCar: number, eyeX: number, eyeZ: number): number {
    let placed = 0;
    for (let at = 0; at < frame.count; at++) {
      if (!this.placeable(frame, at, kinds, ownCar)) continue;
      const away = hypot2(frame.pos[3 * at]! - eyeX, frame.pos[3 * at + 2]! - eyeZ);
      let into = placed++;
      while (into > 0 && _distance[into - 1]! > away) {
        _distance[into] = _distance[into - 1]!;
        _order[into] = _order[into - 1]!;
        into--;
      }
      _distance[into] = away;
      _order[into] = at;
    }
    return placed;
  }

  /** Record `at`: her body follows it, or she takes a body, or she is a figure at the host's place. */
  private place(frame: BodyFrame, at: number, crowdSeconds: number, eyeX: number, eyeZ: number): void {
    const kind = frame.kind[at]!;
    const id = frame.id[at]!;
    const person = personOf(kind, id, this.capacity);
    const player = kind === BODY_KIND.player;
    const bodies = this.world.bodies;
    recordTarget(frame, at, crowdSeconds - frame.crowdTime, _target);
    const away = hypot2(_target.x - eyeX, _target.z - eyeZ);
    if (bodies !== null && bodies.has(person)) {
      if (away <= KEEP_RADIUS) {
        bodies.aim(person, _target, player ? PLAYER_CLASS : OTHER_CLASS, player ? SPRINT_SPEED : FASTEST);
        this.drewBody(person, kind, id);
        return;
      }
      bodies.unfollow(person);
    } else if (bodies !== null && away <= NEAR_RADIUS && this.world.sight.seen(_target.x, _target.z, 1)) {
      if (kind === BODY_KIND.civilian && this.floorHeld[person] === 0) {
        this.world.floors?.holdFloorAt(_target.x, _target.z);
        this.floorHeld[person] = 1;
      }
      this.world.ports.lookOf(kind, id, _look);
      if (bodies.takeFor(person, player ? PLAYER_CLASS : OTHER_CLASS, _look, _target, player ? SPRINT_SPEED : FASTEST, eyeX, eyeZ)) {
        this.drewBody(person, kind, id);
        return;
      }
    }
    this.drawFigure(kind, id, person);
  }

  /** `person` is drawn by her body: her pose table draws none of her (a civilian's `held` already says so). */
  private drewBody(person: number, kind: number, id: number): void {
    this.drawnAs[person] = DRAWN.body;
    if (this.world.bodies!.torsoOf(person, _torso)) {
      this.drawnX[person] = _torso.x;
      this.drawnZ[person] = _torso.z;
    }
    if (kind !== BODY_KIND.civilian) this.world.tables[kind]!.shown[id] = 0;
  }

  /** `_target` as a row of her kind's pose table: upright at the target while she stands, else laid flat on her back, her head along the heading, so her torso is at the target. */
  private drawFigure(kind: number, id: number, person: number): void {
    const table = this.world.tables[kind];
    if (table === null || table === undefined) return;
    const t = _target;
    table.shown[id] = 1;
    table.yaw[id] = t.heading;
    table.speed[id] = hypot2(t.vx, t.vz);
    table.activity[id] = ACTIVITY.none;
    table.partner[id] = -1;
    if (t.posture === BODY_POSTURE.stand) {
      table.x[id] = t.x;
      table.z[id] = t.z;
      table.feetY[id] = t.y - TORSO_ABOVE_FEET;
      table.lying[id] = 0;
    } else {
      table.x[id] = t.x - detSin(t.heading) * TORSO_ABOVE_FEET;
      table.z[id] = t.z - detCos(t.heading) * TORSO_ABOVE_FEET;
      table.feetY[id] = t.y;
      table.lying[id] = 1;
      table.speed[id] = 0;
    }
    this.overlaidKind[this.overlaid] = kind;
    this.overlaidId[this.overlaid++] = id;
    this.drawnAs[person] = DRAWN.figure;
    this.drawnX[person] = table.x[id]!;
    this.drawnZ[person] = table.z[id]!;
  }
}

/** Host: the shown rows of `table` (every row, or only the rows `only[0..onlyCount)` names that are at least 0) as pose records of `kind`: where the feet stand, the velocity along the facing at the pace, the facing and the activity. */
export function writePoseRows(out: BodyFrame, kind: number, table: CrowdPoses, only: ArrayLike<number> | null, onlyCount: number): void {
  const rows = only === null ? table.count : onlyCount;
  for (let k = 0; k < rows; k++) {
    const row = only === null ? k : only[k]!;
    if (row < 0 || row >= table.count || table.shown[row] === 0) continue;
    const at = addBodyRecord(out, kind, row, BODY_FLAG.pose);
    if (at < 0) return;
    const yaw = table.yaw[row]!;
    const speed = table.speed[row]!;
    out.pos[3 * at] = table.x[row]!;
    out.pos[3 * at + 1] = table.feetY[row]!;
    out.pos[3 * at + 2] = table.z[row]!;
    out.vel[3 * at] = detSin(yaw) * speed;
    out.vel[3 * at + 2] = detCos(yaw) * speed;
    out.heading[at] = yaw;
    out.activity[at] = table.activity[row]!;
    out.activityClock[at] = table.activityClock[row]!;
    out.activityLeft[at] = table.activityLeft[row]!;
  }
}
