import { blankPoint, pointOn, type Track } from "./track.ts";
import { square } from "./track.test-util.ts";

/** `square` (its x = 0 side runs straight along +z) paved in `surface`, 22 m wide, its edges `dish` m over its centre. */
export function dishSquare(dish: number, surface: "asphalt" | "mud" = "asphalt") {
  return square({ road: { width: 22, runoff: [2, 2], surface, dish } });
}

/**
 * A figure-8 of two loops of centreline radius `r` whose strands cross straight through the origin at `deg` (one along +45° off z, one
 * along −45° at 90°), `width` wide, dished `dish`: loops centred at (0, ±D), each strand tangent to both.
 */
export function dishEight(r: number, deg: number, width: number, dish: number) {
  const th = ((deg / 2) * Math.PI) / 180;
  const d = r / Math.sin(th);
  const ls = Math.sqrt(d * d - r * r);
  const [sx, cz] = [Math.sin(th), Math.cos(th)];
  const nodes: { x: number; z: number }[] = [];
  const strand = (x0: number, z0: number, x1: number, z1: number, a: number, b: number) => {
    for (let f = a; f <= b + 1e-9; f += 0.125) if (Math.abs(f - 0.5) > 0.01) nodes.push({ x: x0 + (x1 - x0) * f, z: z0 + (z1 - z0) * f });
  };
  const arc = (c: number, a0: number, a1: number) => {
    const steps = Math.round(Math.abs(a1 - a0) / (Math.PI / 12));
    for (let i = 1; i < steps; i++) nodes.push({ x: r * Math.cos(a0 + ((a1 - a0) * i) / steps), z: c + r * Math.sin(a0 + ((a1 - a0) * i) / steps) });
  };
  strand(0, 0, ls * sx, ls * cz, 0.75, 1);
  const north = nodes.length;
  arc(d, -th, Math.PI + th);
  strand(-ls * sx, ls * cz, ls * sx, -ls * cz, 0, 1);
  const south = nodes.length;
  arc(-d, th, -Math.PI - th);
  strand(-ls * sx, -ls * cz, 0, 0, 0, 0.625);
  return {
    id: "dish-eight",
    name: "Dish Eight",
    road: { width, surface: "mud" as const, runoff: [1, 1] as [number, number], dish },
    nodes,
    checkpoints: [0, north + 6, south + 6].map((node) => ({ node })),
  };
}

/** Where `track`'s ground stands (world y) at lateral `lat` off the main loop's centreline at arc length `s`. */
export function heightAcross(track: Track, s: number, lat: number): number {
  const pt = pointOn(track.path, s, blankPoint());
  return track.ground().heightAt(pt.x + pt.tz * lat, pt.z - pt.tx * lat, pt.y + 2);
}
