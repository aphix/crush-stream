import { describe, expect, it } from "vitest";
import type * as THREE from "three";
import type { DeformableCar } from "../vehicle/car.ts";
import { CLASSES } from "../vehicle/vehicle-classes.ts";
import { distanceCutoff, PERSPECTIVES, perspectiveGains, SHIFT_CUT_S, SHIFT_PULSE_S, SHIFT_THUMP_AT, shiftStrength } from "./motor-layers.ts";
import { MotorSound } from "./motor-sound.ts";
import { channelGains } from "./motor-tone.ts";

/** A camera at the origin; `update` reads only its world matrix. */
const CAMERA = { matrixWorld: { elements: new Array<number>(16).fill(0) } } as unknown as THREE.Camera;
/** Short enough that the few frames of a test stay under a parameter tick (1/30 s), so no voice is driven. */
const FRAME_S = 1 / 300;

function carAt(x: number): DeformableCar {
  return { group: { position: { x, y: 0, z: 0, copy() {} }, visible: true }, vaporized: false, deform: { drivetrainAlive: true } } as unknown as DeformableCar;
}

/** A ready sound with no voices: frames shorter than a tick only seat cars in the pool. */
function seatedSound(): { sound: MotorSound; held: () => number } {
  const sound = new MotorSound(1);
  const state = sound as unknown as { ready: boolean; context: object; pool: { car: Int32Array } };
  state.ready = true;
  state.context = {};
  return { sound, held: () => state.pool.car[0]! };
}

describe("given a car with a voice that drifts across the 70 m cutoff", () => {
  it("when it hovers between 70 and 77 m, then it keeps its voice", () => {
    const { sound, held } = seatedSound();
    const car = carAt(60);
    sound.update(FRAME_S, [car], CAMERA, null, 1, false);
    expect(held()).toBe(0);
    for (const x of [71, 69, 74, 70.5, 76]) {
      car.group.position.x = x;
      sound.update(FRAME_S, [car], CAMERA, null, 1, false);
      expect(held(), `lost its voice at ${x} m`).toBe(0);
    }
  });

  it("when it passes 77 m, then it frees the voice, and it needs to come back under 70 m to take one again", () => {
    const { sound, held } = seatedSound();
    const car = carAt(60);
    sound.update(FRAME_S, [car], CAMERA, null, 1, false);
    car.group.position.x = 78;
    sound.update(FRAME_S, [car], CAMERA, null, 1, false);
    expect(held()).toBe(-1);
    car.group.position.x = 72;
    sound.update(FRAME_S, [car], CAMERA, null, 1, false);
    expect(held()).toBe(-1);
    car.group.position.x = 69;
    sound.update(FRAME_S, [car], CAMERA, null, 1, false);
    expect(held()).toBe(0);
  });
});

/** An AudioParam that records what it is told: kind, value and time of every call. */
class RecordedParam {
  readonly calls: { kind: "set" | "target"; value: number; at: number }[] = [];
  setValueAtTime(value: number, at: number): void {
    this.calls.push({ kind: "set", value, at });
  }
  setTargetAtTime(value: number, at: number): void {
    this.calls.push({ kind: "target", value, at });
  }
}

/** The one voice of a one-slot sound, its params recording; the node fields the two methods under test never touch are left out. */
function recordingVoice() {
  return { shift: new RecordedParam(), intake: { gain: new RecordedParam() }, block: { gain: new RecordedParam() }, outlet: { gain: new RecordedParam() }, boom: { gain: new RecordedParam() }, filter: { frequency: new RecordedParam() } };
}

/** The two private drivers that follow the car's gear and the camera's view, which the rows call as `driveVoice` does. */
interface VoiceDrivers {
  trackGear(slot: number, voice: unknown, car: unknown, load: number, fresh: boolean, tick: number, now: number): void;
  driveView(slot: number, voice: unknown, cls: "sedan", isPriority: boolean, firstPerson: boolean, distSq: number, cutoffHz: number, now: number): void;
}

const SEDAN = CLASSES.sedan;
const TICK_S = 1 / 30;
const speedInGear = (gear: number): number => (SEDAN.gears[gear - 2]! + 0.01) * SEDAN.topSpeed;
/** A sedan rolling at the middle of gear `gear` (1-based, 2 and up). */
function sedanInGear(gear: number) {
  return { style: { id: "sedan" as const }, velocity: { x: 0, z: speedInGear(gear) }, fwdFlat: { x: 0, z: 1 }, drive: { spinSpeed: 0 } };
}

describe("given a voice that follows its car's gear", () => {
  const rig = () => {
    const sound = new MotorSound(1);
    return { sound, drivers: sound as unknown as VoiceDrivers, voice: recordingVoice() };
  };

  it("when the car upshifts after a first look at it, then one thump is struck at the clutch's return and let go after its pulse, and the torque is cut", () => {
    const { sound, drivers, voice } = rig();
    drivers.trackGear(0, voice, sedanInGear(2), 1, true, TICK_S, 10);
    expect(voice.shift.calls, "the first look is no shift").toHaveLength(0);
    drivers.trackGear(0, voice, sedanInGear(3), 1, false, TICK_S, 10.1);
    const strike = 10.1 + SHIFT_CUT_S * SHIFT_THUMP_AT;
    expect(voice.shift.calls, "a pulse up and down").toHaveLength(2);
    expect(voice.shift.calls[0]!.value, "the thump's strength").toBe(shiftStrength(1, true));
    expect(voice.shift.calls[0]!.at, "struck at the clutch's return").toBe(strike);
    expect(voice.shift.calls[1]!.value, "let go").toBe(0);
    expect(voice.shift.calls[1]!.at, "after the pulse").toBe(strike + SHIFT_PULSE_S);
    expect(sound["shiftCutS"][0], "the torque cut").toBe(SHIFT_CUT_S);
  });

  it("when the car changes gear again inside the gap, then nothing more is struck", () => {
    const { drivers, voice } = rig();
    drivers.trackGear(0, voice, sedanInGear(2), 1, true, TICK_S, 10);
    drivers.trackGear(0, voice, sedanInGear(3), 1, false, TICK_S, 10.1);
    drivers.trackGear(0, voice, sedanInGear(4), 1, false, TICK_S, 10.2);
    expect(voice.shift.calls).toHaveLength(2);
  });

  it("when the car downshifts, then it thumps at once and the torque is not cut", () => {
    const { sound, drivers, voice } = rig();
    drivers.trackGear(0, voice, sedanInGear(3), 0.5, true, TICK_S, 10);
    drivers.trackGear(0, voice, sedanInGear(2), 0.5, false, TICK_S, 10.1);
    expect(voice.shift.calls[0]!.value, "a blip's worth").toBe(shiftStrength(0.5, false));
    expect(voice.shift.calls[0]!.at, "struck now").toBe(10.1);
    expect(sound["shiftCutS"][0]).toBe(0);
  });
});

describe("given a voice heard from the followed car's seat", () => {
  const gains = (view: "chase" | "cabin"): number[] => {
    const base = new Float64Array(3);
    channelGains(base, "sedan");
    const out = new Float64Array(3);
    perspectiveGains(out, base, view);
    return [...out];
  };
  const read = (voice: ReturnType<typeof recordingVoice>) => ({
    outlet: voice.outlet.gain.calls.map((c) => c.value),
    boom: voice.boom.gain.calls.map((c) => c.value),
    filter: voice.filter.frequency.calls.map((c) => c.value),
  });

  it("when the view goes first-person and back, then the outlet, the boom and the lowpass take the cabin's values and then the chase's", () => {
    const voice = recordingVoice();
    const drivers = new MotorSound(1) as unknown as VoiceDrivers;
    const DAMAGE_CUTOFF_HZ = 9000;
    drivers.driveView(0, voice, "sedan", true, true, 0, DAMAGE_CUTOFF_HZ, 1);
    drivers.driveView(0, voice, "sedan", true, false, 0, DAMAGE_CUTOFF_HZ, 2);
    const seen = read(voice);
    expect(seen.outlet[0], "cabin outlet gain").toBe(gains("cabin")[2]);
    expect(seen.outlet[1], "chase outlet gain").toBe(gains("chase")[2]);
    expect(seen.boom[0], "cabin boom (dB)").toBe(PERSPECTIVES.cabin.boomDb);
    expect(seen.boom[1], "chase boom (dB)").toBe(PERSPECTIVES.chase.boomDb);
    expect(seen.filter[0], "cabin lowpass (Hz)").toBe(PERSPECTIVES.cabin.openHz);
    expect(seen.filter[1], "damage lowpass (Hz)").toBe(DAMAGE_CUTOFF_HZ);
  });

  it("when the same view is asked for again, then the gains and the boom are not touched and only the lowpass follows", () => {
    const voice = recordingVoice();
    const drivers = new MotorSound(1) as unknown as VoiceDrivers;
    drivers.driveView(0, voice, "sedan", true, true, 0, 9000, 1);
    drivers.driveView(0, voice, "sedan", true, true, 0, 9000, 2);
    expect(voice.intake.gain.calls, "intake").toHaveLength(1);
    expect(voice.block.gain.calls, "block").toHaveLength(1);
    expect(voice.outlet.gain.calls, "outlet").toHaveLength(1);
    expect(voice.boom.gain.calls, "boom").toHaveLength(1);
    expect(voice.filter.frequency.calls).toHaveLength(2);
  });

  it("when a car that is not the followed one is heard, then it is the plain mix with its lowpass closing by distance, even if the camera is first-person", () => {
    const voice = recordingVoice();
    const drivers = new MotorSound(1) as unknown as VoiceDrivers;
    drivers.driveView(0, voice, "sedan", false, true, 60 * 60, 20000, 1);
    expect(read(voice).boom, "one boom event").toHaveLength(1);
    expect(read(voice).boom[0], "no boom").toBe(PERSPECTIVES.other.boomDb);
    expect(read(voice).filter[0]).toBe(distanceCutoff(60));
  });
});
