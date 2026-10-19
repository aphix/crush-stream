import * as THREE from "three";
import { BLOCK_DEPTH, BLOCK_WIDTH, PODIUM_BLOCKS, type PodiumPlace } from "../match/podium.ts";
import { canvasTexture } from "./lab-art.ts";
import { BANNER_FRAME_PX, BANNER_PX, bannerLayout, DECAL_PX, decalLayout } from "./podium-layout.ts";

/** The floating platform's top radius (m): the three blocks and the aprons in front of them stand on it with room to spare. */
const PLATFORM_RADIUS = 11.5;
/** The platform's thickness (m), and the rock cone hanging under it: the stand reads as an island in the air. */
const PLATFORM_THICKNESS = 1.4;
const ROCK_DEPTH = 6;
const ROCK_TIP_RADIUS = 2.6;
/** The backdrop banner's size (m) and how far behind the blocks' back faces it hangs. */
const BANNER_WIDTH = 19;
const BANNER_HEIGHT = 9.5;
const BANNER_BEHIND = 1.4;
/** The two poles' height (m); the bunting runs between their tops and sags this far at the middle. */
const POLE_HEIGHT = 10.4;
const BUNTING_SAG = 1.3;
const FLAGS_PER_STRAND = 22;
const FLAG_SIZE = 0.75;
/** The name plate on the apron in front of each block: its size (m), how far in front of the block, and how far it leans back from upright (rad). */
const PLATE_WIDTH = 3.6;
const PLATE_HEIGHT = 0.7;
const PLATE_AHEAD = 2.7;
const PLATE_LEAN = 0.8;
/** Canvas size (px) of a name plate. */
const PLATE_PX = { w: 1024, h: 240 };
/** The banner's row of stars: how many, and the gap between them (share of the banner's width). */
const BANNER_STARS = 5;
const BANNER_STAR_GAP = 0.085;
/** A face decal fills this much of its block's height. */
const DECAL_SHARE = 0.78;
/** The banner and the plates glow a little of their own colour, so they read at night and in the sun's shadow. */
const GLOW = 0.35;

const GOLD = "#e8b923";
/** A decal is inked dark, not in its block's own metal: silver on a silver block cannot be read. */
const DECAL_INK = "#2a1c05";
const SILVER = "#cfd3da";
const BRONZE = "#c8803f";
const PLACE_PAINT = [GOLD, SILVER, BRONZE] as const;
const PLACE_HEX = [0xe8b923, 0xcfd3da, 0xc8803f] as const;
const INK = "#1a1d26";
const CREAM = "#f6efdc";

const BUNTING_COLOURS = [0xd7263d, 0xf2b705, 0x1b76d2, 0xffffff, 0x2bb673];

function clamped(tex: THREE.CanvasTexture): THREE.CanvasTexture {
  tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
  return tex;
}

/** A trophy cup centred at (`cx`, `cy`), `s` px tall: bowl, two handles, stem and foot. */
function drawCup(ctx: CanvasRenderingContext2D, cx: number, cy: number, s: number, paint: string): void {
  const u = s / 10;
  ctx.fillStyle = paint;
  ctx.strokeStyle = paint;
  ctx.lineWidth = u * 0.7;
  ctx.beginPath();
  ctx.moveTo(cx - 3.2 * u, cy - 5 * u);
  ctx.lineTo(cx + 3.2 * u, cy - 5 * u);
  ctx.bezierCurveTo(cx + 3.2 * u, cy + 1.5 * u, cx + 1.8 * u, cy + 2.5 * u, cx, cy + 2.5 * u);
  ctx.bezierCurveTo(cx - 1.8 * u, cy + 2.5 * u, cx - 3.2 * u, cy + 1.5 * u, cx - 3.2 * u, cy - 5 * u);
  ctx.fill();
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(cx + side * 3.2 * u, cy - 4 * u);
    ctx.bezierCurveTo(cx + side * 6.2 * u, cy - 4.5 * u, cx + side * 5.8 * u, cy + 0.2 * u, cx + side * 2.6 * u, cy + 0.6 * u);
    ctx.stroke();
  }
  ctx.fillRect(cx - 0.45 * u, cy + 2.5 * u, 0.9 * u, 2 * u);
  ctx.fillRect(cx - 2 * u, cy + 4.5 * u, 4 * u, 0.9 * u);
}

/** A block's face decal: a cup either side of the place's numeral, in the place's metal. */
function drawDecal(ctx: CanvasRenderingContext2D, place: number): void {
  const { cupSize, cupY, leftX, rightX, numeralPx } = decalLayout();
  ctx.clearRect(0, 0, DECAL_PX.w, DECAL_PX.h);
  drawCup(ctx, leftX, cupY, cupSize, DECAL_INK);
  drawCup(ctx, rightX, cupY, cupSize, DECAL_INK);
  ctx.fillStyle = DECAL_INK;
  ctx.font = `bold ${numeralPx}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(String(place), DECAL_PX.w / 2, DECAL_PX.h * 0.54);
}

/** A name plate: cream under a metal border, the racer's name in ink, shrunk to fit its width. */
function drawPlate(ctx: CanvasRenderingContext2D, place: number, name: string): void {
  // A dark frame round a metal rim: a silver plate on the pale platform could not be read.
  ctx.fillStyle = INK;
  ctx.fillRect(0, 0, PLATE_PX.w, PLATE_PX.h);
  ctx.fillStyle = PLACE_PAINT[place - 1]!;
  ctx.fillRect(14, 14, PLATE_PX.w - 28, PLATE_PX.h - 28);
  ctx.fillStyle = CREAM;
  ctx.fillRect(30, 30, PLATE_PX.w - 60, PLATE_PX.h - 60);
  ctx.fillStyle = INK;
  ctx.font = `bold ${Math.round(PLATE_PX.h * 0.56)}px sans-serif`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(name, PLATE_PX.w / 2, PLATE_PX.h * 0.54, PLATE_PX.w - 90);
}

/** The banner: a deep blue field with a gold border, a trophy at each end, `title` small above a row of stars (never the word podium: a podium just is one). */
function drawBanner(ctx: CanvasRenderingContext2D, title: string): void {
  const { cupSize, cupY, leftX, rightX } = bannerLayout();
  const g = ctx.createLinearGradient(0, 0, 0, BANNER_PX.h);
  g.addColorStop(0, "#22336b");
  g.addColorStop(1, "#0f1a3d");
  ctx.fillStyle = g;
  ctx.fillRect(0, 0, BANNER_PX.w, BANNER_PX.h);
  ctx.strokeStyle = GOLD;
  ctx.lineWidth = 14;
  ctx.strokeRect(24, 24, BANNER_PX.w - 48, BANNER_PX.h - 48);
  ctx.lineWidth = 4;
  ctx.strokeRect(BANNER_FRAME_PX - 4, BANNER_FRAME_PX - 4, BANNER_PX.w - 2 * (BANNER_FRAME_PX - 4), BANNER_PX.h - 2 * (BANNER_FRAME_PX - 4));
  drawCup(ctx, leftX, cupY, cupSize, GOLD);
  drawCup(ctx, rightX, cupY, cupSize, GOLD);
  ctx.fillStyle = GOLD;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.font = `bold ${Math.round(BANNER_PX.h * 0.11)}px sans-serif`;
  ctx.fillText(title.toUpperCase(), BANNER_PX.w / 2, BANNER_PX.h * 0.22, BANNER_PX.w * 0.45);
  ctx.font = `bold ${Math.round(BANNER_PX.h * 0.3)}px sans-serif`;
  for (let k = 0; k < BANNER_STARS; k++) ctx.fillText("\u2605", BANNER_PX.w * (0.5 + BANNER_STAR_GAP * (k - (BANNER_STARS - 1) / 2)), BANNER_PX.h * 0.52);
}

/** The bunting: `FLAGS_PER_STRAND` hanging triangles along the sagging line from (`x0`, `y0`) to (`x1`, `y0`), at depth `z`, flags coloured in turn. */
function buntingStrand(z: number, x0: number, x1: number, y0: number): THREE.BufferGeometry {
  const positions: number[] = [];
  const colours: number[] = [];
  const c = new THREE.Color();
  const sag = (u: number): number => y0 - BUNTING_SAG * 4 * u * (1 - u);
  for (let k = 0; k < FLAGS_PER_STRAND; k++) {
    const a = k / FLAGS_PER_STRAND;
    const b = (k + 0.8) / FLAGS_PER_STRAND;
    const xa = x0 + (x1 - x0) * a;
    const xb = x0 + (x1 - x0) * b;
    positions.push(xa, sag(a), z, xb, sag(b), z, (xa + xb) / 2, Math.min(sag(a), sag(b)) - FLAG_SIZE, z);
    c.setHex(BUNTING_COLOURS[k % BUNTING_COLOURS.length]!);
    for (let v = 0; v < 3; v++) colours.push(c.r, c.g, c.b);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colours, 3));
  return geo;
}

/** A plane with `tex` on it (transparent where the texture is), `w` × `h` m, facing +z, glowing a little of its own colour. */
function sign(tex: THREE.CanvasTexture, w: number, h: number, transparent: boolean): THREE.Mesh {
  const mat = new THREE.MeshStandardMaterial({ map: tex, emissiveMap: tex, emissive: 0xffffff, emissiveIntensity: GLOW, roughness: 0.7, metalness: 0, transparent, depthWrite: !transparent });
  if (transparent) {
    mat.polygonOffset = true;
    mat.polygonOffsetFactor = -2;
  }
  return new THREE.Mesh(new THREE.PlaneGeometry(w, h), mat);
}

/**
 * The podium's set (docs/PODIUM.md), built once and shown over the course: a floating platform over a rock cone, three blocks (the winner's in the middle, highest; the second's on the viewer's left; the third's
 * on the right, lowest) with a cup either side of the place's numeral on each face, a name plate on the apron in front of each, and a banner between two poles with bunting across it behind them. Its origin is
 * the platform's top at its middle; the blocks face +z. Static: nothing here changes while it is shown, but the names (`setNames`).
 */
export class PodiumStage {
  readonly group = new THREE.Group();
  private readonly plates: THREE.Mesh[] = [];
  private readonly decals: THREE.Mesh[] = [];
  private readonly banner: THREE.Mesh;
  private readonly owned: { dispose(): void }[] = [];

  constructor() {
    const g = this.group;
    g.visible = false;
    const stone = new THREE.MeshStandardMaterial({ color: 0xdad6cc, roughness: 0.8 });
    const rock = new THREE.MeshStandardMaterial({ color: 0x5b5649, roughness: 1, flatShading: true });
    const rim = new THREE.MeshStandardMaterial({ color: GOLD, roughness: 0.35, metalness: 0.8 });
    const pole = new THREE.MeshStandardMaterial({ color: 0xe9e9ee, roughness: 0.4, metalness: 0.6 });
    const platform = new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM_RADIUS, PLATFORM_RADIUS * 0.92, PLATFORM_THICKNESS, 56), stone);
    platform.position.y = -PLATFORM_THICKNESS / 2;
    platform.receiveShadow = true;
    const cone = new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM_RADIUS * 0.92, ROCK_TIP_RADIUS, ROCK_DEPTH, 14, 3), rock);
    cone.position.y = -PLATFORM_THICKNESS - ROCK_DEPTH / 2;
    const edge = new THREE.Mesh(new THREE.CylinderGeometry(PLATFORM_RADIUS + 0.05, PLATFORM_RADIUS + 0.05, 0.22, 56, 1, true), rim);
    edge.position.y = -0.11;
    g.add(platform, cone, edge);
    this.owned.push(stone, rock, rim, pole, platform.geometry, cone.geometry, edge.geometry);

    for (const block of PODIUM_BLOCKS) {
      const paint = PLACE_HEX[block.place - 1]!;
      const body = new THREE.Mesh(new THREE.BoxGeometry(BLOCK_WIDTH, block.top, BLOCK_DEPTH), new THREE.MeshStandardMaterial({ color: paint, roughness: 0.45, metalness: 0.55 }));
      body.position.set(block.x, block.top / 2, 0);
      body.castShadow = true;
      body.receiveShadow = true;
      const decalH = block.top * DECAL_SHARE;
      const decalTex = clamped(canvasTexture(DECAL_PX.w, DECAL_PX.h, (ctx) => drawDecal(ctx, block.place)));
      const decal = sign(decalTex, decalH * (DECAL_PX.w / DECAL_PX.h), decalH, true);
      decal.position.set(block.x, block.top / 2, BLOCK_DEPTH / 2 + 0.02);
      const plateTex = clamped(canvasTexture(PLATE_PX.w, PLATE_PX.h, (ctx) => drawPlate(ctx, block.place, "")));
      const plate = sign(plateTex, PLATE_WIDTH, PLATE_HEIGHT, false);
      plate.position.set(block.x, PLATE_HEIGHT / 2 + 0.1, BLOCK_DEPTH / 2 + PLATE_AHEAD);
      plate.rotation.x = -PLATE_LEAN;
      g.add(body, decal, plate);
      this.plates.push(plate);
      this.decals.push(decal);
      this.owned.push(body.geometry, body.material as THREE.Material, decal.geometry, decal.material as THREE.Material, decalTex, plate.geometry, plate.material as THREE.Material, plateTex);
    }

    const bannerTex = clamped(canvasTexture(BANNER_PX.w, BANNER_PX.h, (ctx) => drawBanner(ctx, "")));
    this.banner = sign(bannerTex, BANNER_WIDTH, BANNER_HEIGHT, false);
    const bannerZ = -BLOCK_DEPTH / 2 - BANNER_BEHIND;
    this.banner.position.set(0, BANNER_HEIGHT / 2 + 0.1, bannerZ);
    g.add(this.banner);
    this.owned.push(this.banner.geometry, this.banner.material as THREE.Material, bannerTex);

    const poleX = BANNER_WIDTH / 2 + 0.3;
    for (const side of [-1, 1]) {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.14, 0.18, POLE_HEIGHT, 10), pole);
      post.position.set(side * poleX, POLE_HEIGHT / 2, bannerZ);
      post.castShadow = true;
      const ball = new THREE.Mesh(new THREE.SphereGeometry(0.3, 12, 8), rim);
      ball.position.set(side * poleX, POLE_HEIGHT + 0.25, bannerZ);
      g.add(post, ball);
      this.owned.push(post.geometry, ball.geometry);
    }
    const bunting = new THREE.Mesh(
      buntingStrand(bannerZ + 0.5, -poleX, poleX, POLE_HEIGHT - 0.3),
      new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.DoubleSide }),
    );
    g.add(bunting);
    this.owned.push(bunting.geometry, bunting.material as THREE.Material);
  }

  /** The racers on the plates (a place with nobody on it loses its plate and decal), and the finish named on the banner. */
  setNames(places: readonly PodiumPlace[], title: string): void {
    for (let k = 0; k < this.plates.length; k++) {
      const racer = places[k];
      this.plates[k]!.visible = racer !== undefined;
      this.decals[k]!.visible = racer !== undefined;
      if (racer) this.redraw(this.plates[k]!, (ctx) => drawPlate(ctx, racer.place, racer.name));
    }
    this.redraw(this.banner, (ctx) => drawBanner(ctx, title));
  }

  private redraw(mesh: THREE.Mesh, draw: (ctx: CanvasRenderingContext2D) => void): void {
    const tex = (mesh.material as THREE.MeshStandardMaterial).map as THREE.CanvasTexture;
    draw((tex.image as HTMLCanvasElement).getContext("2d")!);
    tex.needsUpdate = true;
  }

  dispose(): void {
    this.group.removeFromParent();
    for (const o of this.owned) o.dispose();
  }
}
