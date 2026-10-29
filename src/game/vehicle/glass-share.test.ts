import { describe, expect, test } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";
import { GLASS_COLOR, getCrackMap } from "./car-materials.ts";
import { paint } from "./test-support.ts";

const scene = new THREE.Scene();
const twoCars = () => [new DeformableCar(paint(), scene, null, "sedan"), new DeformableCar(paint(), scene, null, "coupe")] as const;
const materialsOf = (car: DeformableCar): THREE.MeshStandardMaterial[] => car.lookMeshes().glass.map((pane) => pane.material as THREE.MeshStandardMaterial);

describe("given two cars with six panes each", () => {
  test("when they are built, then all twelve panes draw one material", () => {
    const [a, b] = twoCars();
    expect(new Set([...materialsOf(a), ...materialsOf(b)]).size).toBe(1);
  });

  test("when one pane cracks, then only that pane changes material, to the crack map at the cracked opacity and roughness", () => {
    const [a, b] = twoCars();
    const before = materialsOf(a)[0]!;
    expect(a.hitGlass("windshield")).toBe(true);
    const panes = a.lookMeshes().glass.map((pane) => pane.material as THREE.MeshStandardMaterial);
    const cracked = panes.filter((m) => m !== before);
    expect(cracked.length, "one pane left the shared material").toBe(1);
    expect(cracked[0]!.map).toBe(getCrackMap());
    expect(cracked[0]!.opacity, "a cracked pane is hazier").toBeLessThan(before.opacity);
    expect(cracked[0]!.roughness, "and rougher").toBeGreaterThan(before.roughness);
    expect(before.map, "the intact material was not edited").toBe(null);
    expect(materialsOf(b).every((m) => m === before), "the other car's panes are untouched").toBeTruthy();
  });

  test("when a cracked pane is reset, then it draws the cleared pane: no crack map, the reset's opacity and roughness", () => {
    const [a] = twoCars();
    a.hitGlass("rear");
    a.resetVisual();
    const m = materialsOf(a);
    expect(new Set(m).size, "every pane is back on one material").toBe(1);
    expect(m[0]!.map).toBe(null);
    expect(m[0]!.opacity > 0.72 && m[0]!.opacity < 0.9, `${m[0]!.opacity}`).toBeTruthy();
  });

  test("when the player's glass colour is set on one car, then its panes wear it in their own looks and the other car's keep the built colour", () => {
    const [a, b] = twoCars();
    a.hitGlass("windshield");
    a.setGlassTint(0x884400);
    const mine = materialsOf(a);
    expect(mine.every((m) => m.color.getHex() === 0x884400)).toBeTruthy();
    expect(mine.filter((m) => m.map === getCrackMap()).length, "the cracked pane is still cracked").toBe(1);
    expect(materialsOf(b).every((m) => m.color.getHex() === GLASS_COLOR)).toBeTruthy();
  });
});
