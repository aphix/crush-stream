import type { PlaceKind } from "../../world/openworld/walk-graph.ts";
import { CAST, type CastMember } from "./civilian-cast.ts";
import { CAST_NAME_BASE, CAST_TITLE_BASE, GENDER } from "./civilian-constants.ts";

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

export function firstNameText(gender: number, firstName: number): string {
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

export const MOOD = { fine: 0, happy: 1, proud: 2, sad: 3, busy: 4, exhausted: 5, hurt: 6, afraid: 7, hungry: 8, lonely: 9, restless: 10, angry: 11, annoyed: 12, worried: 13 } as const;
export const MOOD_WORDS = ["fine", "happy", "proud", "sad", "busy", "exhausted", "hurt", "afraid", "hungry", "lonely", "restless", "angry", "annoyed", "worried"] as const;
/** The mood of the need that is over `MOOD_NEED_LEVEL` (NEED order). */
export const NEED_MOODS = [MOOD.exhausted, MOOD.hungry, MOOD.restless, MOOD.lonely, MOOD.busy, MOOD.restless] as const;

/** What a place's kind is called in a building's line (PLACE_KIND order). */
export const KIND_WORDS = ["home", "workplace", "eatery", "shop", "hangout", "hideout", "bus stop"] as const;
export const KIND_COUNT = KIND_WORDS.length;

/** The codes of the life log lines and of the events that colour a mood. Codes from `VISIT_BASE` are walks: the base plus the purpose. */
export const EVENT_CODE = {
  none: 0,
  arrived: 1,
  born: 2,
  gotJob: 3,
  retired: 4,
  fired: 5,
  promoted: 6,
  relationship: 7,
  breakup: 8,
  married: 9,
  baby: 10,
  moved: 11,
  injured: 12,
  cured: 13,
  knocked: 14,
  backFromHospital: 15,
  workplaceClosed: 16,
  workplaceReopened: 17,
  lostSomeone: 18,
  familyKnocked: 19,
  stoopWrecked: 20,
  staticComplaint: 21,
  backOnBus: 22,
} as const;
export const VISIT_BASE = 23;

/** Mood each event leaves (EVENT_CODE order). */
export const EVENT_MOODS = [
  MOOD.fine, MOOD.happy, MOOD.happy, MOOD.proud, MOOD.fine, MOOD.sad, MOOD.proud, MOOD.busy, MOOD.sad, MOOD.happy, MOOD.exhausted, MOOD.happy, MOOD.hurt, MOOD.happy,
  MOOD.hurt, MOOD.happy, MOOD.sad, MOOD.happy, MOOD.sad, MOOD.sad, MOOD.angry, MOOD.annoyed,
] as const;

/** What a walk is for, in the look-at line ("{label} -> {place}"), by purpose: the five needs first, then the stories and the bus. */
export const PURPOSE_LABELS = [
  "rest",
  "food",
  "work",
  "company",
  "an errand",
  "some quiet",
  "feeding the pigeons",
  "chasing the cat off with a broom",
  "stealing fish",
  "looking for Pepper",
  "coffee before the broadcast",
  "the Friday party",
  "fixing the van",
  "a run",
  "chasing the cats",
  "looking at the wreck",
  "the Friday party",
  "the bus",
] as const;
/** The line a walk leaves in the life log, by purpose; the place follows. */
export const PURPOSE_LOG_TEXT = [
  "went home to rest at",
  "went to eat at",
  "started a shift at",
  "went out for company at",
  "ran an errand at",
  "went off alone to",
  "fed the pigeons at",
  "went after Biscuit with a broom at",
  "stole fish from",
  "put up flyers for Pepper around",
  "walked to the bodega for coffee at",
  "went to the Friday party at",
  "went to fix the van, again, at",
  "ran across",
  "chased the tabby gang across",
  "came out to look at the wreck at",
  "went up to the Friday party at",
  "took the bus from",
] as const;
/** The mood a story's walk leaves, or -1 for none (needs: -1). */
export const PURPOSE_MOODS = [-1, -1, -1, -1, -1, -1, MOOD.happy, MOOD.angry, MOOD.hungry, MOOD.worried, MOOD.restless, MOOD.happy, MOOD.restless, MOOD.happy, MOOD.restless, MOOD.busy, MOOD.happy, -1] as const;
