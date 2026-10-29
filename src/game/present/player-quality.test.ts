import { describe, it } from "vitest";
import assert from "node:assert/strict";
import * as THREE from "three";
import { PlayerQuality } from "./player-quality.ts";

type Host = ConstructorParameters<typeof PlayerQuality>[0];

/** The pixel ratio a three renderer starts at, before the quality knobs set it. */
const RENDERER_START_RATIO = 1;

/** A booted page: the quality knobs, the real camera and scene they act on, and what they sent the stage (shadow map edges), the car detail (reaches) and the post chain (resizes). */
interface Page {
  quality: PlayerQuality;
  camera: THREE.PerspectiveCamera;
  scene: THREE.Scene;
  sent: { maps: number[]; reaches: number[]; postSizes: number };
}

/** A page on `deviceRatio`: a real camera (far 180 m), scene and exponential fog (0.008) as the sandbox has them; the renderer, stage, car detail and post chain only record. */
function boot(deviceRatio: number): Page {
  let ratio = RENDERER_START_RATIO;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 180);
  const scene = new THREE.Scene();
  scene.fog = new THREE.FogExp2(0, 0.008);
  const sent = { maps: [] as number[], reaches: [] as number[], postSizes: 0 };
  const host: Host = {
    renderer: {
      getPixelRatio: () => ratio,
      setPixelRatio: (next) => {
        ratio = next;
      },
    },
    camera,
    scene,
    stage: { setShadowLevel: (level) => void sent.maps.push(level.map) },
    detail: { setReach: (reach) => void sent.reaches.push(reach) },
    post: { setSize: () => void sent.postSizes++ },
  };
  return { quality: new PlayerQuality(host, deviceRatio), camera, scene, sent };
}

/** The far plane (m) and the fog's density the view is drawn with. */
const viewReads = ({ camera, scene }: Page): string => `${camera.far} ${(scene.fog as THREE.FogExp2).density}`;

const bootCases = [
  { it: "when the device's pixel ratio is 2, then it draws at 1.5", deviceRatio: 2, expected: "1.5" },
  { it: "when the device's pixel ratio is 1, then it draws at 1", deviceRatio: 1, expected: "1" },
  { it: "when the device's pixel ratio is 1.25, then it draws at 1.25: never above the screen's own", deviceRatio: 1.25, expected: "1.25" },
  { it: "when the device's pixel ratio is 3, then it draws at 1.5: Auto's top rung", deviceRatio: 3, expected: "1.5" },
] as const;

describe("given a page booting on Auto", () => {
  for (const testCase of bootCases) {
    it(testCase.it, () => {
      assert.equal(String(boot(testCase.deviceRatio).quality.pixelRatio), testCase.expected);
    });
  }
});

describe("given a desktop at pixel ratio 1", () => {
  it("when the player picks 2 and then Auto, then it draws at 2 with the post targets resized once, then at 1 again", () => {
    const { quality, sent } = boot(1);
    quality.setScale("2");
    assert.equal(`${quality.pixelRatio} ${sent.postSizes}`, "2 1", "picked 2");
    quality.setScale("auto");
    assert.equal(`${quality.pixelRatio} ${sent.postSizes}`, "1 2", "back to Auto");
  });
});

describe("given the sandbox (180 m, fog 0.008)", () => {
  it("when Draw distance goes to max, a course authored at 900 m / 0.0035 loads, and Draw distance goes back to auto, then the view reads 360/0.004, 1800/0.00175, 900/0.0035 and the car detail's reach 2 then 1", () => {
    const page = boot(1);
    page.quality.setDraw("max");
    assert.equal(viewReads(page), "360 0.004", "the sandbox at max");
    // A course's load: its own fog stands in the scene, then its far plane and fog density are authored.
    page.scene.fog = new THREE.FogExp2(0, 0.0035);
    page.quality.view.author(900, 0.0035);
    assert.equal(viewReads(page), "1800 0.00175", "the course at max");
    page.quality.setDraw("auto");
    assert.equal(viewReads(page), "900 0.0035", "the course at auto");
    assert.equal(page.sent.reaches.join(","), "2,1", "the car detail's reach");
  });
});

describe("given the page's URL pinned draw max", () => {
  it("when this browser's saved knobs say far / 1.5 / high, then draw stays max and the other two take the saved values; and when the player picks far and the saved knobs then say auto, then draw follows them: the pick cleared the pin", () => {
    const { quality } = boot(1);
    quality.pinFromPage("max", null, null);
    quality.setSaved("far", "1.5", "high");
    assert.equal(`${quality.draw} ${quality.scale} ${quality.shadow} | ${quality.pinnedKnobs}`, "max 1.5 high | draw", "the pin holds draw");
    quality.setDraw("far");
    quality.setSaved("auto", "auto", "auto");
    assert.equal(`${quality.draw}|${quality.pinnedKnobs}`, "auto|", "the pick cleared the pin");
  });
});

describe("given the URL arms max / 2 / max", () => {
  it("when Auto starts over (a bench step's fresh page), then the arms stay and it still draws at 2", () => {
    const { quality } = boot(2);
    quality.pinFromPage("max", "2", "max");
    quality.restartAuto();
    assert.equal(`${quality.draw} ${quality.scale} ${quality.shadow} | ${quality.pinnedKnobs} | ${quality.pixelRatio}`, "max 2 max | draw scale shadow | 2");
  });
});

describe("given a device of pixel ratio 2 in a GPU-bound match (25 ms frames, 4 ms of main-thread work, no GPU timer)", () => {
  it("when Render scale is Auto, then it steps 1.5 → 1.25 → 1; when it is picked at 1.5, then it never moves", () => {
    const steps = (quality: PlayerQuality): string => {
      const ratios: number[] = [];
      for (let t = 0; t < 30_000; t += 25) if (quality.govern(25, 4, 4, -1, true)) ratios.push(quality.pixelRatio);
      return ratios.join(",");
    };
    const auto = boot(2).quality;
    assert.equal(steps(auto), "1.25,1", "Auto walks down its rungs");
    const picked = boot(2).quality;
    picked.setScale("1.5");
    assert.equal(steps(picked), "", "the picked scale never moves");
    assert.equal(String(picked.pixelRatio), "1.5", "and it is still 1.5");
  });
});

describe("given a stage whose shadows the knob sets", () => {
  it("when Shadows go high then max then auto, then the stage gets 2048, 4096, 1024", () => {
    const { quality, sent } = boot(1);
    assert.equal(sent.maps.join(","), "", "the constructor leaves the stage's shadows as built");
    quality.setShadow("high");
    quality.setShadow("max");
    quality.setShadow("auto");
    assert.equal(sent.maps.join(","), "2048,4096,1024");
  });
});
