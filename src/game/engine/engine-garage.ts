import * as THREE from "three";
import type { SprayTool } from "../hud/hud-store.ts";
import { GARAGE } from "../present/garage-art.ts";
import type { LookData } from "../net/look-codec.ts";
import type { CarPart, PersonPick } from "../match/look-data.ts";
import { EngineShare } from "./engine-share.ts";
import { SPRAY_RADIUS } from "./garage.ts";
import type { SprayTarget } from "./player-looks.ts";
import type { SprayUndo } from "./spray-undo.ts";

/**
 * The garage's controls (its HUD panel) and the player looks netplay carries: the player's own picks and spray, and each
 * peer's look worn on its car and driver (`MSG.look`). Choices live in this page (the picks in its URL, the spray in
 * localStorage) and travel to other players once, when they join.
 */
export abstract class EngineGarage extends EngineShare {
  /** Car part `part` takes colour `colour` (sRGB), or (null) its own again. */
  setCarColour(part: CarPart, colour: number | null): void {
    this.wearPicks({ ...this.looks.mine.car, [part]: colour }, this.looks.mine.person);
    this.looks.savePicks();
  }

  /** The player's driver takes `pick`'s fields. */
  setPersonPick(pick: Partial<PersonPick>): void {
    this.wearPicks(this.looks.mine.car, { ...this.looks.mine.person, ...pick });
    this.looks.savePicks();
  }

  /** The spray can: on or off, its radius (m, clamped to `SPRAY_RADIUS`), its colour (sRGB), Symmetric on or off. */
  setSprayTool(tool: Partial<SprayTool>): void {
    if (!this.garage) return;
    const t = this.garage.tool;
    if (tool.on !== undefined) t.on = tool.on;
    if (tool.radius !== undefined) t.radius = Math.min(SPRAY_RADIUS.max, Math.max(SPRAY_RADIUS.min, tool.radius));
    if (tool.colour !== undefined && Number.isInteger(tool.colour) && tool.colour >= 0 && tool.colour <= 0xffffff) t.colour = tool.colour;
    if (tool.mirror !== undefined) t.mirror = tool.mirror;
    this.emitHud();
  }

  /**
   * The panel's Edit pick: the can paints only `target` (`Garage.editing`), and the camera frames it: the driver close up (the orbit
   * circles his chest as he is posed), or the car and the driver beside it. The orbit keeps that centre (`aimRigs`).
   */
  frameGarage(target: SprayTarget): void {
    if (!this.showGarage || !this.garage) return;
    this.garage.editing = target;
    this.emitHud();
    if (target === "car") {
      this.view.frameReset(true, this.live(), GARAGE.angle, GARAGE.shot);
      return;
    }
    const chest = this.garage.art.dummy.partPoint(0, 0, GARAGE.chest, new THREE.Vector3());
    this.view.frameReset(true, this.live(), GARAGE.angle, { ...GARAGE.driverShot, lookX: chest.x, lookY: chest.y, lookZ: chest.z });
  }

  /** `target`'s spray comes off, here and in storage: one step to undo, as a stroke is. */
  clearSpray(target: SprayTarget): void {
    const strokes = this.garage?.strokes(target);
    strokes?.begin();
    this.looks.sprayOf(target).load(null);
    strokes?.commit();
    this.looks.save(target);
    this.restyle();
  }

  /** The last stroke (or clear) on what the panel edits taken back, saved and drawn as a stroke is. */
  undoSpray(): void {
    this.stepSpray((strokes) => strokes.undo());
  }

  /** The last stroke undone on what the panel edits made again. */
  redoSpray(): void {
    this.stepSpray((strokes) => strokes.redo());
  }

  private stepSpray(step: (strokes: SprayUndo) => boolean): void {
    if (!this.garage) return;
    const target = this.garage.editing;
    if (!step(this.garage.strokes(target))) return;
    this.looks.save(target);
    this.restyle();
  }

  protected playerLook(): LookData {
    return this.looks.data();
  }

  protected wearLook(i: number, look: LookData | null): void {
    this.looks.wear(i, look);
    const car = this.cars[i];
    if (car) this.dressCar(car);
  }

  protected dropLooks(): void {
    const peers = [...this.looks.peerCars()];
    this.looks.drop();
    for (const i of peers) {
      const car = this.cars[i];
      if (car) this.dressCar(car);
    }
  }
}
