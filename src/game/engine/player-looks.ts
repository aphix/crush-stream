import type { LookData } from "../net/look-codec.ts";
import { carPickText, CAR_SPRAY, NO_CAR_PICK, NO_PERSON_PICK, packSpray, parseCarPick, parsePersonPick, PERSON_SPRAY, personPickText, unpackSpray, type CarPick, type PersonPick, type SprayPaint } from "../match/look-data.ts";
import { SprayBitmap } from "../present/spray.ts";

/** A player's look as worn: the picks and both spray bitmaps, drawn. */
type PlayerLook = { car: CarPick; person: PersonPick; carSpray: SprayBitmap; personSpray: SprayBitmap };

/** Where this browser keeps its look between visits: the spray as bytes, the picks as their URL text (a link that names picks overrides them for its visit). */
const SPRAY_KEY = { car: "crush.spray.car", person: "crush.spray.person" } as const;
const PICK_KEY = { car: "crush.look.car", person: "crush.look.person" } as const;
export type SprayTarget = keyof typeof SPRAY_KEY;

/** A kept spray for a bitmap `side` texels square: as saved, or a save from when the side was half this (128), each texel doubled 2 x 2; null when it is neither. */
function savedSpray(bytes: Uint8Array, side: number): SprayPaint | null {
  const paint = unpackSpray(bytes, side * side);
  if (paint) return paint;
  const half = side / 2;
  const old = unpackSpray(bytes, half * half);
  if (!old) return null;
  const texels = new Uint8Array(side * side);
  for (let y = 0; y < side; y++) for (let x = 0; x < side; x++) texels[y * side + x] = old.texels[(y >> 1) * half + (x >> 1)]!;
  return { texels, palette: old.palette };
}

/**
 * Every player's look this browser draws: its own (`mine`: picked in the garage, the spray kept in localStorage) and each
 * netplay peer's, by car (`MSG.look`).
 */
export class PlayerLooks {
  readonly mine: PlayerLook = { car: { ...NO_CAR_PICK }, person: { ...NO_PERSON_PICK }, carSpray: new SprayBitmap(CAR_SPRAY), personSpray: new SprayBitmap(PERSON_SPRAY) };
  private readonly theirs = new Map<number, PlayerLook>();

  constructor() {
    if (typeof localStorage === "undefined") return;
    this.mine.car = parseCarPick(localStorage.getItem(PICK_KEY.car) ?? "") ?? this.mine.car;
    this.mine.person = parsePersonPick(localStorage.getItem(PICK_KEY.person) ?? "") ?? this.mine.person;
    for (const target of ["car", "person"] as const) {
      const text = localStorage.getItem(SPRAY_KEY[target]);
      if (text === null) continue;
      const bitmap = this.sprayOf(target);
      bitmap.load(savedSpray(Uint8Array.from(atob(text), (c) => c.charCodeAt(0)), bitmap.layout.w));
    }
  }

  /** Keep the player's own picks for the next visit. */
  savePicks(): void {
    localStorage.setItem(PICK_KEY.car, carPickText(this.mine.car));
    localStorage.setItem(PICK_KEY.person, personPickText(this.mine.person));
  }

  sprayOf(target: SprayTarget): SprayBitmap {
    return target === "car" ? this.mine.carSpray : this.mine.personSpray;
  }

  /** The look car `car` wears: this browser's on its own car `own`, else a peer's, else none. */
  of(car: number, own: number): PlayerLook | null {
    return car === own ? this.mine : (this.theirs.get(car) ?? null);
  }

  /** Car `car` takes a peer's look, or (null) none. */
  wear(car: number, look: LookData | null): void {
    this.drop(car);
    if (!look) return;
    const worn: PlayerLook = { car: look.car, person: look.person, carSpray: new SprayBitmap(CAR_SPRAY, true), personSpray: new SprayBitmap(PERSON_SPRAY) };
    worn.carSpray.load(look.carSpray);
    worn.personSpray.load(look.personSpray);
    this.theirs.set(car, worn);
  }

  /** Car `car`'s peer look off (every one when `car` is omitted), its bitmaps freed. */
  drop(car?: number): void {
    for (const [k, look] of this.theirs) {
      if (car !== undefined && k !== car) continue;
      look.carSpray.dispose();
      look.personSpray.dispose();
      this.theirs.delete(k);
    }
  }

  /** The cars wearing a peer's look. */
  peerCars(): IterableIterator<number> {
    return this.theirs.keys();
  }

  /** This browser's look as `MSG.look` carries it. */
  data(): LookData {
    return { car: this.mine.car, person: this.mine.person, carSpray: this.mine.carSpray, personSpray: this.mine.personSpray };
  }

  /** Keep `target`'s spray for the next visit. */
  save(target: SprayTarget): void {
    const bytes = packSpray(this.sprayOf(target));
    let text = "";
    for (let i = 0; i < bytes.length; i++) text += String.fromCharCode(bytes[i]!);
    localStorage.setItem(SPRAY_KEY[target], btoa(text));
  }

  dispose(): void {
    this.drop();
    this.mine.carSpray.dispose();
    this.mine.personSpray.dispose();
  }
}
