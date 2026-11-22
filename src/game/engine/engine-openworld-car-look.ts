import type { LookRay, LookText, Meeting } from "../ai/civilians/civilian-look.ts";
import type { CityState } from "../ai/civilians/civilian-state.ts";
import { hourOfDay } from "../ai/civilians/civilian-clock.ts";
import { NO_PLACE, RESIDENT_INT, RESIDENT_INT_STRIDE, TICKS_PER_GAME_HOUR, TICKS_PER_GAME_MINUTE } from "../ai/civilians/civilian-constants.ts";
import { residentNameText } from "../ai/civilians/civilian-mood.ts";
import { residentColour } from "../ai/openworld-traffic/traffic-look.ts";
import { AMBULANCE_COLOUR } from "../ai/openworld-traffic/traffic-constants.ts";
import type { BodyStyle, CarStyleId } from "../vehicle/car-variants.ts";

/** A car moving faster than this (m/s) is driving, not parked. */
const MOVING_SPEED = 1;
/** Condition words by the car's damage arc (`car-view.ts` carDamage: 1 untouched): at or over each bar, its word. */
const CONDITION = [
  { from: 0.98, word: "not a scratch" },
  { from: 0.8, word: "scuffed" },
  { from: 0.5, word: "dented" },
  { from: 0, word: "badly smashed" },
] as const;
const WHEELS = 4;

const STYLE_WORDS: Readonly<Record<CarStyleId, string>> = {
  sedan: "sedan",
  hatchback: "hatchback",
  wagon: "station wagon",
  coupe: "coupe",
  pickup: "pickup truck",
  police: "police cruiser",
  monster: "monster truck",
};

/** Paint colours by name: the residents' car paints (`RESIDENT_CAR_COLOURS`) and the race field's brighter ones; a paint is named by the nearest in sRGB. */
const COLOUR_NAMES: readonly { hex: number; word: string }[] = [
  { hex: 0x8a8d91, word: "grey" },
  { hex: 0xc4c7cc, word: "silver" },
  { hex: 0x1d1f23, word: "black" },
  { hex: 0xf0f0ee, word: "white" },
  { hex: 0x7b1e24, word: "maroon" },
  { hex: 0xc42a2a, word: "red" },
  { hex: 0x24406e, word: "navy" },
  { hex: 0x2f6fd6, word: "blue" },
  { hex: 0x2f5d3b, word: "green" },
  { hex: 0x6e5a3c, word: "brown" },
  { hex: 0x55606e, word: "slate" },
  { hex: 0xe6c229, word: "yellow" },
  { hex: 0xe67e22, word: "orange" },
];

/** What the panel reads of a car (a `DeformableCar` is one). */
export type LookCar = {
  stored: boolean;
  crashed: boolean;
  yaw: number;
  group: { visible: boolean; position: { x: number; y: number; z: number } };
  style: Pick<BodyStyle, "id" | "dims">;
  velocity: { x: number; z: number };
  paint: { body: number };
  deform: { drivetrainHealth: number; wheelsOn: number };
};

/** What the panel needs of the open world's cars: the field's cars, which ones are players', which one the camera rides, and the traffic (null on a client, which has none). */
export type CarLookWorld = {
  cars(): readonly LookCar[];
  playerCars(): readonly object[];
  followed(): object | null;
  inRoom(): boolean;
  traffic(): CarLookTraffic | null;
};

/** The traffic's answers the panel reads. */
export type CarLookTraffic = { ownerOf(carIndex: number): number; isEmptyCar(carIndex: number): boolean; ambulanceCar(): number };

/** The name of the paint nearest `hex` (sRGB). */
export function colourWord(hex: number): string {
  let best = COLOUR_NAMES[0]!.word;
  let bestGap = Infinity;
  for (let at = 0; at < COLOUR_NAMES.length; at++) {
    const named = COLOUR_NAMES[at]!.hex;
    const dr = ((hex >> 16) & 0xff) - ((named >> 16) & 0xff);
    const dg = ((hex >> 8) & 0xff) - ((named >> 8) & 0xff);
    const db = (hex & 0xff) - (named & 0xff);
    const gap = dr * dr + dg * dg + db * db;
    if (gap >= bestGap) continue;
    bestGap = gap;
    best = COLOUR_NAMES[at]!.word;
  }
  return best;
}

/** The car's state in words: wrecked, else by its damage arc, and its lost wheels. */
export function conditionWords(car: Pick<LookCar, "crashed" | "deform">): string {
  const wheelsOff = WHEELS - car.deform.wheelsOn;
  const lost = wheelsOff > 0 ? `, ${wheelsOff} wheel${wheelsOff > 1 ? "s" : ""} off` : "";
  if (car.crashed) return `wrecked${lost}`;
  const arc = Math.min(car.deform.drivetrainHealth, car.deform.wheelsOn / WHEELS);
  return `${(CONDITION.find((bar) => arc >= bar.from) ?? CONDITION[CONDITION.length - 1]).word}${lost}`;
}

/** The game clock at `tick` as HH:MM. */
function clockText(tick: number, startHour: number): string {
  const minute = Math.floor((((tick + startHour * TICKS_PER_GAME_HOUR) % TICKS_PER_GAME_HOUR) + TICKS_PER_GAME_HOUR) % TICKS_PER_GAME_HOUR / TICKS_PER_GAME_MINUTE);
  return `${String(hourOfDay(tick, startHour)).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

function placeName(state: CityState, place: number): string {
  return place === NO_PLACE ? "the street" : (state.map.places[place]?.name ?? "the street");
}

/** Where resident `owner`'s car is by his row at `tick`: parked by a place (since when, and where it leaves for next), or on its way. */
function whereLine(state: CityState, owner: number, tick: number, moving: boolean): string {
  const base = owner * RESIDENT_INT_STRIDE;
  const { ints } = state;
  const to = ints[base + RESIDENT_INT.carTo]!;
  const leave = ints[base + RESIDENT_INT.carLeaveTick]!;
  const park = ints[base + RESIDENT_INT.carParkTick]!;
  if (moving || (to !== NO_PLACE && tick >= leave && tick < park)) return `driving to ${placeName(state, to !== NO_PLACE ? to : ints[base + RESIDENT_INT.place]!)}`;
  if (to !== NO_PLACE && tick >= park) return `parked by ${placeName(state, to)} since ${clockText(park, state.startHour)}`;
  const parked = `parked by ${placeName(state, ints[base + RESIDENT_INT.carPlace]!)}`;
  return to !== NO_PLACE && tick < leave ? `${parked}, leaving for ${placeName(state, to)} at ${clockText(leave, state.startHour)}` : parked;
}

/**
 * The look-at panel's car: the first car the eye's ray enters (`met`), and its name, body and paint, whose it is, where it is parked or going, whether the player can get in and its damage, in words (`text`, at the
 * panel's 4 Hz). The car the camera rides is never met: the ray starts behind it.
 */
export class CarLook {
  private readonly world: CarLookWorld;

  constructor(world: CarLookWorld) {
    this.world = world;
  }

  /** The nearest car the ray enters within `reach` m, into `out` (index -1, along `reach`: none): the slab test in the car's own frame, ground to roof. Allocates nothing. */
  met(ray: LookRay, reach: number, out: Meeting): Meeting {
    out.index = -1;
    out.along = reach;
    const cars = this.world.cars();
    const followed = this.world.followed();
    for (let index = 0; index < cars.length; index++) {
      const car = cars[index]!;
      if (car.stored || !car.group.visible || car === followed) continue;
      const along = rayIntoCar(car, ray);
      if (along < 0 || along >= out.along) continue;
      out.index = index;
      out.along = along;
    }
    return out;
  }

  /** The panel's text for car `index` at crowd tick `tick`; `state` names its owner and places (null: a crowd not yet made). */
  text(index: number, state: CityState | null, tick: number): LookText {
    const car = this.world.cars()[index]!;
    const traffic = this.world.traffic();
    const moving = Math.hypot(car.velocity.x, car.velocity.z) > MOVING_SPEED;
    const player = this.world.playerCars().includes(car);
    const ambulance = traffic !== null && traffic.ambulanceCar() === index;
    const patrol = !ambulance && car.style.id === "police";
    const leased = player || traffic === null || state === null ? -1 : traffic.ownerOf(index);
    // A housemate driving the owner's car names the owner on his leg (`carOwner`).
    const ownerOnLeg = leased >= 0 && state !== null ? state.ints[leased * RESIDENT_INT_STRIDE + RESIDENT_INT.carOwner]! : NO_PLACE;
    const owner = ownerOnLeg !== NO_PLACE ? ownerOnLeg : leased;
    const lines: string[] = [];
    const paint = ambulance ? AMBULANCE_COLOUR : owner >= 0 ? residentColour(owner) : car.paint.body;
    lines.push(patrol ? "black-and-white police cruiser" : `${colourWord(paint)} ${STYLE_WORDS[car.style.id]}`);
    if (owner >= 0 && state !== null) lines.push(whereLine(state, owner, tick, moving));
    else lines.push(moving ? "on the move" : "parked");
    if (traffic !== null && !player) lines.push(traffic.isEmptyCar(index) ? "doors: unlocked" : moving ? "doors: someone at the wheel" : "doors: locked");
    lines.push(`condition: ${conditionWords(car)}`);
    return { title: titleOf(player, this.world.inRoom(), ambulance, patrol, owner, state, moving), lines };
  }
}

function titleOf(player: boolean, inRoom: boolean, ambulance: boolean, patrol: boolean, owner: number, state: CityState | null, moving: boolean): string {
  if (player) return inRoom ? "A player's car" : "Your car";
  if (ambulance) return "Ambulance";
  if (patrol) return "Patrol car";
  if (owner >= 0 && state !== null) return `${residentNameText(state, owner)}'s car`;
  return moving ? "A car" : "A parked car";
}

/** How far along the ray (m) it enters car `car`'s box (ground to roof, bumper to bumper, side to side, in the car's own frame), -1 when it misses or the box is behind the eye. */
function rayIntoCar(car: LookCar, ray: LookRay): number {
  const { dims } = car.style;
  const cos = Math.cos(car.yaw);
  const sin = Math.sin(car.yaw);
  const ox = ray.eyeX - car.group.position.x;
  const oz = ray.eyeZ - car.group.position.z;
  let near = 0;
  let far = Infinity;
  // The car's frame turns world (x, z) by -yaw about y (three's Ry): local x across, local z forward.
  const halfWidth = dims.width / 2;
  const slabs = 3;
  for (let axis = 0; axis < slabs; axis++) {
    const origin = axis === 0 ? ox * cos - oz * sin : axis === 1 ? ray.eyeY - car.group.position.y : ox * sin + oz * cos;
    const direction = axis === 0 ? ray.dirX * cos - ray.dirZ * sin : axis === 1 ? ray.dirY : ray.dirX * sin + ray.dirZ * cos;
    const low = axis === 0 ? -halfWidth : axis === 1 ? 0 : -(dims.wheelbase / 2 + dims.overhang.rear);
    const high = axis === 0 ? halfWidth : axis === 1 ? dims.height : dims.wheelbase / 2 + dims.overhang.front;
    if (direction === 0) {
      if (origin < low || origin > high) return -1;
      continue;
    }
    const first = (low - origin) / direction;
    const second = (high - origin) / direction;
    near = Math.max(near, Math.min(first, second));
    far = Math.min(far, Math.max(first, second));
    if (near > far) return -1;
  }
  return near;
}
