import { newCast, societyMap } from "../../ai/civilians/society-scenes.test-util.ts";
import { needsWith, placeIn, stageResident } from "../../ai/civilians/society.test-util.ts";
import { CrowdGaze } from "../civilian-gaze.ts";
import { emptyPoses } from "../civilian-art.test-util.ts";
import type { FromNeedle, ToNeedle } from "./minds-protocol.ts";
import { MindsWorld } from "./minds-read.ts";

const HOME = placeIn(societyMap, "Rowhome A1-1");

/** A city at noon with one staged, calm resident at home, every civilian shown at the origin and an empty gaze table. */
export function mindsWorld(): { world: MindsWorld; resident: number; gaze: CrowdGaze } {
  const cast = newCast(12);
  stageResident(cast.state, cast.resident, { place: HOME, tick: cast.tick, needs: needsWith({}) });
  const world = new MindsWorld();
  const gaze = new CrowdGaze(cast.state.capacity);
  world.state = cast.state;
  world.poses = emptyPoses(cast.state.capacity);
  world.gaze = gaze;
  world.tick = cast.tick;
  return { world, resident: cast.resident, gaze };
}

/** Row `row` of the gaze table becomes a stimulus of `kind` at (x, 0, z), with `life` seconds left; the table holds rows up to it. */
export function putStimulus(gaze: CrowdGaze, row: number, kind: number, x: number, z: number, salience: number, life: number): void {
  const table = gaze.stimuli;
  table.kind[row] = kind;
  table.x[row] = x;
  table.y[row] = 0;
  table.z[row] = z;
  table.salience[row] = salience;
  table.life[row] = life;
  table.count = Math.max(table.count, row + 1);
}

/** A Needle worker stand-in (a `NeedleWorker`): keeps what it is sent; the test answers with `reply`. */
export class StandInWorker {
  readonly sent: ToNeedle[] = [];
  terminated = false;
  onmessage: ((event: MessageEvent<FromNeedle>) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;

  postMessage(message: ToNeedle): void {
    this.sent.push(message);
  }

  terminate(): void {
    this.terminated = true;
  }

  reply(message: FromNeedle): void {
    this.onmessage?.(new MessageEvent("message", { data: message }));
  }

  /** The id of the last ask sent, -1 for none. */
  lastAsk(): number {
    for (let at = this.sent.length - 1; at >= 0; at--) {
      const message = this.sent[at]!;
      if (message.kind === "ask") return message.id;
    }
    return -1;
  }
}
