import type { PlaceKind } from "../../world/openworld/walk-graph.ts";
import { CAST, type CastMember } from "./civilian-cast.ts";
import { ANGRY_HOLD_TICKS, CAST_NAME_BASE, CAST_TITLE_BASE, GENDER, MOOD_HOLD_TICKS, STATIC_HOLD_TICKS } from "./civilian-constants.ts";
import { LEG_PURPOSES, LOG_EVENTS, MOODS, NEEDS, codesOf } from "./resident-spine.ts";

/** Names a present-day city's residents are drawn from (the reference's lists, dressed for today). */
export const FEMALE_NAMES = [
  "Aaliyah", "Alma", "Amara", "Ana", "Bianca", "Camila", "Carmen", "Chloe", "Dana", "Deja", "Elena", "Emma", "Farah", "Gabriela", "Grace", "Hana",
  "Imani", "Isabel", "Jada", "Jasmine", "Keisha", "Lena", "Lucia", "Maya", "Mei", "Nadia", "Naomi", "Nia", "Olivia", "Priya", "Rosa", "Sade",
  "Sofia", "Tamika", "Tasha", "Valentina", "Yara", "Zoe", "Ines", "June",
] as const;
export const MALE_NAMES = [
  "Andre", "Ben", "Carlos", "Darius", "Diego", "Eli", "Emeka", "Felix", "Gabriel", "Hassan", "Hector", "Isaiah", "Jamal", "Javier", "Jin", "Kareem",
  "Kofi", "Leo", "Luis", "Malik", "Marcus", "Mateo", "Miguel", "Mohamed", "Nico", "Omar", "Pedro", "Rafael", "Ravi", "Reggie", "Sam", "Santiago",
  "Terrell", "Theo", "Tomas", "Tyrone", "Vince", "Wei", "Xavier", "Zane",
] as const;
export const FAMILY_NAMES = [
  "Alvarez", "Baker", "Banks", "Bell", "Brooks", "Castillo", "Chen", "Coleman", "Cruz", "Diaz", "Dupont", "Edwards", "Flores", "Foster", "Garcia",
  "Gibson", "Gonzalez", "Grant", "Hayes", "Herrera", "Hughes", "Ibrahim", "Jackson", "Jenkins", "Kim", "Kowalski", "Lee", "Lopez", "Mack", "Martin",
  "Mendez", "Mitchell", "Morales", "Murphy", "Nguyen", "Okafor", "Ortiz", "Owens", "Patel", "Perez", "Price", "Ramos", "Reyes", "Rivera", "Robinson",
  "Russo", "Santos", "Shah", "Silva", "Singh", "Smith", "Sullivan", "Tanaka", "Torres", "Vargas", "Walker", "Washington", "Wong", "Young", "Zhang",
] as const;

/** A name that is none (an animal has no family name). */
export const NAME_NONE = 32767;
const NAME_BITS = 15;
const NAME_MASK = (1 << NAME_BITS) - 1;

/** A resident's name as one integer that a life log can keep after the slot is lived in by someone else: gender, first and family name indices. */
export function packName(gender: number, firstName: number, familyName: number): number {
  return (gender << (2 * NAME_BITS)) | (firstName << NAME_BITS) | familyName;
}

function firstNameText(gender: number, firstName: number): string {
  if (firstName >= CAST_NAME_BASE) return CAST[firstName - CAST_NAME_BASE]!.first;
  return (gender === GENDER.female ? FEMALE_NAMES : MALE_NAMES)[firstName]!;
}

export function fullNameText(gender: number, firstName: number, familyName: number): string {
  const first = firstNameText(gender, firstName);
  if (familyName === NAME_NONE) return first;
  return `${first} ${familyName >= CAST_NAME_BASE ? CAST[familyName - CAST_NAME_BASE]!.family : FAMILY_NAMES[familyName]!}`;
}

export function packedNameText(packed: number): string {
  return fullNameText(packed >> (2 * NAME_BITS), (packed >> NAME_BITS) & NAME_MASK, packed & NAME_MASK);
}

/** Job titles from junior to senior (a promotion is one step up) by the sector a place names; a place of another sector gets its kind's. */
const TITLES_BY_SECTOR: Readonly<Record<string, readonly string[]>> = {
  Commercial: ["Cashier", "Clerk", "Sales Associate", "Shift Lead", "Store Manager"],
  Food: ["Dishwasher", "Line Cook", "Cook", "Sous Chef", "Chef"],
  Office: ["Intern", "Receptionist", "Analyst", "Account Manager", "Director"],
  Industrial: ["Loader", "Worker", "Electrician", "Foreman", "Plant Manager"],
  Storage: ["Attendant", "Valet", "Clerk", "Supervisor", "Garage Manager"],
  Transport: ["Fare Collector", "Driver", "Dispatcher", "Inspector", "Station Master"],
  Fitness: ["Front Desk", "Trainer", "Senior Trainer", "Coach", "Gym Manager"],
  Nightlife: ["Barback", "Bartender", "Bouncer", "Head Bartender", "Bar Owner"],
};
const TITLES_BY_KIND: readonly (readonly string[])[] = [
  ["Housekeeper"],
  TITLES_BY_SECTOR.Office!,
  TITLES_BY_SECTOR.Food!,
  TITLES_BY_SECTOR.Commercial!,
  TITLES_BY_SECTOR.Nightlife!,
  ["Watchman"],
  TITLES_BY_SECTOR.Transport!,
];

export function jobTitlesOf(kind: PlaceKind, sector: string): readonly string[] {
  return TITLES_BY_SECTOR[sector] ?? TITLES_BY_KIND[kind]!;
}

/** A job title index at or over `CAST_TITLE_BASE` names a cast member's own title. */
export function jobTitleText(kind: PlaceKind, sector: string, title: number): string {
  if (title >= CAST_TITLE_BASE) return CAST[title - CAST_TITLE_BASE]!.title ?? "";
  const titles = jobTitlesOf(kind, sector);
  return titles[Math.min(title, titles.length - 1)]!;
}

export function castTitleIndex(member: CastMember): number {
  return CAST_TITLE_BASE + CAST.indexOf(member);
}

export const MOOD = codesOf(MOODS);
/** The mood words by mood number: the names of `MOOD` in its order. */
export const MOOD_WORDS: readonly string[] = Object.keys(MOODS);
/** The mood of the need that is over `MOOD_NEED_LEVEL` (NEED order). */
export const NEED_MOODS: readonly number[] = Object.values(NEEDS).map((row) => row.urge);

/** What a place's kind is called in a building's line (PLACE_KIND order). */
export const KIND_WORDS = ["home", "workplace", "eatery", "shop", "hangout", "hiding place", "bus stop"] as const;
export const KIND_COUNT = KIND_WORDS.length;

/** The codes of the life log lines and of the events that colour a mood. Codes from `VISIT_BASE` are walks: the base plus the purpose. */
export const EVENT_CODE = codesOf(LOG_EVENTS);
export const VISIT_BASE = Object.keys(LOG_EVENTS).length;

/** Mood each event leaves (EVENT_CODE order). */
const EVENT_MOODS: readonly number[] = Object.values(LOG_EVENTS).map((row) => row.mood);

/** What a walk is for, in the look-at line ("{label} -> {place}"), by purpose: the needs first, then the stories and the bus. */
export const PURPOSE_LABELS: readonly string[] = LEG_PURPOSES.map((row) => row.label);
/** The line a walk leaves in the life log, by purpose; the place follows. */
export const PURPOSE_LOG_TEXT: readonly string[] = LEG_PURPOSES.map((row) => row.log);
/** The mood a story's walk leaves, or -1 for none (needs: -1). */
export const PURPOSE_MOODS: readonly number[] = LEG_PURPOSES.map((row) => row.mood);

/** What the look-at line says of someone in their car: "driving for {purpose}". */
export const DRIVING_WORD = "driving";

/** The mood an event leaves (-1 for none), and for how long it holds (a wrecked stoop angers a family for days; the midnight radio's static only that night). */
export function moodOfCode(code: number): number {
  return code >= VISIT_BASE ? PURPOSE_MOODS[code - VISIT_BASE]! : EVENT_MOODS[code]!;
}

export function moodHold(code: number): number {
  if (code === EVENT_CODE.stoopWrecked) return ANGRY_HOLD_TICKS;
  return code === EVENT_CODE.staticComplaint ? STATIC_HOLD_TICKS : MOOD_HOLD_TICKS;
}
