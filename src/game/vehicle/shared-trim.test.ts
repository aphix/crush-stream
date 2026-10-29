import { describe, expect, it } from "vitest";
import * as THREE from "three";
import { DeformableCar } from "./car.ts";

/** A sedan in `body` paint: its bumpers are body-colour trim (as its reference's), so the accent never matters to them. */
const sedanIn = (body: number, accent: number): DeformableCar => new DeformableCar({ name: "Test", body, accent }, new THREE.Scene(), null, "sedan");

/** The material on the front and rear bumper meshes. */
const bumperMaterials = (car: DeformableCar): THREE.Material[] => [car["bumperF"], car["bumperR"]].map((bumper) => (bumper.children[0] as THREE.Mesh).material as THREE.Material);

describe("given cars wearing body-colour bumper trim", () => {
  it("when two cars share a body colour, then all four of their bumpers draw with one material", () => {
    const a = sedanIn(0x445566, 0x111111);
    const b = sedanIn(0x445566, 0x222222);
    expect(new Set([...bumperMaterials(a), ...bumperMaterials(b)]).size).toBe(1);
    a.dispose();
    b.dispose();
  });

  it("when two cars have different body colours, then their bumpers keep their own colour", () => {
    const a = sedanIn(0x445566, 0x111111);
    const b = sedanIn(0x665544, 0x111111);
    const [trimA] = bumperMaterials(a) as THREE.MeshStandardMaterial[];
    const [trimB] = bumperMaterials(b) as THREE.MeshStandardMaterial[];
    expect(trimA).not.toBe(trimB);
    expect(trimA!.color.getHex()).toBe(new THREE.Color(0x445566).getHex());
    expect(trimB!.color.getHex()).toBe(new THREE.Color(0x665544).getHex());
    a.dispose();
    b.dispose();
  });

  it("when one car of a body colour is removed, then the trim the other cars still wear is not freed", () => {
    const gone = sedanIn(0x556677, 0x111111);
    const stays = sedanIn(0x556677, 0x222222);
    let freed = 0;
    for (const m of bumperMaterials(stays)) m.addEventListener("dispose", () => freed++);
    gone.dispose();
    expect(freed).toBe(0);
    stays.dispose();
  });
});
