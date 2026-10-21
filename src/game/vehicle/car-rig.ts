/**
 * A body style's sim frame: where its wheels stand and how big its tyres are, read off its spec dimensions (`BodyStyle.dims`).
 * One frame per style, built once.
 */
import type { BodyStyle } from "./car-variants.ts";

type V3 = readonly [number, number, number];

export interface CarFrame {
  /** Hub rests (car-local m) in FL, FR, RL, RR order: the tyre's centre over its contact patch. */
  readonly wheels: readonly V3[];
  /** Half the wheelbase and half the track (m). */
  readonly halfBase: number;
  readonly halfTrack: number;
}

const frames = new WeakMap<BodyStyle, CarFrame>();

function buildFrame(style: BodyStyle): CarFrame {
  const { wheelbase, track, wheel } = style.dims;
  const halfBase = wheelbase / 2;
  const halfTrack = track / 2;
  return {
    wheels: [
      [-halfTrack, wheel.radius, halfBase],
      [halfTrack, wheel.radius, halfBase],
      [-halfTrack, wheel.radius, -halfBase],
      [halfTrack, wheel.radius, -halfBase],
    ],
    halfBase,
    halfTrack,
  };
}

export function carFrame(style: BodyStyle): CarFrame {
  let f = frames.get(style);
  if (!f) frames.set(style, (f = buildFrame(style)));
  return f;
}
