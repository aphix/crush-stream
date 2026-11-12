import { detCos, detSin } from "../../kernel/physics-core.js";
import * as THREE from "three";
import { uploadRange } from "../engine-fx.ts";
import type { Piece } from "../prefab-pieces.ts";
import { bakeCorner, type RoomLight } from "./interior-light.ts";

/** Floats of one vertex in each of the streams a packed mesh holds (position, normal and colour are three each). */
const STREAM_FLOATS = 3;
/** Floats of one vertex in the light stream: lamp r, g, b and daylight. */
const LIGHT_FLOATS = 4;
/** A slot free to take a build: its count reads this. */
const FREE = -1;
/** What `add` hands back for pieces that have no vertex: no slot, nothing to take out. */
export const NO_SLOT = -1;
/** Slots a packed mesh starts with (one a built piece of an interior), doubled when they run out. */
const START_SLOTS = 32;

/** Vertices a piece draws: its triangles' corners (an indexed geometry is read corner by corner). */
const cornersOf = (geometry: THREE.BufferGeometry): number => (geometry.index === null ? geometry.getAttribute("position").count : geometry.index.count);

/**
 * One mesh for every interior built of a kind (envelopes, furniture, lamps, glass): their pieces are packed one after another as plain triangle corners in storage that is made once and doubled only
 * when a build needs more, so its size stops growing once the busiest street has been driven. A built interior is written at the end, a dropped one's range is closed over by moving what follows it down,
 * and only the vertices that changed are sent to the card: a build or a drop makes no geometry, no buffer and no array, and the mesh is one draw however many interiors it holds.
 */
export class PackedMesh {
  readonly mesh: THREE.Mesh;
  private capacity: number;
  private used = 0;
  private position: THREE.BufferAttribute;
  private normal: THREE.BufferAttribute;
  private color: THREE.BufferAttribute;
  private light: THREE.BufferAttribute;
  private slotStart = new Int32Array(START_SLOTS);
  private slotCount = new Int32Array(START_SLOTS).fill(FREE);
  private readonly tint = new THREE.Color();

  constructor(name: string, material: THREE.Material, startVertices: number) {
    this.capacity = startVertices;
    this.position = this.streamOf(startVertices);
    this.normal = this.streamOf(startVertices);
    this.color = this.streamOf(startVertices);
    this.light = this.streamOf(startVertices, LIGHT_FLOATS);
    this.mesh = new THREE.Mesh(this.geometryOf(), material);
    this.mesh.name = name;
    this.mesh.visible = false;
    // The merged range changes with every build and drop: a bounding sphere kept in step would cost more than drawing it.
    this.mesh.frustumCulled = false;
  }

  /** Vertices packed, all drawn. */
  get vertices(): number {
    return this.used;
  }

  /** Whether the mesh's storage is the one it was given at construction or last grew to: the arrays are made again only when this changes. */
  get storage(): Float32Array {
    return this.position.array as Float32Array;
  }

  /** Pack `pieces` (in the building's frame, turned by `yaw` about y and moved to (x, z)) after what is packed; the slot to take them out by, or `NO_SLOT` when they have no vertex. `lighting`: the room whose baked light each corner takes (`bakeCorner`); null: full light. `furniture`: the pieces are furnishings. */
  add(pieces: readonly Piece[], yaw: number, x: number, z: number, lighting: RoomLight | null = null, furniture = false): number {
    let count = 0;
    for (let at = 0; at < pieces.length; at++) count += cornersOf(pieces[at]![0]);
    if (count === 0) return NO_SLOT;
    if (this.used + count > this.capacity) this.grow(this.used + count);
    const slot = this.takeSlot();
    const start = this.used;
    const cos = detCos(yaw);
    const sin = detSin(yaw);
    let at = start;
    for (let piece = 0; piece < pieces.length; piece++) at = this.write(pieces[piece]!, at, cos, sin, x, z, lighting, furniture);
    this.slotStart[slot] = start;
    this.slotCount[slot] = count;
    this.used += count;
    this.send(start, count);
    return slot;
  }

  /** Take a slot's vertices out, the ones packed after them moving down to close the gap. */
  remove(slot: number): void {
    if (slot === NO_SLOT) return;
    const start = this.slotStart[slot]!;
    const count = this.slotCount[slot]!;
    const after = start + count;
    const moved = this.used - after;
    if (moved > 0) {
      for (const stream of [this.position, this.normal, this.color]) (stream.array as Float32Array).copyWithin(start * STREAM_FLOATS, after * STREAM_FLOATS, this.used * STREAM_FLOATS);
      (this.light.array as Float32Array).copyWithin(start * LIGHT_FLOATS, after * LIGHT_FLOATS, this.used * LIGHT_FLOATS);
      for (let other = 0; other < this.slotCount.length; other++) if (this.slotCount[other] !== FREE && this.slotStart[other]! > start) this.slotStart[other] = this.slotStart[other]! - count;
    }
    this.slotCount[slot] = FREE;
    this.used -= count;
    this.send(start, moved);
  }

  /** Scale a slot's colours by `ratio` in place (a room's lamps and screens dimmed, or lit again) and send them. */
  scaleColor(slot: number, ratio: number): void {
    if (slot === NO_SLOT) return;
    const start = this.slotStart[slot]! * STREAM_FLOATS;
    const end = start + this.slotCount[slot]! * STREAM_FLOATS;
    const color = this.color.array as Float32Array;
    for (let at = start; at < end; at++) color[at] = color[at]! * ratio;
    uploadRange(this.color, start, end - start);
  }

  /** Scales the lamp light of every corner of `slot` (a shut place dims, an opened one comes back) and sends it. */
  scaleLamp(slot: number, ratio: number): void {
    if (slot === NO_SLOT) return;
    const light = this.light.array as Float32Array;
    const start = this.slotStart[slot]! * LIGHT_FLOATS;
    const end = start + this.slotCount[slot]! * LIGHT_FLOATS;
    for (let at = start; at < end; at += LIGHT_FLOATS) {
      light[at] = light[at]! * ratio;
      light[at + 1] = light[at + 1]! * ratio;
      light[at + 2] = light[at + 2]! * ratio;
    }
    uploadRange(this.light, start, end - start);
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    this.mesh.removeFromParent();
  }

  private streamOf(vertices: number, floats = STREAM_FLOATS): THREE.BufferAttribute {
    const stream = new THREE.BufferAttribute(new Float32Array(vertices * floats), floats);
    stream.setUsage(THREE.DynamicDrawUsage);
    return stream;
  }

  private geometryOf(): THREE.BufferGeometry {
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", this.position);
    geometry.setAttribute("normal", this.normal);
    geometry.setAttribute("color", this.color);
    geometry.setAttribute("light", this.light);
    geometry.setDrawRange(0, this.used);
    return geometry;
  }

  /** Room for `needed` vertices: new storage twice the size (or that), what is packed copied over, the old geometry's buffers released. */
  private grow(needed: number): void {
    const capacity = Math.max(2 * this.capacity, needed);
    const grown = [this.position, this.normal, this.color].map((stream) => {
      const next = this.streamOf(capacity);
      (next.array as Float32Array).set((stream.array as Float32Array).subarray(0, this.used * STREAM_FLOATS));
      return next;
    });
    this.capacity = capacity;
    [this.position, this.normal, this.color] = grown as [THREE.BufferAttribute, THREE.BufferAttribute, THREE.BufferAttribute];
    const nextLight = this.streamOf(capacity, LIGHT_FLOATS);
    (nextLight.array as Float32Array).set((this.light.array as Float32Array).subarray(0, this.used * LIGHT_FLOATS));
    this.light = nextLight;
    const old = this.mesh.geometry;
    this.mesh.geometry = this.geometryOf();
    old.dispose();
  }

  private takeSlot(): number {
    for (let slot = 0; slot < this.slotCount.length; slot++) if (this.slotCount[slot] === FREE) return slot;
    const slots = this.slotCount.length;
    const starts = new Int32Array(2 * slots);
    const counts = new Int32Array(2 * slots).fill(FREE);
    starts.set(this.slotStart);
    counts.set(this.slotCount);
    this.slotStart = starts;
    this.slotCount = counts;
    return slots;
  }

  /** Write a piece's triangle corners from vertex `at`, the building's frame turned and moved into the world's (`rotateY` then `translate`); the vertex after the last. */
  private write(piece: Piece, at: number, cos: number, sin: number, x: number, z: number, lighting: RoomLight | null, furniture: boolean): number {
    const [geometry, hex] = piece;
    if (geometry.getAttribute("normal") === undefined) geometry.computeVertexNormals();
    const from = geometry.getAttribute("position");
    const fromNormal = geometry.getAttribute("normal");
    const index = geometry.index;
    const corners = cornersOf(geometry);
    this.tint.setHex(hex);
    const position = this.position.array as Float32Array;
    const normal = this.normal.array as Float32Array;
    const color = this.color.array as Float32Array;
    const light = this.light.array as Float32Array;
    for (let corner = 0; corner < corners; corner++) {
      const vertex = index === null ? corner : index.getX(corner);
      const px = from.getX(vertex);
      const pz = from.getZ(vertex);
      const nx = fromNormal.getX(vertex);
      const nz = fromNormal.getZ(vertex);
      const lit = (at + corner) * LIGHT_FLOATS;
      if (lighting !== null) bakeCorner(lighting, px, from.getY(vertex), pz, nx, fromNormal.getY(vertex), nz, furniture, light, lit);
      else {
        light[lit] = 1;
        light[lit + 1] = 1;
        light[lit + 2] = 1;
        light[lit + 3] = 1;
      }
      const out = (at + corner) * STREAM_FLOATS;
      position[out] = cos * px + sin * pz + x;
      position[out + 1] = from.getY(vertex);
      position[out + 2] = -sin * px + cos * pz + z;
      normal[out] = cos * nx + sin * nz;
      normal[out + 1] = fromNormal.getY(vertex);
      normal[out + 2] = -sin * nx + cos * nz;
      color[out] = this.tint.r;
      color[out + 1] = this.tint.g;
      color[out + 2] = this.tint.b;
    }
    return at + corners;
  }

  /** The vertices from `start` for `count` changed: send them, and draw the packed range. */
  private send(start: number, count: number): void {
    if (count > 0) {
      for (const stream of [this.position, this.normal, this.color]) uploadRange(stream, start * STREAM_FLOATS, count * STREAM_FLOATS);
      uploadRange(this.light, start * LIGHT_FLOATS, count * LIGHT_FLOATS);
    }
    this.mesh.geometry.setDrawRange(0, this.used);
    this.mesh.visible = this.used > 0;
  }
}
