import assert from "node:assert/strict";
import { describe, it } from "node:test";
import * as THREE from "three";
import { applyMarkMap, SkidMarks, type MarkRenderer } from "./engine-marks.ts";
import { OFF_MENU, TRACKS } from "../world/tracks/index.ts";
import { Track } from "../world/track.ts";

/** Wall seconds a frame adds to the fade's clock: far under the 0.6 s fade period over a test's few frames. */
const WALL_DT = 0.001;
const FADE_DUE_DT = 1;
const MAP_SIZE = 64;
/** The camera's ground position the map's window follows, in the rows that do not move it. */
const FOCUS = [0, 0] as const;
/** A tyre's mark width (m), `TYRE_W` in engine-marks.ts. */
const TYRE_W = 0.24;
/** The map sizes the FX tiers use (`MARK_RES` in engine-cine.ts). */
const TIER_MAP_SIZES = [1024, 2048] as const;

/** A renderer that counts the `render()` calls into the mark map and the stamp quads each one draws. */
function countingRenderer(marks: SkidMarks) {
  const stamp = marks.scene.children[0];
  if (!(stamp instanceof THREE.Mesh)) throw new Error("the mark scene's first child is the stamp mesh");
  const drawn = { renders: 0, quads: 0 };
  const renderer: MarkRenderer = {
    autoClear: true,
    getRenderTarget: () => null,
    setRenderTarget: () => {},
    getClearColor: (target) => target,
    getClearAlpha: () => 1,
    setClearColor: () => {},
    clear: () => {},
    render: () => {
      drawn.renders++;
      if (stamp.visible) drawn.quads += stamp.geometry.drawRange.count / 6;
    },
  };
  return { renderer, drawn };
}

/** A map with its first (wipe) flush done, so what follows is steady-state frames. */
function settledMarks() {
  const marks = new SkidMarks(4);
  marks.setResolution(MAP_SIZE);
  const { renderer, drawn } = countingRenderer(marks);
  marks.flush(renderer, WALL_DT, ...FOCUS);
  return { marks, renderer, drawn };
}

function layStamp(marks: SkidMarks): void {
  marks["queue"](0, 0, 0, 1, 0, 0.24, 0, 1);
}

describe("given the mark map with a wheel laying one stamp every frame", () => {
  it("when 60 frames queue and flush, then the map is drawn once per two frames and every stamp is in a draw", () => {
    const { marks, renderer, drawn } = settledMarks();
    for (let frame = 0; frame < 60; frame++) {
      layStamp(marks);
      marks.flush(renderer, WALL_DT, ...FOCUS);
    }
    assert.equal(drawn.renders, 30, "render() calls into the mark map");
    assert.equal(drawn.quads, 60, "stamp quads drawn: none dropped, none drawn twice");
  });

  it("when the first stamp is queued, then it is drawn by the next frame's flush", () => {
    const { marks, renderer, drawn } = settledMarks();
    layStamp(marks);
    marks.flush(renderer, WALL_DT, ...FOCUS);
    assert.equal(drawn.renders, 0, "the first frame's stamp waits for the second");
    marks.flush(renderer, WALL_DT, ...FOCUS);
    assert.equal(drawn.quads, 1, "the second flush draws it");
  });
});

/** A settled map holding ink (one stamp drawn into it, so a due fade has marks to take off), its counts back at zero. */
function inkedMarks() {
  const settled = settledMarks();
  layStamp(settled.marks);
  settled.marks.flush(settled.renderer, WALL_DT, ...FOCUS);
  settled.marks.flush(settled.renderer, WALL_DT, ...FOCUS);
  Object.assign(settled.drawn, { renders: 0, quads: 0 });
  return settled;
}

describe("given a stamp waiting for the next frame's draw", () => {
  it("when the fade comes due that frame, then the stamp goes in with the fade, not a frame later", () => {
    const { marks, renderer, drawn } = inkedMarks();
    layStamp(marks);
    marks.flush(renderer, FADE_DUE_DT, ...FOCUS);
    assert.deepEqual(drawn, { renders: 1, quads: 1 });
  });

  it("when the map is cleared, then the waiting stamp is dropped with the old marks", () => {
    const { marks, renderer, drawn } = settledMarks();
    layStamp(marks);
    marks.flush(renderer, WALL_DT, ...FOCUS);
    marks.clear();
    marks.flush(renderer, WALL_DT, ...FOCUS);
    marks.flush(renderer, WALL_DT, ...FOCUS);
    assert.deepEqual(drawn, { renders: 0, quads: 0 });
  });
});

/** Flush `n` frames, each with a fade due and no stamp. */
function fadeFrames(marks: SkidMarks, renderer: MarkRenderer, n: number): void {
  for (let i = 0; i < n; i++) marks.flush(renderer, FADE_DUE_DT, ...FOCUS);
}

describe("given the mark map's periodic fade", () => {
  it("when a wiped map that was never stamped sees 10 fade periods, then nothing is drawn into it", () => {
    const { marks, renderer, drawn } = settledMarks();
    fadeFrames(marks, renderer, 10);
    assert.equal(drawn.renders, 0);
  });

  it("when one stamp was drawn and 300 fade periods pass, then the map is faded 255 times, a full-ink texel's 8-bit steps, and then left alone", () => {
    const { marks, renderer, drawn } = inkedMarks();
    fadeFrames(marks, renderer, 300);
    assert.equal(drawn.renders, 255);
  });

  it("when a new stamp goes in with the 101st fade, then 255 more fades follow it", () => {
    const { marks, renderer, drawn } = inkedMarks();
    fadeFrames(marks, renderer, 100);
    layStamp(marks);
    fadeFrames(marks, renderer, 1 + 300);
    assert.equal(drawn.renders, 100 + 1 + 255);
  });

  it("when the map is cleared after a stamp, then no fade runs", () => {
    const { marks, renderer, drawn } = inkedMarks();
    marks.clear();
    marks.flush(renderer, WALL_DT, ...FOCUS);
    fadeFrames(marks, renderer, 10);
    assert.equal(drawn.renders, 0);
  });
});

/** The window rect and map the ground materials sample (`applyMarkMap`'s uniforms, read off a patched material's compile). */
function groundSample(): { rect: THREE.Vector4; map: THREE.Texture } {
  const material = new THREE.MeshStandardMaterial();
  applyMarkMap(material);
  const uniforms: Record<string, THREE.IUniform> = {};
  // The patch reads and writes only these three fields of the compile's parameters, and never the renderer.
  const shader = { uniforms, vertexShader: "", fragmentShader: "" } as THREE.WebGLProgramParametersWithUniforms;
  const renderer = {} as THREE.WebGLRenderer;
  material.onBeforeCompile(shader, renderer);
  return { rect: uniforms.uMarkRect!.value, map: uniforms.uMarkMap!.value };
}

describe("given the mark map on every course at each tier's map size", () => {
  const courses = [...TRACKS, ...OFF_MENU].map((json) => new Track(json));
  for (const size of TIER_MAP_SIZES) {
    it(`when the ground samples a ${size}-texel map round the camera, then on every course a tyre is wider than a texel's diagonal (a stamp leaves no gaps)`, () => {
      const marks = new SkidMarks(4);
      marks.setResolution(size);
      const { renderer } = countingRenderer(marks);
      const coarse: string[] = [];
      for (const course of courses) {
        const b = course.bounds;
        marks.setBounds(b.minX, b.minZ, b.maxX, b.maxZ);
        marks.flush(renderer, WALL_DT, (b.minX + b.maxX) / 2, (b.minZ + b.maxZ) / 2);
        const { rect, map } = groundSample();
        assert.equal(map, marks["rt"]!.texture, "the ground samples this map");
        const texels = marks["rt"]!.width;
        const diagonal = Math.hypot(1 / (rect.z * texels), 1 / (rect.w * texels));
        if (diagonal >= TYRE_W) coarse.push(`${course.id} ${(diagonal * 100).toFixed(1)} cm`);
      }
      assert.deepEqual(coarse, [], "texel diagonals at least a tyre wide");
    });
  }
});

/** A `size`-texel map (`size` × 10 cm window, 1/16 steps) on a course of `bounds`, each `clear` into it logged as its scissor rect "x,y,w,h". */
function wideCourseMarks(size = MAP_SIZE, bounds: readonly [number, number, number, number] = [-100, -100, 100, 100]) {
  const marks = new SkidMarks(4);
  marks.setResolution(size);
  marks.setBounds(...bounds);
  const { renderer } = countingRenderer(marks);
  const wiped: string[] = [];
  renderer.clear = () => {
    const s = marks["rt"]!.scissor;
    wiped.push(`${s.x},${s.y},${s.z},${s.w}`);
  };
  return { marks, renderer, wiped };
}

describe("given a course wider than the map's window", () => {
  it("when the shot's focus moves one step along x, then one band of columns a step wide is wiped, where the window just reached", () => {
    const { marks, renderer, wiped } = wideCourseMarks();
    marks.flush(renderer, WALL_DT, 0.2, 0.1);
    wiped.length = 0;
    marks.flush(renderer, WALL_DT, 0.6, 0.1);
    assert.equal(wiped.join(" "), `32,0,4,${MAP_SIZE}`, "window x 3.2..3.6 m: columns 32-35");
  });

  it("when the shot's focus jumps three steps across the map's edge, then the band is wiped in two parts: the last columns and the first", () => {
    const { marks, renderer, wiped } = wideCourseMarks();
    marks.flush(renderer, WALL_DT, 2.6, 0.1);
    wiped.length = 0;
    marks.flush(renderer, WALL_DT, 3.8, 0.1);
    assert.equal(wiped.join(" "), `56,0,8,${MAP_SIZE} 0,0,4,${MAP_SIZE}`, "window x 5.6..6.8 m: columns 56-63 and 0-3");
  });

  it("when the shot's focus stays inside its step, then nothing is wiped", () => {
    const { marks, renderer, wiped } = wideCourseMarks();
    marks.flush(renderer, WALL_DT, 0.2, 0.1);
    wiped.length = 0;
    marks.flush(renderer, WALL_DT, 0.35, 0.3);
    assert.equal(wiped.length, 0);
  });
});

/** The National Mall's mark rect (m), rounded out. */
const MALL_BOUNDS = [-2080, -1230, 730, 120] as const;
/** A first crash's spot on it, mid-texel. */
const FIRST_CRASH = [100.05, -300.05] as const;

describe("given a reel on the National Mall with its 2048² map, the first crash's marks laid with the window on that crash", () => {
  const directions = Array.from({ length: 8 }, (_, k) => (k * Math.PI) / 4);
  for (const away of [20, 30, 40]) {
    it(`when it cuts to a later crash ${away} m off in any of 8 directions, then no wipe touches the first crash's texel and the window still holds it`, () => {
      const hit: string[] = [];
      for (const a of directions) {
        const { marks, renderer, wiped } = wideCourseMarks(2048, MALL_BOUNDS);
        const [x, z] = FIRST_CRASH;
        marks.flush(renderer, WALL_DT, x, z);
        wiped.length = 0;
        marks.flush(renderer, WALL_DT, x + away * Math.cos(a), z + away * Math.sin(a));
        const { rect } = groundSample();
        const col = Math.floor((((x * rect.z) % 1) + 1) % 1 * 2048);
        const row = Math.floor((((z * rect.w) % 1) + 1) % 1 * 2048);
        const inside = (x - rect.x) * rect.z < 1 && x >= rect.x && (z - rect.y) * rect.w < 1 && z >= rect.y;
        const covered = wiped.some((r) => {
          const [rx, ry, rw, rh] = r.split(",").map(Number) as [number, number, number, number];
          return col >= rx && col < rx + rw && row >= ry && row < ry + rh;
        });
        if (!inside || covered) hit.push(`${((a * 180) / Math.PI).toFixed(0)}°: ${inside ? "wiped" : "outside the window"}`);
      }
      assert.equal(hit.join("; "), "", "directions that lose the first crash's marks");
    });
  }
});

/** Corner `v` (0 start left, 1 start right, 2 end right, 3 end left) of stamp quad `q` as (x, z). */
function corner(marks: SkidMarks, q: number, v: number): [number, number] {
  const p = marks["pos"];
  return [p[q * 12 + v * 3]!, p[q * 12 + v * 3 + 1]!];
}

/** Corner `v` of quad `q` as exact text, so two corners compare as one string. */
const cornerText = (marks: SkidMarks, q: number, v: number): string => corner(marks, q, v).join(",");

const edgeLength = (a: [number, number], b: [number, number]): number => Math.hypot(b[0] - a[0], b[1] - a[1]);

describe("given a wheel laying a stamp every frame round a 6 m turn", () => {
  const marks = new SkidMarks(4);
  marks.setResolution(MAP_SIZE);
  const STAMPS = 12;
  const at = (i: number): [number, number] => [6 * Math.sin(i * 0.08), 6 - 6 * Math.cos(i * 0.08)];
  for (let i = 1; i <= STAMPS; i++) marks["queue"](0, ...at(i - 1), ...at(i), TYRE_W, 0, 1);

  it("when its quads are read, then each starts exactly on the edge the one before ended on (one strip, no wedge gaps)", () => {
    for (let q = 1; q < STAMPS; q++) {
      assert.equal(cornerText(marks, q, 0), cornerText(marks, q - 1, 3), `quad ${q} start left`);
      assert.equal(cornerText(marks, q, 1), cornerText(marks, q - 1, 2), `quad ${q} start right`);
    }
  });

  it("when its quads are read, then every edge is a tyre wide", () => {
    for (let q = 0; q < STAMPS; q++) {
      assert.ok(Math.abs(edgeLength(corner(marks, q, 0), corner(marks, q, 1)) - TYRE_W) < 1e-6, `quad ${q} start edge`);
      assert.ok(Math.abs(edgeLength(corner(marks, q, 3), corner(marks, q, 2)) - TYRE_W) < 1e-6, `quad ${q} end edge`);
    }
  });
});

describe("given the mark map at each tier's size on a phone and on a desktop", () => {
  const [low, high] = TIER_MAP_SIZES;
  it("when a phone's FX tier flips low, high, low, high, then its map stays 1024 texels in the same target, never resized", () => {
    const marks = new SkidMarks(4);
    marks.phone = true;
    marks.setResolution(low);
    const rt = marks["rt"]!;
    let resized = 0;
    rt.addEventListener("dispose", () => resized++);
    for (const size of [high, low, high]) marks.setResolution(size);
    assert.equal(marks["rt"], rt, "the phone's map target");
    assert.equal(rt.width, low, "the phone's map edge");
    assert.equal(resized, 0, "resizes of the phone's map (setSize frees the old storage)");
  });

  it("when a desktop's FX tier goes to high, then its map is 2048 texels", () => {
    const marks = new SkidMarks(4);
    marks.setResolution(high);
    assert.equal(marks["rt"]!.width, high);
  });
});
