import { describe, expect, it, vi } from "vitest";
import * as THREE from "three";
import { element, stubBrowser } from "../engine/engine-headless.test-util.ts";
import { TRACK_ID } from "../world/constants.ts";
import { placeProps } from "../world/placements.ts";
import { parseTrack } from "../world/track-schema.ts";
import { Track } from "../world/track.ts";
import { TRACKS } from "../world/tracks/index.ts";
import { TrackArt } from "./track-art.ts";

/** The mushroom cloud's canvas (px): the one canvas of this size the art paints. */
const CLOUD_CANVAS = { w: 1024, h: 640 };

/** A document that remembers each canvas made, and answers a flash's glare. */
function recordingDocument(t: { onTestFinished(fn: () => void): void }) {
  stubBrowser();
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const canvases: HTMLCanvasElement[] = [];
  const glare = { style: { cssText: "" }, remove() {}, animate: () => ({ cancel() {}, onfinish: null }) };
  const document = {
    createElement: (tag: string) => {
      if (tag === "div") return glare;
      const canvas = element();
      canvases.push(canvas);
      return canvas;
    },
  };
  Object.defineProperty(globalThis, "document", { value: document, configurable: true, writable: true });
  t.onTestFinished(() => {
    Reflect.deleteProperty(globalThis, "document");
    vi.useRealTimers();
  });
  return { clouds: () => canvases.filter((c) => c.width === CLOUD_CANVAS.w && c.height === CLOUD_CANVAS.h).length };
}

const mallArt = (): TrackArt => {
  const track = new Track(TRACKS.find((json) => parseTrack(json).id === TRACK_ID.nationalMall)!);
  return new TrackArt(track, placeProps(track), { look() {} });
};
const cloudMeshes = (art: TrackArt): THREE.Object3D[] => art.group.children.filter((o) => o.name === "backdrop:mushroom-cloud");

describe("given the National Mall's secret mushroom cloud (a backdrop hidden until the Konami code)", () => {
  it("when the course's art is built, then no cloud canvas is painted and no cloud mesh is in the art", (t) => {
    const doc = recordingDocument(t);
    const art = mallArt();
    expect(doc.clouds(), "cloud canvases painted at load").toBe(0);
    expect(cloudMeshes(art).length, "cloud meshes in the art").toBe(0);
    art.dispose();
  });

  it("when the code is entered, then nothing is painted until the flash's peak, where the cloud is painted once and stands, and the flash painted nothing more", (t) => {
    const doc = recordingDocument(t);
    const art = mallArt();
    art.reveal({ appendChild: (node) => node });
    expect(doc.clouds(), "painted before the peak").toBe(0);
    vi.advanceTimersByTime(10_000);
    expect(doc.clouds(), "painted at the peak").toBe(1);
    const [cloud] = cloudMeshes(art) as THREE.Mesh[];
    expect(cloud?.visible, "the cloud stands").toBeTruthy();
    const material = cloud!.material as THREE.MeshBasicMaterial;
    expect(material.transparent && material.side === THREE.DoubleSide && material.forceSinglePass, "a see-through double-sided panel takes one pass, not three's two").toBeTruthy();
    art.dispose();
  });

  it("when the race restarts after the code, then the cloud is gone from the art and the next code paints it again; a flash stopped before its peak paints nothing", (t) => {
    const doc = recordingDocument(t);
    const art = mallArt();
    art.reveal({ appendChild: (node) => node });
    art.resetSecret();
    vi.advanceTimersByTime(10_000);
    expect(doc.clouds(), "a stopped flash never reaches its peak").toBe(0);
    art.reveal({ appendChild: (node) => node });
    vi.advanceTimersByTime(10_000);
    expect(cloudMeshes(art).length, "stands after the second code").toBe(1);
    art.resetSecret();
    expect(cloudMeshes(art).length, "gone again after the restart").toBe(0);
    art.reveal({ appendChild: (node) => node });
    vi.advanceTimersByTime(10_000);
    expect(doc.clouds(), "painted again for the third code").toBe(2);
    art.dispose();
  });
});
