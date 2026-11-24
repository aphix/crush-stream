import { describe, expect, it } from "vitest";
import { skinKernel } from "../deform/skin-kernel.ts";
import { loadSkinKernelForTest } from "../deform/skin-kernel.test-util.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { planFieldOf, rasterise } from "./cage-fields.ts";
import { P_CUT_X, P_CUT_Y, P_CUT_Z, type CageFields, type CageStyle } from "./car-cage.ts";
import { CageRig } from "./car-cage-rig.ts";
import { CAR_STYLE_IDS } from "./car-variants.ts";
import { carInState, STATES } from "./drawn-body.test-util.ts";
import { masksOf } from "./plan-field.test-util.ts";
import { STYLE_CLASS } from "./vehicle-classes.ts";

/**
 * The plan raster and plan field in the WASM kernel against the JS (`cage-fields.ts`), to the bit. Every car style's cage is fitted at
 * rest and in each crush state the drawn-body rows use, with no kernel loaded (the JS leg), and its inputs kept; the kernel is then
 * loaded and the same inputs are rastered and fielded again into poisoned fields. Each input also runs with its glass panes gone and
 * with seeded sets of panels off, which reach the openings of a shattered pane and the skipped groups.
 */

type Input = { label: string; style: CageStyle; pos: Float64Array; rawY: Float64Array; panelOn: Uint8Array; cut: readonly [number, number, number] };
type Output = { top: Float32Array; bottom: Float32Array; covered: Uint8Array; part: Uint8Array; plan: Float32Array; planBox: Float64Array; heightMax: number };

/** Fields holding values no fit writes, so a node the kernel never writes shows. */
const POISON = 7;

function poisoned(input: Input): CageFields {
  const n = input.style.nu * input.style.nv;
  return {
    pos: input.pos.slice(),
    rawY: input.rawY.slice(),
    top: new Float32Array(n).fill(POISON),
    bottom: new Float32Array(n).fill(POISON),
    covered: new Uint8Array(n).fill(POISON),
    part: new Uint8Array(n).fill(POISON),
    plan: new Float32Array(n).fill(POISON),
    planFresh: false,
    planBox: new Float64Array(4).fill(POISON),
    heightMax: POISON,
    panelOn: input.panelOn.slice(),
  };
}

function run(input: Input): Output {
  const f = poisoned(input);
  rasterise(input.style, f, input.panelOn, input.cut[0], input.cut[1], input.cut[2]);
  const plan = planFieldOf(input.style, f).slice();
  return { top: f.top, bottom: f.bottom, covered: f.covered, part: f.part, plan, planBox: f.planBox, heightMax: f.heightMax };
}

function maskPlans(style: CageStyle): Float32Array[] {
  const out: Float32Array[] = [];
  for (const { covered } of masksOf(style.nu, style.nv, style.step)) {
    const f = poisoned({ label: "", style, pos: new Float64Array(0), rawY: new Float64Array(0), panelOn: new Uint8Array(0), cut: [0, 0, 0] });
    f.covered.set(covered);
    out.push(planFieldOf(style, f).slice());
  }
  return out;
}

/** Seeded panel sets: each panel off with probability `share`. */
function panelsOff(on: Uint8Array, seed: number, share: number): Uint8Array {
  let r = seed;
  const out = on.slice();
  for (let k = 0; k < out.length; k++) if ((r = (r * 1103515245 + 12345) >>> 0) / 4294967296 < share) out[k] = 0;
  return out;
}

function inputsOf(): Input[] {
  const inputs: Input[] = [];
  for (const id of CAR_STYLE_IDS) {
    for (const state of STATES) {
      if (state.id === "airborne") continue;
      const rig = new CageRig(carInState(state.id, id, STYLE_CLASS[id]));
      rig.refit(true);
      const f = rig.cage.fields;
      const style = rig.cage.style;
      const cut = [rig.live.params[P_CUT_Y]!, rig.live.params[P_CUT_X]!, rig.live.params[P_CUT_Z]!] as const;
      const base = { style, pos: f.pos.slice(), rawY: f.rawY.slice(), cut };
      const label = `${id} ${state.id}`;
      inputs.push({ ...base, label, panelOn: f.panelOn.slice() });
      inputs.push({ ...base, label: `${label}, glass gone`, panelOn: f.panelOn.map((on, k) => (style.panelGlass[k] === 0 ? on : 0)) });
      for (let seed = 1; seed <= 3; seed++) inputs.push({ ...base, label: `${label}, panels off ${seed}`, panelOn: panelsOff(f.panelOn, seed * 7919, 0.3) });
    }
  }
  return inputs;
}

function agree(label: string, got: Output, want: Output): void {
  expect(firstMismatch(got.top, want.top), `${label}: top`).toBeUndefined();
  expect(firstMismatch(got.bottom, want.bottom), `${label}: bottom`).toBeUndefined();
  expect(firstMismatch(got.covered, want.covered), `${label}: covered`).toBeUndefined();
  expect(firstMismatch(got.part, want.part), `${label}: part`).toBeUndefined();
  expect(firstMismatch(got.plan, want.plan), `${label}: plan`).toBeUndefined();
  expect(firstMismatch(got.planBox, want.planBox), `${label}: planBox`).toBeUndefined();
  expect(Object.is(got.heightMax, want.heightMax), `${label}: heightMax ${got.heightMax} against ${want.heightMax}`).toBe(true);
}

describe("given every car style's cage fitted at rest and after crushes", () => {
  it("when its plan raster and plan field are made by the kernel, then every field equals the JS's to the bit", async () => {
    expect(skinKernel(), "the JS leg runs with no kernel").toBeNull();
    const inputs = inputsOf();
    const styles = [...new Set(inputs.map((input) => input.style))];
    const jsOutputs = inputs.map(run);
    const jsMasks = styles.map(maskPlans);
    expect(
      jsOutputs.filter((out, k) => k % 5 === 1 && firstMismatch(out.covered, jsOutputs[k - 1]!.covered) !== undefined).length,
      "control: a car's glass gone changes what it covers (the openings are read)",
    ).toBeGreaterThan(0);

    await loadSkinKernelForTest();
    expect(skinKernel(), "the kernel leg runs with the kernel").not.toBeNull();
    for (const [k, input] of inputs.entries()) agree(input.label, run(input), jsOutputs[k]!);
    for (const [s, style] of styles.entries()) {
      const masks = maskPlans(style);
      for (const [m, plan] of masks.entries()) expect(firstMismatch(plan, jsMasks[s]![m]!), `style ${s}, mask ${m}: plan`).toBeUndefined();
    }
  });
});
