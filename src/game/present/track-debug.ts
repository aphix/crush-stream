import * as THREE from "three";
import { SURFACE_IDS, type SurfaceId } from "../world/catalog.ts";
import type { Ground } from "../world/ground.ts";
import { blankPoint, pointOn, sampleAt, type Track } from "../world/track.ts";

/** The Debug-views "Track" overlay: a line across the road at each path node in its surface's ink with the node's index past it, and each checkpoint gate as a yellow strip. */

/** Label ink per surface the node starts, picked to read on that surface (not the surface's own colour). */
const INK: Record<SurfaceId, string> = {
  asphalt: "#00e5ff",
  concrete: "#ff2bd6",
  cobble: "#ff8a00",
  dirt: "#9dff00",
  gravel: "#f4f4f4",
  grass: "#ff3030",
  sand: "#0050ff",
  mud: "#00ffa8",
};
/** Metres above the ground at the node: over the dish's rise across a label's half-width and the pit's slope, so nothing z-fights or sinks. */
const LIFT = 0.3;
const GATE_WIDTH = 1;
/** Depth (m) along the travel of the line across the road where a node's run starts. */
const EDGE_WIDTH = 0.4;
/** A label's footprint (m): a 2-digit index about 2.5 m tall, readable from a chase camera's height and from above. */
const LABEL_W = 6;
const LABEL_H = 3;

function labelTexture(text: string, ink: string): THREE.CanvasTexture {
  const canvas = document.createElement("canvas");
  canvas.width = 128;
  canvas.height = 64;
  const g = canvas.getContext("2d")!;
  // A dark plate under the digits: the index reads on any surface.
  g.fillStyle = "rgba(0, 0, 0, 0.6)";
  g.fillRect(0, 0, 128, 64);
  g.font = "bold 52px sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.lineWidth = 8;
  g.lineJoin = "round";
  g.strokeStyle = "#0a0a0a";
  g.strokeText(text, 64, 34);
  g.fillStyle = ink;
  g.fillText(text, 64, 34);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

export class TrackDebug {
  readonly group = new THREE.Group();
  private readonly geos: THREE.BufferGeometry[] = [];
  private readonly mats: THREE.Material[] = [];
  private readonly texs: THREE.Texture[] = [];

  constructor(track: Track) {
    this.group.name = "track-debug";
    this.addNodes(track);
    this.addGates(track);
  }

  /** Each node: a line across the road where its run starts (its surface's ink), and its index flat on the road just past it. */
  private addNodes(track: Track): void {
    const ground = track.ground();
    const path = track.path;
    const pt = blankPoint();
    const inkMats = new Map<SurfaceId, THREE.MeshBasicMaterial>();
    // Flat, facing up, text-up toward -z: readable from above in a north-up view.
    const plane = new THREE.PlaneGeometry(LABEL_W, LABEL_H).rotateX(-Math.PI / 2);
    this.geos.push(plane);
    for (let i = 0; i < track.nodeS.length; i++) {
      const s = track.nodeS[i]!;
      pointOn(path, s, pt);
      // Half a sample in: the node's own sample, not the previous one's (`samplePath` floors the parameter).
      const surf = SURFACE_IDS[path.surface[sampleAt(path, s + (0.5 * path.length) / path.count)]!]!;
      let edge = inkMats.get(surf);
      if (!edge) {
        edge = new THREE.MeshBasicMaterial({ color: INK[surf], side: THREE.DoubleSide, toneMapped: false, depthWrite: false, depthTest: false });
        inkMats.set(surf, edge);
        this.mats.push(edge);
      }
      // Left of travel is (tz, −tx): the line spans the road's width at the node, `EDGE_WIDTH` deep along the travel.
      const lx = pt.tz * pt.half;
      const lz = -pt.tx * pt.half;
      this.strip(ground, pt.x + lx, pt.z + lz, pt.x - lx, pt.z - lz, pt.tx, pt.tz, EDGE_WIDTH, pt.y, edge, `track-debug:edge:${i}`, 11);
      const tex = labelTexture(String(i), INK[surf]);
      // Drawn over everything (as `ragdoll-debug.ts` is): a debug label is never hidden by a dished or sloping road.
      const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false, depthTest: false });
      this.texs.push(tex);
      this.mats.push(mat);
      const mesh = new THREE.Mesh(plane, mat);
      mesh.name = `track-debug:node:${i}`;
      // Just past the edge line along the travel, so the line and the index never overlap.
      const ax = pt.x + pt.tx * (LABEL_H * 0.5 + EDGE_WIDTH);
      const az = pt.z + pt.tz * (LABEL_H * 0.5 + EDGE_WIDTH);
      mesh.position.set(ax, ground.heightAt(ax, az, pt.y) + LIFT, az);
      mesh.renderOrder = 10;
      this.group.add(mesh);
    }
  }

  /** A flat strip from a to b, `width` m deep along (nx, nz), `LIFT` over the ground at each corner. */
  private strip(ground: Ground, ax: number, az: number, bx: number, bz: number, nx: number, nz: number, width: number, y: number, mat: THREE.Material, name: string, order: number): void {
    const ox = nx * width * 0.5;
    const oz = nz * width * 0.5;
    const xz = [ax - ox, az - oz, bx - ox, bz - oz, bx + ox, bz + oz, ax + ox, az + oz];
    const pos = new Float32Array(12);
    for (let c = 0; c < 4; c++) {
      const x = xz[c * 2]!;
      const z = xz[c * 2 + 1]!;
      pos[c * 3] = x;
      pos[c * 3 + 1] = ground.heightAt(x, z, y) + LIFT;
      pos[c * 3 + 2] = z;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setIndex([0, 1, 2, 0, 2, 3]);
    this.geos.push(geo);
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = name;
    mesh.renderOrder = order;
    this.group.add(mesh);
  }

  /** Each gate a→b as a strip GATE_WIDTH wide along the travel direction: the line a car's centre must cross. */
  private addGates(track: Track): void {
    const ground = track.ground();
    const pt = blankPoint();
    const mat = new THREE.MeshBasicMaterial({ color: 0xffe000, side: THREE.DoubleSide, toneMapped: false, depthWrite: false });
    this.mats.push(mat);
    for (let i = 0; i < track.gates.length; i++) {
      const gate = track.gates[i]!;
      const y = pointOn(track.path, gate.s, pt).y;
      this.strip(ground, gate.ax, gate.az, gate.bx, gate.bz, gate.nx, gate.nz, GATE_WIDTH, y, mat, `track-debug:gate:${i}`, 9);
    }
  }

  dispose(): void {
    for (const g of this.geos) g.dispose();
    for (const m of this.mats) m.dispose();
    for (const t of this.texs) t.dispose();
    this.group.removeFromParent();
    this.group.clear();
  }
}
