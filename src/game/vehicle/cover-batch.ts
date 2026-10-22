import * as THREE from "three";
import { makeGlassMaterial, makePaintMaterial, PRIVACY_SHADE } from "./car-materials.ts";
import { GLASS_ATTRIBUTE } from "./constants.ts";
import type { DeformableCar } from "./car.ts";

/** A door's room in its lane at first (vertices, indices; the sedan's is 280 and 1038); a lane grows when a field outgrows it. */
const DOOR_VERTICES = 384;
const DOOR_INDICES = 1536;
/** A pane's room (vertices, indices). */
const PANE_VERTICES = 64;
const PANE_INDICES = 256;
/** The seed triangle's vertices and indices, at the front of every lane: always in the draw range, so the program links at boot. */
const SEED = 3;
/** A part's bone while nothing draws it: every vertex of the part collapses onto one point, so its triangles draw nothing. */
const GONE = new THREE.Matrix4().makeScale(0, 0, 0);
/** What a part's shape is copied as: the rest of the lane's attributes are its own. */
const SHAPE = ["position", "normal"] as const;

/** One car part in a lane: where its vertices start, the bone that places it, the position version and colour last copied. */
interface Cover {
  readonly source: THREE.BufferGeometry;
  readonly bone: THREE.Bone;
  readonly vertexStart: number;
  version: number;
  readonly color: THREE.Color;
  /** The `sync` that last drew it. */
  seen: number;
}

/**
 * Every cut part that wears one material, merged in one rigidly skinned mesh: one draw on any browser (Firefox has no multi-draw).
 * A part's vertices are copied in once, in its own frame, and again when its shape changes; each frame its bone takes the
 * part's world matrix, or collapses it while no car draws it there.
 */
class CoverLane {
  readonly mesh: THREE.SkinnedMesh;
  private covers: Cover[] = [];
  private readonly bySource = new Map<THREE.BufferGeometry, Cover>();
  private bones: THREE.Bone[] = [];
  private maxVertices: number;
  private maxIndices: number;
  private vertexCount = SEED;
  private indexCount = SEED;
  private frame = 0;

  constructor(material: THREE.MeshStandardMaterial, parts: number, vertices: number, indices: number) {
    material.color.setRGB(1, 1, 1);
    material.vertexColors = true;
    this.maxVertices = SEED + parts * vertices;
    this.maxIndices = SEED + parts * indices;
    this.mesh = new THREE.SkinnedMesh(this.makeGeometry(), material);
    this.mesh.frustumCulled = false;
    this.mesh.visible = false;
    this.bind(parts + 1);
  }

  begin(): void {
    this.frame++;
  }

  /** Draw `part` this frame where it stands, in its material's colour (a privacy pane's darkened, a frit's black: its `GLASS_ATTRIBUTE`). */
  add(part: THREE.Mesh): void {
    const source = part.geometry;
    const version = (source.attributes.position as THREE.BufferAttribute).version;
    let cover = this.bySource.get(source);
    if (cover === undefined) cover = this.register(source, version);
    else if (cover.version !== version) {
      this.copyShape(cover);
      cover.version = version;
    }
    const color = (part.material as THREE.MeshStandardMaterial).color;
    if (!cover.color.equals(color)) this.paint(cover, color);
    cover.seen = this.frame;
    cover.bone.matrixWorld.copy(part.matrixWorld);
  }

  /** Collapse what this frame did not draw; the lane draws nothing while it covers nothing. */
  end(): void {
    let shown = false;
    for (let i = 0; i < this.covers.length; i++) {
      const cover = this.covers[i]!;
      if (cover.seen === this.frame) shown = true;
      else cover.bone.matrixWorld.copy(GONE);
    }
    this.mesh.visible = shown;
  }

  private register(source: THREE.BufferGeometry, version: number): Cover {
    const vertices = source.attributes.position!.count;
    const indices = source.index!.count;
    if (this.vertexCount + vertices > this.maxVertices || this.indexCount + indices > this.maxIndices || this.covers.length + 1 >= this.bones.length) this.makeRoom(vertices, indices);
    const cover: Cover = { source, bone: this.bones[this.covers.length + 1]!, vertexStart: this.vertexCount, version, color: new THREE.Color(-1, -1, -1), seen: this.frame };
    const g = this.mesh.geometry;
    const skinIndex = g.attributes.skinIndex as THREE.BufferAttribute;
    const skinWeight = g.attributes.skinWeight as THREE.BufferAttribute;
    const bone = this.covers.length + 1;
    for (let v = cover.vertexStart; v < cover.vertexStart + vertices; v++) {
      skinIndex.setX(v, bone);
      skinWeight.setX(v, 1);
    }
    const index = g.index!;
    const from = source.index!.array;
    for (let k = 0; k < indices; k++) index.setX(this.indexCount + k, from[k]! + cover.vertexStart);
    skinIndex.addUpdateRange(cover.vertexStart * 4, vertices * 4);
    skinWeight.addUpdateRange(cover.vertexStart * 4, vertices * 4);
    index.addUpdateRange(this.indexCount, indices);
    skinIndex.needsUpdate = skinWeight.needsUpdate = index.needsUpdate = true;
    this.vertexCount += vertices;
    this.indexCount += indices;
    g.setDrawRange(0, this.indexCount);
    this.covers.push(cover);
    this.bySource.set(source, cover);
    this.copyShape(cover);
    return cover;
  }

  private copyShape(cover: Cover): void {
    const g = this.mesh.geometry;
    for (const name of SHAPE) {
      const to = g.attributes[name] as THREE.BufferAttribute;
      const from = cover.source.attributes[name]!.array;
      (to.array as Float32Array).set(from, cover.vertexStart * 3);
      to.addUpdateRange(cover.vertexStart * 3, from.length);
      to.needsUpdate = true;
    }
  }

  private paint(cover: Cover, color: THREE.Color): void {
    cover.color.copy(color);
    const to = this.mesh.geometry.attributes.color as THREE.BufferAttribute;
    const vertices = cover.source.attributes.position!.count;
    const tone = cover.source.attributes[GLASS_ATTRIBUTE];
    for (let i = 0; i < vertices; i++) {
      const lit = tone ? 1 - Math.max(tone.getX(i), Math.min(tone.getY(i), 1) * (1 - PRIVACY_SHADE)) : 1;
      to.setXYZ(cover.vertexStart + i, color.r * lit, color.g * lit, color.b * lit);
    }
    to.addUpdateRange(cover.vertexStart * 3, vertices * 3);
    to.needsUpdate = true;
  }

  /** Room for one more part: lay out again only the parts this frame drew (gone cars and cars back to full detail leave), growing if they still do not fit. */
  private makeRoom(vertices: number, indices: number): void {
    const kept = this.covers.filter((c) => c.seen === this.frame);
    let needVertices = SEED + vertices;
    let needIndices = SEED + indices;
    for (const c of kept) {
      needVertices += c.source.attributes.position!.count;
      needIndices += c.source.index!.count;
    }
    while (this.maxVertices < needVertices) this.maxVertices *= 2;
    while (this.maxIndices < needIndices) this.maxIndices *= 2;
    const old = this.mesh.geometry;
    this.mesh.geometry = this.makeGeometry();
    old.dispose();
    if (kept.length + 2 > this.bones.length) this.bind(this.bones.length * 2);
    this.covers = [];
    this.bySource.clear();
    this.vertexCount = SEED;
    this.indexCount = SEED;
    // In order: a part's new bone is never after its old one, so no copy lands on a bone still to be read.
    for (const c of kept) {
      const moved = this.register(c.source, c.version);
      moved.bone.matrixWorld.copy(c.bone.matrixWorld);
      this.paint(moved, c.color);
    }
  }

  private makeGeometry(): THREE.BufferGeometry {
    const g = new THREE.BufferGeometry();
    for (const [name, size] of [["position", 3], ["normal", 3], ["color", 3], ["skinWeight", 4]] as const) {
      g.setAttribute(name, new THREE.BufferAttribute(new Float32Array(this.maxVertices * size), size).setUsage(THREE.DynamicDrawUsage));
    }
    g.setAttribute("skinIndex", new THREE.BufferAttribute(new Uint16Array(this.maxVertices * 4), 4).setUsage(THREE.DynamicDrawUsage));
    const index = new THREE.BufferAttribute(new Uint32Array(this.maxIndices), 1).setUsage(THREE.DynamicDrawUsage);
    index.array.set([0, 1, 2]);
    g.setIndex(index);
    g.setDrawRange(0, this.indexCount);
    return g;
  }

  /** A skeleton of `count` bones; bone 0 is the seed's, always collapsed. */
  private bind(count: number): void {
    const old = this.mesh.skeleton;
    this.bones = Array.from({ length: count }, () => {
      const bone = new THREE.Bone();
      bone.matrixWorld.copy(GONE);
      return bone;
    });
    const boneInverses = Array.from({ length: count }, () => new THREE.Matrix4());
    this.mesh.bind(new THREE.Skeleton(this.bones, boneInverses), new THREE.Matrix4());
    old?.dispose();
  }
}

/** Whether `part` is still on `car` and shown, but the distance detail took it off the camera (`CarDetail`). */
function cut(car: DeformableCar, part: THREE.Object3D): boolean {
  if (part.layers.isEnabled(0)) return false;
  for (let p: THREE.Object3D | null = part; p !== null; p = p.parent) {
    if (!p.visible) return false;
    if (p === car.group) return true;
  }
  return false;
}

/**
 * The doors and panes the distance detail has cut, drawn as two draws for the whole field so a cut car still reads closed: the body's
 * door cut is open to the sill and its greenhouse is glass. A torn door or a shattered pane is not the car's to cover: its hole stays.
 */
export class CoverBatch {
  /** The doors, then the glass. */
  readonly meshes: readonly THREE.SkinnedMesh[];
  /** The one object the scene holds: the draws under a group that is never hidden, so `ParkingScene` keeps a draw hidden at its pass that `sync` then shows. */
  readonly group = new THREE.Group();
  private readonly doors: CoverLane;
  private readonly glass: CoverLane;

  constructor(cars: number) {
    this.doors = new CoverLane(makePaintMaterial(0xffffff), cars * 2, DOOR_VERTICES, DOOR_INDICES);
    this.glass = new CoverLane(makeGlassMaterial(), cars * 6, PANE_VERTICES, PANE_INDICES);
    this.glass.mesh.renderOrder = 2;
    this.meshes = [this.doors.mesh, this.glass.mesh];
    this.group.add(...this.meshes);
  }

  /** Pack the cut doors and panes of `cars` (world matrices must be current). */
  sync(cars: readonly DeformableCar[]): void {
    this.doors.begin();
    this.glass.begin();
    for (const car of cars) {
      for (const door of car.apertureParts) if (cut(car, door)) this.doors.add(door);
      for (const pane of car.glassPanes) if (cut(car, pane.mesh)) this.glass.add(pane.mesh);
    }
    this.doors.end();
    this.glass.end();
  }

  dispose(): void {
    for (const mesh of this.meshes) {
      mesh.geometry.dispose();
      mesh.skeleton.dispose();
      (mesh.material as THREE.Material).dispose();
    }
  }
}
