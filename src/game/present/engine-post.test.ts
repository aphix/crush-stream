import { describe, it } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { element, stubBrowser } from "../engine/engine-headless.test-util.ts";
import { easeFade, FX_TIERS, PostFX } from "./engine-post.ts";
import { FRAME_HZ } from "../kernel/constants.ts";

stubBrowser();

describe(`given the post chain's strengths after a switch from a plain tier, at ${FRAME_HZ} Hz`, () => {
  it("when it eases in from 0, then it never moves more than a quarter in a frame, takes more than 0.15 s and less than 0.5 s, and lands exactly on 1", () => {
    const FRAME = 1 / FRAME_HZ;
    let fade = 0;
    let frames = 0;
    for (; fade < 1 && frames < 600; frames++) {
      const next = easeFade(fade, FRAME);
      assert.ok(next >= fade && next - fade <= 0.25, `a frame moved the fade ${fade} -> ${next}`);
      fade = next;
    }
    assert.equal(fade, 1);
    assert.ok(frames * FRAME > 0.15 && frames * FRAME < 0.5, `took ${(frames * FRAME).toFixed(2)} s`);
  });
});

/** The print looks: each a PostFX field, the composite's uniform it drives, and the head of its branch in the composite's fragment. */
const PRINT_LOOKS = [
  { it: "halftone dots", field: "dots", uniform: "uDots", branch: "if (uDots > 0.001) {" },
  { it: "cross-hatch", field: "hatch", uniform: "uHatch", branch: "if (uHatch > 0.001) {" },
] as const;
const CEL_BRANCH = "if (uCel > 0.001) {";
/** The vignette's first line: the print looks sit before it, so it darkens paper and ink alike. */
const VIGNETTE = "vec2 q = uv - 0.5;";
const POST_TIERS = ["low", "high"] as const;
/** A strength no default holds, so a write that never happened cannot read as one. */
const STRENGTH = 0.65;

describe("given the post chain on a headless renderer and a print look's strength", () => {
  const renderer = new THREE.WebGLRenderer({ canvas: element() });
  const post = new PostFX(renderer, 1);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  for (const look of PRINT_LOOKS) {
    for (const tier of POST_TIERS) {
      it(`when ${look.it} is set at the ${tier} tier and a frame renders, then the tier's composite carries it in ${look.uniform}, inside a branch after the cel look and before the vignette`, () => {
        post.setTier(tier);
        post[look.field] = STRENGTH;
        post.render(scene, camera, 1 / FRAME_HZ);
        const composite = post["composites"][tier];
        assert.equal(composite.uniforms[look.uniform]!.value, STRENGTH);
        const frag = composite.fragmentShader;
        const at = frag.indexOf(look.branch);
        assert.ok(at > frag.indexOf(CEL_BRANCH) && frag.indexOf(CEL_BRANCH) >= 0, `${look.branch} sits after ${CEL_BRANCH}: at ${at}`);
        assert.ok(at < frag.indexOf(VIGNETTE), `${look.branch} sits before ${VIGNETTE}: at ${at}`);
        post[look.field] = 0;
      });
    }
  }
  it("leaves renderer.info's reset to whoever counts the frame", () => {
    for (const tier of POST_TIERS) {
      post.setTier(tier);
      for (const hold of [false, true]) {
        renderer.info.autoReset = hold;
        post.render(scene, camera, 1 / FRAME_HZ);
        assert.equal(renderer.info.autoReset, hold, `${tier} tier changed autoReset from ${hold}`);
      }
    }
  });
});

describe("given the post chain on a headless renderer whose canvas has no MSAA, as every device's now has, on a device of pixel ratio 1 and one of 2", () => {
  const renderer = new THREE.WebGLRenderer({ canvas: element() });
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera();
  /** The samples each tier's scene target is drawn with per device pixel ratio: 4 at high and ultra; at low only on a ratio-1 device (the owner's call: it kept the canvas's 4x there); none at the plain tiers. */
  const WANT = "dpr 1: off 0, minimal 0, low 4, high 4, ultra 4; dpr 2: off 0, minimal 0, low 0, high 4, ultra 4";

  it(`when each FX tier is set and a frame renders, then the HDR scene target is drawn with that tier's MSAA samples on that device (${WANT})`, () => {
    const read = [1, 2].map((dpr) => {
      const post = new PostFX(renderer, dpr);
      const tiers = FX_TIERS.map((tier) => {
        post.setTier(tier);
        post.render(scene, camera, 1 / FRAME_HZ);
        return `${tier} ${post.sceneRT.samples}`;
      });
      post.dispose();
      return `dpr ${dpr}: ${tiers.join(", ")}`;
    });
    assert.equal(read.join("; "), WANT);
  });

  it("when the tier steps down from high to low and back on a device of ratio 2, then the one scene target loses and regains its samples in place and keeps its size", () => {
    const post = new PostFX(renderer, 2);
    const target = post.sceneRT;
    post.setTier("high");
    post.setSize();
    const size = `${target.width}x${target.height}`;
    const steps: string[] = [];
    for (const tier of ["low", "high"] as const) {
      post.setTier(tier);
      post.render(scene, camera, 1 / FRAME_HZ);
      steps.push(`${tier} ${post.sceneRT.samples} ${post.sceneRT.width}x${post.sceneRT.height}`);
    }
    assert.equal(post.sceneRT, target, "the same target");
    assert.equal(steps.join(", "), `low 0 ${size}, high 4 ${size}`);
  });
});
