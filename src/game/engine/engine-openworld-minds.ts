import type { CivilianCrowd } from "../ai/civilians/civilian-crowd.ts";
import { tickAt } from "../ai/civilians/civilian-clock.ts";
import type { LookText, Meeting } from "../ai/civilians/civilian-look.ts";
import type { CrowdGaze } from "../present/civilian-gaze.ts";
import { CrowdMinds, type NeedleWorker } from "../present/minds/crowd-minds.ts";
import { MindsWorld } from "../present/minds/minds-read.ts";

/** Needle 2 in its module worker, or null where this browser has none or will not start one (said in the console). */
function needleWorker(): NeedleWorker | null {
  if (typeof Worker === "undefined") return null;
  try {
    return new Worker(new URL("../present/minds/needle-worker.ts", import.meta.url), { type: "module" });
  } catch (err) {
    console.error("Crush Stream Minds worker did not start", err);
    return null;
  }
}

/** The open world's Minds in the engine: what they read refreshed each frame, the setting applied, and the look panel's thought line. Presentation only. */
export class OpenWorldMinds {
  readonly minds: CrowdMinds;
  /** The civilian the look panel is about (`lookAtOf`), -1 for none. */
  readonly shown: Meeting = { index: -1, along: 0 };
  private readonly world = new MindsWorld();

  constructor(capacity: number) {
    this.minds = new CrowdMinds(capacity, this.world, needleWorker);
  }

  /** A frame of `wallDt` s: the crowd and its gaze as they are now, and whether Needle may be asked (`on`: the setting, where a worker can run). */
  frame(crowd: CivilianCrowd, gaze: CrowdGaze | null, on: boolean, wallDt: number): void {
    const world = this.world;
    world.state = crowd.state;
    world.poses = crowd.poses;
    world.gaze = gaze;
    world.events = crowd.eventLog();
    world.crowdSeconds = crowd.crowdSeconds;
    world.tick = tickAt(crowd.crowdSeconds);
    this.minds.setOn(on && typeof Worker !== "undefined");
    this.minds.frame(wallDt);
  }

  /** The look panel's `text` with the thought of the civilian it is about as its last line. */
  describe(text: LookText | null): LookText | null {
    const thought = text === null || this.shown.index < 0 ? null : this.minds.lookAt(this.shown.index);
    return text === null || thought === null ? text : { title: text.title, lines: [...text.lines, thought] };
  }

  /** The worker goes with the crowd. */
  dispose(): void {
    this.minds.setOn(false);
  }
}
