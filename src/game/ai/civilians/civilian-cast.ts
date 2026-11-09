import { FRIDAY, GENDER, PURPOSE, SATURDAY, SPECIES } from "./civilian-constants.ts";

/** The places the cast's stories name; a map that lacks one skips the stories that need it. */
export const PLACE_NAMES = {
  salHome: "Sal's rowhome",
  salCoop: "Sal's pigeon coop",
  kowalskiHome: "Kowalski rowhome",
  kowalskiYard: "Kowalski's yard",
  brooksHome: "Brooks rowhome",
  deeHome: "Dee's radio house",
  okaforHome: "Okafor rowhome",
  okaforDeck: "Okafor rooftop deck",
  mackHome: "Mack rowhome",
  vanAlley: "B1 alley",
  ramosHome: "Ramos rowhome",
  garage: "Moore Auto Body Garage",
  bodega: "Bodega Supreme",
  parkCourt: "Moore Park Court",
  tabbyAlley: "A2 alley",
  garden: "B3 Community Garden",
  bar: "Mifflin Bar",
  busStop: "Moore Bus Stop",
} as const;

/** The place of an appointment that is the block of the day's (Jamal's flyers). */
export const BLOCK_OF_DAY = "block of the day";

/** A walk to a place that ends there at the given time: on every day, or only on `weekday` (Monday 0). */
type Appointment = { purpose: number; place: string; hour: number; minute: number; weekday: number | null; dwellMinutes: number };

export type CastMember = {
  key: string;
  first: string;
  family: string;
  species: number;
  gender: number;
  age: number;
  home: string;
  workplace: string | null;
  title: string | null;
  /** What an animal is called in the look-at line. */
  description: string;
  /** Pace against its species' own (a fat cat is slow). */
  paceFactor: number;
  partner: string | null;
  parent: string | null;
  /** What else the person does in the neighbourhood: the garage mechanic goes out to look at a crash, the radio host broadcasts at night. */
  trait: "mechanic" | "radio" | null;
  appointments: readonly Appointment[];
};

/** Keys the cast names each other by. */
const KEY = { tamika: "tamika", emeka: "emeka", ngozi: "ngozi" } as const;

const PERSON = { species: SPECIES.person, workplace: null, title: null, description: "", paceFactor: 1, partner: null, parent: null, trait: null, appointments: [] } as const;
const ANIMAL = { family: "", gender: GENDER.female, age: 3, workplace: null, title: null, paceFactor: 1, partner: null, parent: null, trait: null } as const;

/** Who lives in Moore Park by name, and the small stories they carry out every day or week (owner: recurring stories, fixed by name, beside the seeded residents). */
export const CAST: readonly CastMember[] = [
  { ...PERSON, key: "sal", first: "Sal", family: "Russo", gender: GENDER.male, age: 63, home: PLACE_NAMES.salHome, appointments: [{ purpose: PURPOSE.salPigeons, place: PLACE_NAMES.salCoop, hour: 7, minute: 0, weekday: null, dwellMinutes: 40 }] },
  { ...PERSON, key: "halina", first: "Halina", family: "Kowalski", gender: GENDER.female, age: 71, home: PLACE_NAMES.kowalskiHome, appointments: [{ purpose: PURPOSE.kowalskiBroom, place: PLACE_NAMES.kowalskiYard, hour: 6, minute: 0, weekday: null, dwellMinutes: 10 }] },
  {
    ...PERSON,
    key: "jamal",
    first: "Jamal",
    family: "Brooks",
    gender: GENDER.male,
    age: 9,
    home: PLACE_NAMES.brooksHome,
    parent: KEY.tamika,
    appointments: [
      { purpose: PURPOSE.jamalFlyers, place: BLOCK_OF_DAY, hour: 10, minute: 0, weekday: null, dwellMinutes: 25 },
      { purpose: PURPOSE.jamalFlyers, place: BLOCK_OF_DAY, hour: 11, minute: 30, weekday: null, dwellMinutes: 25 },
      { purpose: PURPOSE.jamalFlyers, place: BLOCK_OF_DAY, hour: 13, minute: 0, weekday: null, dwellMinutes: 25 },
    ],
  },
  { ...PERSON, key: KEY.tamika, first: "Tamika", family: "Brooks", gender: GENDER.female, age: 34, home: PLACE_NAMES.brooksHome },
  { ...PERSON, key: "dee", first: "Dee", family: "Reyes", gender: GENDER.female, age: 38, home: PLACE_NAMES.deeHome, trait: "radio", appointments: [{ purpose: PURPOSE.deeCoffee, place: PLACE_NAMES.bodega, hour: 23, minute: 0, weekday: null, dwellMinutes: 15 }] },
  { ...PERSON, key: KEY.emeka, first: "Emeka", family: "Okafor", gender: GENDER.male, age: 44, home: PLACE_NAMES.okaforHome, partner: KEY.ngozi, appointments: [{ purpose: PURPOSE.okaforParty, place: PLACE_NAMES.okaforDeck, hour: 19, minute: 0, weekday: FRIDAY, dwellMinutes: 240 }] },
  { ...PERSON, key: KEY.ngozi, first: "Ngozi", family: "Okafor", gender: GENDER.female, age: 41, home: PLACE_NAMES.okaforHome, partner: KEY.emeka, appointments: [{ purpose: PURPOSE.okaforParty, place: PLACE_NAMES.okaforDeck, hour: 19, minute: 0, weekday: FRIDAY, dwellMinutes: 240 }] },
  { ...PERSON, key: "ada", first: "Ada", family: "Okafor", gender: GENDER.female, age: 13, home: PLACE_NAMES.okaforHome, parent: KEY.ngozi, appointments: [{ purpose: PURPOSE.okaforParty, place: PLACE_NAMES.okaforDeck, hour: 19, minute: 30, weekday: FRIDAY, dwellMinutes: 210 }] },
  { ...PERSON, key: "vince", first: "Vince", family: "Mack", gender: GENDER.male, age: 52, home: PLACE_NAMES.mackHome, appointments: [{ purpose: PURPOSE.vanRepair, place: PLACE_NAMES.vanAlley, hour: 10, minute: 0, weekday: SATURDAY, dwellMinutes: 150 }] },
  { ...PERSON, key: "hector", first: "Hector", family: "Ramos", gender: GENDER.male, age: 45, home: PLACE_NAMES.ramosHome, workplace: PLACE_NAMES.garage, title: "Mechanic", trait: "mechanic" },
  {
    ...ANIMAL,
    key: "biscuit",
    first: "Biscuit",
    species: SPECIES.cat,
    description: "an orange cat",
    paceFactor: 0.7,
    home: PLACE_NAMES.vanAlley,
    appointments: [{ purpose: PURPOSE.biscuitSteals, place: PLACE_NAMES.kowalskiYard, hour: 5, minute: 50, weekday: null, dwellMinutes: 12 }],
  },
  { ...ANIMAL, key: "pepper", first: "Pepper", species: SPECIES.cat, description: "a black cat with white socks", home: PLACE_NAMES.salCoop, appointments: [] },
  ...["Tux", "Tilly", "Tank"].map(
    (first): CastMember => ({
      ...ANIMAL,
      key: first.toLowerCase(),
      first,
      species: SPECIES.cat,
      description: "a tabby",
      home: PLACE_NAMES.tabbyAlley,
      appointments: [
        { purpose: PURPOSE.tabbyPlay, place: PLACE_NAMES.parkCourt, hour: 15, minute: 0, weekday: null, dwellMinutes: 8 },
        { purpose: PURPOSE.tabbyPlay, place: PLACE_NAMES.tabbyAlley, hour: 15, minute: 11, weekday: null, dwellMinutes: 60 },
      ],
    }),
  ),
  {
    ...ANIMAL,
    key: "duke",
    first: "Duke",
    species: SPECIES.dog,
    description: "the bodega's dog",
    home: PLACE_NAMES.bodega,
    appointments: [{ purpose: PURPOSE.dogChase, place: PLACE_NAMES.parkCourt, hour: 15, minute: 8, weekday: null, dwellMinutes: 4 }],
  },
];

/** Places that draw a crowd only at some hours (company: the court in the afternoon, the garden in the morning, the bar at night); a window may wrap past midnight. */
export const PLACE_HOURS: readonly { place: string; from: number; to: number }[] = [
  { place: PLACE_NAMES.parkCourt, from: 14, to: 18 },
  { place: PLACE_NAMES.garden, from: 7, to: 11 },
  { place: PLACE_NAMES.bar, from: 20, to: 2 },
];
