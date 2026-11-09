/**
 * The open world's street kit (`present/prefabs-street.ts` draws each): the box (m) each stands in, along its front (x, toward the street), up, and across (z, along the curb).
 * A shelter and a café set are shallow enough for the 1.2 m furniture strip; a bike rack holds one bicycle.
 */
export const STREET_KIT = {
  bench: [0.6, 0.9, 1.6],
  bikeRack: [0.8, 1.15, 1.8],
  litterBin: [0.52, 0.95, 0.52],
  parkingMeter: [0.24, 1.4, 0.24],
  hydrant: [0.46, 0.8, 0.46],
  cafeSet: [1.1, 2.25, 1.7],
  busShelter: [1.1, 2.6, 4.4],
  busStopSign: [0.4, 2.7, 0.4],
  streetSign: [0.95, 3, 0.95],
  bollard: [0.3, 0.95, 0.3],
  cellarDoor: [1, 0.2, 1.1],
  hoopFence: [0.06, 0.45, 4],
  pavilion: [5.8, 4.1, 5.8],
} as const satisfies Record<string, readonly [number, number, number]>;

/** A street sign's placement names its two streets in its `style`: the one its blade along x shows, then the one along z. */
const STREET_SIGN_SEPARATOR = "|";

export function streetSignStyle(alongX: string, alongZ: string): string {
  return `${alongX}${STREET_SIGN_SEPARATOR}${alongZ}`;
}

/** The two street names a street sign's `style` carries (along x, along z), null when it names no two. */
export function streetSignNames(style: string | undefined): readonly [string, string] | null {
  const names = style?.split(STREET_SIGN_SEPARATOR) ?? [];
  return names.length === 2 && names[0]! !== "" && names[1]! !== "" ? [names[0]!, names[1]!] : null;
}
