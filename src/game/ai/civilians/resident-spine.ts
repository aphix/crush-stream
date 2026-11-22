/**
 * The resident spine: every closed set of the open world's brain declared once, keyed by id in code order (a row's code is its place in its table).
 * The code maps, words and positional tables the brain reads are derived from these rows at load; the model's tools are exported from them.
 */

/** A row of a closed set; its key names it in code, in the logs and in the model's tools. */
type Row = { readonly about: string };

/** Where the code that starts a row lives: `<path under src/game>#<function or method>` (a test checks each one exists). */
type Launch = readonly string[];

/** The code map of a table: each row's key to `base` + its place. Built once at load; the brain reads it like the literal it replaced. */
export function codesOf<T extends object>(table: T, base = 0): { readonly [K in keyof T]: number } {
  // The cast holds: Object.keys lists exactly T's keys (pinned by the spine's test).
  return Object.fromEntries(Object.keys(table).map((id, at) => [id, base + at])) as { readonly [K in keyof T]: number };
}

/** One byte per code: 1 where `has` holds of the row. */
export function flagsOf<R>(rows: readonly R[], has: (row: R) => boolean): Uint8Array {
  return Uint8Array.from(rows, (row) => (has(row) ? 1 : 0));
}

export const MOODS = {
  fine: { about: "nothing in particular" },
  happy: { about: "something went well" },
  proud: { about: "a step up in life" },
  sad: { about: "a loss or a setback" },
  busy: { about: "a lot on" },
  exhausted: { about: "needs rest" },
  hurt: { about: "injured" },
  afraid: { about: "danger seen or feared nearby" },
  hungry: { about: "needs a meal" },
  lonely: { about: "needs company" },
  restless: { about: "needs to get out or get on" },
  angry: { about: "wronged" },
  annoyed: { about: "a nuisance" },
  worried: { about: "something may go wrong" },
} as const satisfies Readonly<Record<string, Row>>;

const M = codesOf(MOODS);
/** A mood code for none. */
const NO_MOOD = -1;

/** What a crime is, in `RESIDENT_INT.crimeKind`. */
export const CRIME_KINDS = {
  none: { about: "no crime" },
  theft: { about: "lifting from a shop" },
  mugging: { about: "robbing someone in the street" },
  breakIn: { about: "breaking into a parked car" },
} as const satisfies Readonly<Record<string, Row>>;

const C = codesOf(CRIME_KINDS);

/**
 * What a leg is for. `label` is the look-at line's "{label} -> {place}", `log` the life log's "{log} {place}", `mood` the code of the mood the walk leaves,
 * `outdoor` a walk that ends standing at a door in the street (drawn there, and witnessed), `drive` a reason that may take the car, `crime` its crime kind.
 */
type PurposeRow = Row & { readonly label: string; readonly log: string; readonly mood: number; readonly outdoor: boolean; readonly drive: boolean; readonly crime: number; readonly launch: Launch };

const UTILITY: Launch = ["ai/civilians/civilian-plan.ts#chooseByUtility"];
const STORY: Launch = ["ai/civilians/civilian-plan.ts#keepAppointment"];
const CANDIDATE: Launch = ["ai/civilians/civilian-plan.ts#candidateFor"];
const TABLE: Launch = ["ai/civilians/society-table.ts#considerInteractions"];

/** The needs: purposes 0-5, chosen by utility from the need levels; `urge` is the mood code while the need is pressing. */
export const NEEDS = {
  rest: { about: "go home to rest or sleep", urge: M.exhausted, label: "rest", log: "went home to rest at", mood: NO_MOOD, outdoor: false, drive: true, crime: C.none, launch: UTILITY },
  food: { about: "go out for a meal", urge: M.hungry, label: "a meal", log: "went to eat at", mood: NO_MOOD, outdoor: false, drive: true, crime: C.none, launch: UTILITY },
  work: { about: "go to work a shift", urge: M.restless, label: "work", log: "started a shift at", mood: NO_MOOD, outdoor: false, drive: true, crime: C.none, launch: UTILITY },
  social: { about: "go out for company", urge: M.lonely, label: "company", log: "went out for company at", mood: NO_MOOD, outdoor: false, drive: true, crime: C.none, launch: UTILITY },
  errand: { about: "run an errand at a shop", urge: M.busy, label: "an errand", log: "ran an errand at", mood: NO_MOOD, outdoor: false, drive: true, crime: C.none, launch: UTILITY },
  solitude: { about: "go off alone for some quiet", urge: M.restless, label: "some quiet", log: "went off alone to", mood: NO_MOOD, outdoor: false, drive: false, crime: C.none, launch: UTILITY },
} as const satisfies Readonly<Record<string, PurposeRow & { readonly urge: number }>>;

/** The other purposes, coded on from the needs: the cast's stories, the bus, the interaction table's rows and the reactions to events. */
export const PURPOSES = {
  salPigeons: { about: "Sal feeds the pigeons", label: "feeding the pigeons", log: "fed the pigeons at", mood: M.happy, outdoor: false, drive: false, crime: C.none, launch: STORY },
  kowalskiBroom: { about: "Halina Kowalski chases Biscuit the cat off with a broom", label: "chasing the cat off with a broom", log: "went after Biscuit with a broom at", mood: M.angry, outdoor: false, drive: false, crime: C.none, launch: STORY },
  biscuitSteals: { about: "Biscuit the cat steals fish", label: "stealing fish", log: "stole fish from", mood: M.hungry, outdoor: false, drive: false, crime: C.none, launch: STORY },
  jamalFlyers: { about: "Jamal puts up flyers for Pepper, a lost cat", label: "looking for Pepper", log: "put up flyers for Pepper around", mood: M.worried, outdoor: false, drive: false, crime: C.none, launch: STORY },
  deeCoffee: { about: "Dee gets coffee before the broadcast", label: "coffee before the broadcast", log: "walked to the bodega for coffee at", mood: M.restless, outdoor: false, drive: false, crime: C.none, launch: STORY },
  okaforParty: { about: "the Okafors' Friday party", label: "the Friday party", log: "went to the Friday party at", mood: M.happy, outdoor: false, drive: false, crime: C.none, launch: STORY },
  vanRepair: { about: "Vince fixes his van, again", label: "fixing the van", log: "went to fix the van, again, at", mood: M.restless, outdoor: false, drive: false, crime: C.none, launch: STORY },
  tabbyPlay: { about: "the tabby gang runs about", label: "a run", log: "ran across", mood: M.happy, outdoor: false, drive: false, crime: C.none, launch: STORY },
  dogChase: { about: "a dog chases the tabby gang", label: "chasing the cats", log: "chased the tabby gang across", mood: M.restless, outdoor: false, drive: false, crime: C.none, launch: STORY },
  mechanicOut: { about: "the mechanic comes out to look at a wreck", label: "looking at the wreck", log: "came out to look at the wreck at", mood: M.busy, outdoor: false, drive: false, crime: C.none, launch: ["ai/civilians/civilian-events.ts#sendMechanicOut"] },
  partyGuest: { about: "a guest goes up to the Friday party", label: "the Friday party", log: "went up to the Friday party at", mood: M.happy, outdoor: false, drive: false, crime: C.none, launch: CANDIDATE },
  busAway: { about: "takes the bus out of the neighbourhood", label: "the bus", log: "took the bus from", mood: NO_MOOD, outdoor: false, drive: false, crime: C.none, launch: CANDIDATE },
  coffee: { about: "goes for a coffee", label: "a coffee", log: "went for a coffee at", mood: NO_MOOD, outdoor: false, drive: true, crime: C.none, launch: TABLE },
  drink: { about: "goes for a drink", label: "a drink", log: "went for a drink at", mood: NO_MOOD, outdoor: false, drive: true, crime: C.none, launch: TABLE },
  stoopSit: { about: "sits out on the stoop", label: "sitting out on the stoop", log: "sat out on the stoop at", mood: NO_MOOD, outdoor: true, drive: false, crime: C.none, launch: TABLE },
  stoopTalk: { about: "stops to chat with a neighbour", label: "a chat with a neighbour", log: "stopped to chat at", mood: M.happy, outdoor: true, drive: false, crime: C.none, launch: TABLE },
  argue: { about: "has a row with a neighbour", label: "a row with a neighbour", log: "went to have it out at", mood: M.angry, outdoor: true, drive: false, crime: C.none, launch: TABLE },
  loiter: { about: "hangs about outside a shop", label: "hanging about", log: "hung about outside", mood: NO_MOOD, outdoor: true, drive: false, crime: C.none, launch: TABLE },
  report: { about: "calls the police about a crime seen", label: "calling the police", log: "called the police from", mood: M.busy, outdoor: true, drive: false, crime: C.none, launch: ["ai/civilians/society-reactions.ts#witnessAll"] },
  flee: { about: "runs home from trouble, or lies low when wanted", label: "getting away", log: "ran for it to", mood: M.afraid, outdoor: false, drive: false, crime: C.none, launch: ["ai/civilians/society-reactions.ts#fleeHome", ...TABLE] },
  shoplift: { about: "lifts something from a shop", label: "shoplifting", log: "went to lift something from", mood: M.worried, outdoor: false, drive: false, crime: C.theft, launch: TABLE },
  mug: { about: "looks for someone to mug", label: "looking for someone to mug", log: "went looking for trouble at", mood: M.worried, outdoor: true, drive: false, crime: C.mugging, launch: TABLE },
  breakIn: { about: "tries the parked cars", label: "trying the parked cars", log: "went to try the cars outside", mood: M.worried, outdoor: true, drive: false, crime: C.breakIn, launch: TABLE },
  fight: { about: "gets into a fight in the street", label: "a fight", log: "got into a fight outside", mood: M.angry, outdoor: true, drive: false, crime: C.none, launch: ["ai/civilians/society-reactions.ts#enterFight"] },
  lookOn: { about: "stands at the door looking at trouble", label: "looking on", log: "stood looking at the trouble outside", mood: M.afraid, outdoor: true, drive: false, crime: C.none, launch: ["ai/civilians/society-alarm.ts#alarmAt"] },
  callAmbulance: { about: "calls an ambulance for someone down", label: "calling an ambulance", log: "called an ambulance from", mood: M.worried, outdoor: true, drive: false, crime: C.none, launch: ["ai/civilians/society-alarm.ts#callAmbulanceFor"] },
} as const satisfies Readonly<Record<string, PurposeRow>>;

/** Needs then purposes: every leg purpose by its code. */
export const LEG_PURPOSES: readonly PurposeRow[] = [...Object.values(NEEDS), ...Object.values(PURPOSES)];

/** What a civilian is doing that her drawing animates. `words` is the look-at bubble's (null when the line above says it), `clip` a finite clip's length in seconds (0 loops until its owner ends it). */
type ActivityRow = Row & { readonly words: string | null; readonly clip: number; readonly launch: Launch };

const READ = "ai/civilians/society-activity.ts#";
const LAW: Launch = ["ai/openworld-crime/crime-poses.ts#fillCopPoses"];
const CROWD_WRITES = "ai/civilians/civilian-crowd.ts#writeActivity";

export const ACTIVITIES = {
  none: { about: "walking, or standing still", words: null, clip: 0, launch: [`${READ}readActivity`] },
  idle: { about: "standing about", words: null, clip: 0, launch: [`${READ}readOutdoor`, `${READ}readIndoors`] },
  talk: { about: "talking with someone", words: "talking", clip: 0, launch: [`${READ}readOutdoor`] },
  buy: { about: "buying at the counter", words: "buying at the counter", clip: 3.2, launch: [`${READ}readBuying`] },
  door: { about: "going through a door", words: "going through a door", clip: 1.8, launch: [`${READ}readWalk`] },
  sitDown: { about: "sitting down", words: "sitting down", clip: 1.2, launch: [`${READ}readSitting`] },
  sit: { about: "seated on a chair or a bench", words: "sitting", clip: 0, launch: [`${READ}readRoom`, `${READ}readIndoors`] },
  standUp: { about: "getting up", words: "getting up", clip: 1.1, launch: [`${READ}readSitting`] },
  bump: { about: "bumped into someone", words: "bumped into someone", clip: 0.7, launch: [CROWD_WRITES] },
  swing: { about: "swinging a punch", words: "swinging a punch", clip: 0.6, launch: [`${READ}readFight`] },
  block: { about: "blocking a punch", words: "blocking a punch", clip: 0, launch: [`${READ}readFight`] },
  hit: { about: "taking a hit", words: "taking a hit", clip: 0.9, launch: [`${READ}readFight`, CROWD_WRITES] },
  sitSteps: { about: "sitting out on the stoop", words: "sitting out on the stoop", clip: 0, launch: [`${READ}readOutdoor`] },
  cuffing: { about: "a cop cuffing a suspect", words: "cuffing a suspect", clip: 1.5, launch: LAW },
  cuffed: { about: "in handcuffs", words: "in handcuffs", clip: 0, launch: LAW },
  arresting: { about: "a cop making an arrest", words: "making an arrest", clip: 1.5, launch: LAW },
  escorting: { about: "a cop leading a suspect away", words: "leading a suspect away", clip: 0, launch: LAW },
  carIn: { about: "getting into a car", words: "getting into a car", clip: 2.6, launch: [`${READ}readWalk`] },
  carOut: { about: "getting out of a car", words: "getting out of a car", clip: 2.4, launch: [`${READ}readWalk`] },
  phoneCall: { about: "phoning for an ambulance", words: "phoning for an ambulance", clip: 0, launch: [`${READ}readWatcher`] },
  kneel: { about: "a medic kneeling by someone hurt", words: "kneeling by someone hurt", clip: 0, launch: ["engine/engine-openworld-medics.ts#placeMedics"] },
  recoil: { about: "flinching back from danger", words: "flinching back", clip: 0.9, launch: [`${READ}readFlinch`, `${READ}readWatcher`] },
} as const satisfies Readonly<Record<string, ActivityRow>>;

/**
 * The host's input event kinds (wire byte, `net/crowd-codec.ts`). `brain` names the handlers that apply one (none: it rides the log for the
 * engine and the brain drops it); `remark` is what a bystander calls it, null for a kind nobody remarks on.
 */
type EventKindRow = Row & { readonly remark: string | null; readonly brain: Launch };

const EVENTS = "ai/civilians/civilian-events.ts#";
const REACT = "ai/civilians/society-reactions.ts#";
const ALARM = "ai/civilians/society-alarm.ts#";
const SECOND_PARTY: Launch = [`${EVENTS}queueEvents`];

export const EVENT_KINDS = {
  knock: { about: "a car ran a civilian down", remark: "someone knocked down", brain: [`${EVENTS}knockResident`, `${REACT}applyKnockWitness`, `${ALARM}alarmAtKnock`, `${EVENTS}applyKnock`] },
  wreck: { about: "a car crashed into a building", remark: "the crash", brain: [`${EVENTS}sendMechanicOut`, `${ALARM}alarmAt`, `${EVENTS}applyWreck`] },
  crime: { about: "a crime was committed", remark: "the crime", brain: [`${REACT}applyCrime`, `${REACT}reactToCrime`] },
  bust: { about: "the police arrested someone", remark: "the arrest", brain: [`${REACT}applyBust`, `${REACT}releaseFightPartner`] },
  push: { about: "someone was shoved", remark: "the shoving", brain: [`${REACT}applyPush`] },
  fight: { about: "a fight broke out", remark: "the fight", brain: [`${REACT}startFight`] },
  alongside: { about: "the other civilian in a push or fight", remark: null, brain: SECOND_PARTY },
  walker: { about: "the player on foot in a push or fight", remark: null, brain: SECOND_PARTY },
  jaywalk: { about: "the police arrested a jaywalker", remark: "the jaywalker", brain: [`${REACT}applyJaywalk`] },
  copDown: { about: "a car knocked a cop down", remark: "the cop knocked down", brain: [] },
  ambulance: { about: "someone down needs an ambulance", remark: "the ambulance", brain: [`${ALARM}callAmbulanceFor`] },
  danger: { about: "a crash or a car heading at someone", remark: "the near miss", brain: [`${ALARM}alarmAt`] },
  ambulanceStage: { about: "where the ambulance is", remark: null, brain: [] },
  car: { about: "the car that nudged someone in a push", remark: null, brain: SECOND_PARTY },
  arrestRide: { about: "an arrested resident driven off in a patrol car", remark: null, brain: [] },
  arrestAlight: { about: "the patrol car arrived at the station", remark: null, brain: [] },
} as const satisfies Readonly<Record<string, EventKindRow>>;

/** The life log's codes and the mood code each leaves; walks are logged from `VISIT_BASE` on, coded after these. */
type LogRow = Row & { readonly mood: number };

export const LOG_EVENTS = {
  none: { about: "no event", mood: M.fine },
  arrived: { about: "moved into the neighbourhood", mood: M.happy },
  born: { about: "was born", mood: M.happy },
  gotJob: { about: "got a job", mood: M.proud },
  retired: { about: "retired from work", mood: M.fine },
  fired: { about: "lost a job", mood: M.sad },
  promoted: { about: "was promoted", mood: M.proud },
  relationship: { about: "started seeing someone", mood: M.busy },
  breakup: { about: "broke up", mood: M.sad },
  married: { about: "got married", mood: M.happy },
  baby: { about: "had a baby", mood: M.exhausted },
  moved: { about: "moved house", mood: M.happy },
  injured: { about: "was injured", mood: M.hurt },
  cured: { about: "got better", mood: M.happy },
  knocked: { about: "was knocked down by a car", mood: M.hurt },
  backFromHospital: { about: "came back from hospital", mood: M.happy },
  workplaceClosed: { about: "the workplace shut", mood: M.sad },
  workplaceReopened: { about: "the workplace reopened", mood: M.happy },
  lostSomeone: { about: "lost someone close", mood: M.sad },
  familyKnocked: { about: "family was knocked down", mood: M.sad },
  stoopWrecked: { about: "a car wrecked the stoop", mood: M.angry },
  staticComplaint: { about: "the midnight radio's static", mood: M.annoyed },
  backOnBus: { about: "came back on the bus", mood: NO_MOOD },
  shoplifted: { about: "lifted something from a shop", mood: M.worried },
  muggedSomeone: { about: "mugged someone", mood: M.worried },
  brokeIntoCar: { about: "broke into a car", mood: M.worried },
  wasMugged: { about: "was mugged", mood: M.afraid },
  carBrokenInto: { about: "the car was broken into", mood: M.angry },
  shopRobbed: { about: "the shop was robbed", mood: M.angry },
  reportedCrime: { about: "reported a crime", mood: M.busy },
  fledDanger: { about: "ran home from trouble", mood: M.afraid },
  arrested: { about: "was arrested", mood: M.sad },
  released: { about: "was let out of custody", mood: M.annoyed },
  fought: { about: "got into a fight", mood: M.angry },
  foughtStranger: { about: "fought a stranger", mood: M.angry },
  foughtWalker: { about: "fought someone on foot", mood: M.angry },
  jaywalkArrest: { about: "was arrested for jaywalking", mood: M.annoyed },
  sawDanger: { about: "saw trouble outside", mood: M.afraid },
  calledAmbulance: { about: "called an ambulance", mood: M.worried },
} as const satisfies Readonly<Record<string, LogRow>>;

/** What a place is to the people who go there. `hours` are the default opening hours [from, to) when the map gives none (null: always open). */
type VenueRow = Row & { readonly hours: readonly [number, number] | null; readonly seated: boolean; readonly counter: boolean };

export const VENUES = {
  other: { about: "anywhere else", hours: null, seated: false, counter: false },
  home: { about: "a home", hours: null, seated: false, counter: false },
  office: { about: "a workplace", hours: null, seated: false, counter: false },
  coffee: { about: "a coffee shop, open in the morning", hours: [6, 15], seated: true, counter: true },
  bar: { about: "a bar, open from dusk", hours: [16, 3], seated: true, counter: true },
  diner: { about: "a diner", hours: [7, 23], seated: true, counter: true },
  shop: { about: "a shop, open by day", hours: [7, 22], seated: false, counter: true },
  supermarket: { about: "a supermarket", hours: [8, 21], seated: false, counter: true },
  park: { about: "a park or hangout", hours: null, seated: false, counter: false },
  transit: { about: "a bus stop", hours: null, seated: false, counter: false },
} as const satisfies Readonly<Record<string, VenueRow>>;
