/**
 * The resident spine: every closed set of the open world's brain declared once, in code order (a row's code is its index).
 * The code maps, words and positional tables the brain reads are derived from these rows at load; the model's tools are exported from them.
 */

/** A row of a closed set: its id names it in code, in the logs and in the model's tools. */
type Row = { readonly id: string; readonly about: string };

/** Where the code that starts a row lives: `<path under src/game>#<function or method>` (a test checks each one exists). */
type Launch = readonly string[];

export const MOODS = [
  { id: "fine", about: "nothing in particular" },
  { id: "happy", about: "something went well" },
  { id: "proud", about: "a step up in life" },
  { id: "sad", about: "a loss or a setback" },
  { id: "busy", about: "a lot on" },
  { id: "exhausted", about: "needs rest" },
  { id: "hurt", about: "injured" },
  { id: "afraid", about: "danger seen or feared nearby" },
  { id: "hungry", about: "needs a meal" },
  { id: "lonely", about: "needs company" },
  { id: "restless", about: "needs to get out or get on" },
  { id: "angry", about: "wronged" },
  { id: "annoyed", about: "a nuisance" },
  { id: "worried", about: "something may go wrong" },
] as const satisfies readonly Row[];

export type MoodId = (typeof MOODS)[number]["id"];

/** What a crime is, in `RESIDENT_INT.crimeKind`. */
export const CRIME_KINDS = [
  { id: "none", about: "no crime" },
  { id: "theft", about: "lifting from a shop" },
  { id: "mugging", about: "robbing someone in the street" },
  { id: "breakIn", about: "breaking into a parked car" },
] as const satisfies readonly Row[];

type CrimeId = (typeof CRIME_KINDS)[number]["id"];

/**
 * What a leg is for. `label` is the look-at line's "{label} -> {place}", `log` the life log's "{log} {place}", `mood` what the walk leaves,
 * `outdoor` a walk that ends standing at a door in the street (drawn there, and witnessed), `drive` a reason that may take the car.
 */
type PurposeRow = Row & {
  readonly label: string;
  readonly log: string;
  readonly mood: MoodId | null;
  readonly outdoor: boolean;
  readonly drive: boolean;
  readonly crime: CrimeId;
  readonly launch: Launch;
};

const UTILITY: Launch = ["ai/civilians/civilian-plan.ts#chooseByUtility"];
const STORY: Launch = ["ai/civilians/civilian-plan.ts#keepAppointment"];
const TABLE: Launch = ["ai/civilians/society-table.ts#considerInteractions"];

/** The needs: purposes 0-5, chosen by utility from the need levels; `urge` is the mood while the need is pressing. */
export const NEEDS = [
  { id: "rest", about: "go home to rest or sleep", urge: "exhausted", label: "rest", log: "went home to rest at", mood: null, outdoor: false, drive: true, crime: "none", launch: UTILITY },
  { id: "food", about: "go out for a meal", urge: "hungry", label: "a meal", log: "went to eat at", mood: null, outdoor: false, drive: true, crime: "none", launch: UTILITY },
  { id: "work", about: "go to work a shift", urge: "restless", label: "work", log: "started a shift at", mood: null, outdoor: false, drive: true, crime: "none", launch: UTILITY },
  { id: "social", about: "go out for company", urge: "lonely", label: "company", log: "went out for company at", mood: null, outdoor: false, drive: true, crime: "none", launch: UTILITY },
  { id: "errand", about: "run an errand at a shop", urge: "busy", label: "an errand", log: "ran an errand at", mood: null, outdoor: false, drive: true, crime: "none", launch: UTILITY },
  { id: "solitude", about: "go off alone for some quiet", urge: "restless", label: "some quiet", log: "went off alone to", mood: null, outdoor: false, drive: false, crime: "none", launch: UTILITY },
] as const satisfies readonly (PurposeRow & { readonly urge: MoodId })[];

/** The other purposes, coded on from the needs: the cast's stories, the bus, the interaction table's rows and the reactions to events. */
export const PURPOSES = [
  { id: "salPigeons", about: "Sal feeds the pigeons", label: "feeding the pigeons", log: "fed the pigeons at", mood: "happy", outdoor: false, drive: false, crime: "none", launch: STORY },
  { id: "kowalskiBroom", about: "Halina Kowalski chases Biscuit the cat off with a broom", label: "chasing the cat off with a broom", log: "went after Biscuit with a broom at", mood: "angry", outdoor: false, drive: false, crime: "none", launch: STORY },
  { id: "biscuitSteals", about: "Biscuit the cat steals fish", label: "stealing fish", log: "stole fish from", mood: "hungry", outdoor: false, drive: false, crime: "none", launch: STORY },
  { id: "jamalFlyers", about: "Jamal puts up flyers for Pepper, a lost cat", label: "looking for Pepper", log: "put up flyers for Pepper around", mood: "worried", outdoor: false, drive: false, crime: "none", launch: STORY },
  { id: "deeCoffee", about: "Dee gets coffee before the broadcast", label: "coffee before the broadcast", log: "walked to the bodega for coffee at", mood: "restless", outdoor: false, drive: false, crime: "none", launch: STORY },
  { id: "okaforParty", about: "the Okafors' Friday party", label: "the Friday party", log: "went to the Friday party at", mood: "happy", outdoor: false, drive: false, crime: "none", launch: STORY },
  { id: "vanRepair", about: "Vince fixes his van, again", label: "fixing the van", log: "went to fix the van, again, at", mood: "restless", outdoor: false, drive: false, crime: "none", launch: STORY },
  { id: "tabbyPlay", about: "the tabby gang runs about", label: "a run", log: "ran across", mood: "happy", outdoor: false, drive: false, crime: "none", launch: STORY },
  { id: "dogChase", about: "a dog chases the tabby gang", label: "chasing the cats", log: "chased the tabby gang across", mood: "restless", outdoor: false, drive: false, crime: "none", launch: STORY },
  { id: "mechanicOut", about: "the mechanic comes out to look at a wreck", label: "looking at the wreck", log: "came out to look at the wreck at", mood: "busy", outdoor: false, drive: false, crime: "none", launch: ["ai/civilians/civilian-events.ts#sendMechanicOut"] },
  { id: "partyGuest", about: "a guest goes up to the Friday party", label: "the Friday party", log: "went up to the Friday party at", mood: "happy", outdoor: false, drive: false, crime: "none", launch: ["ai/civilians/civilian-plan.ts#candidateFor"] },
  { id: "busAway", about: "takes the bus out of the neighbourhood", label: "the bus", log: "took the bus from", mood: null, outdoor: false, drive: false, crime: "none", launch: ["ai/civilians/civilian-plan.ts#candidateFor"] },
  { id: "coffee", about: "goes for a coffee", label: "a coffee", log: "went for a coffee at", mood: null, outdoor: false, drive: true, crime: "none", launch: TABLE },
  { id: "drink", about: "goes for a drink", label: "a drink", log: "went for a drink at", mood: null, outdoor: false, drive: true, crime: "none", launch: TABLE },
  { id: "stoopSit", about: "sits out on the stoop", label: "sitting out on the stoop", log: "sat out on the stoop at", mood: null, outdoor: true, drive: false, crime: "none", launch: TABLE },
  { id: "stoopTalk", about: "stops to chat with a neighbour", label: "a chat with a neighbour", log: "stopped to chat at", mood: "happy", outdoor: true, drive: false, crime: "none", launch: TABLE },
  { id: "argue", about: "has a row with a neighbour", label: "a row with a neighbour", log: "went to have it out at", mood: "angry", outdoor: true, drive: false, crime: "none", launch: TABLE },
  { id: "loiter", about: "hangs about outside a shop", label: "hanging about", log: "hung about outside", mood: null, outdoor: true, drive: false, crime: "none", launch: TABLE },
  { id: "report", about: "calls the police about a crime seen", label: "calling the police", log: "called the police from", mood: "busy", outdoor: true, drive: false, crime: "none", launch: ["ai/civilians/society-reactions.ts#witnessAll"] },
  { id: "flee", about: "runs home from trouble, or lies low when wanted", label: "getting away", log: "ran for it to", mood: "afraid", outdoor: false, drive: false, crime: "none", launch: ["ai/civilians/society-reactions.ts#fleeHome", ...TABLE] },
  { id: "shoplift", about: "lifts something from a shop", label: "shoplifting", log: "went to lift something from", mood: "worried", outdoor: false, drive: false, crime: "theft", launch: TABLE },
  { id: "mug", about: "looks for someone to mug", label: "looking for someone to mug", log: "went looking for trouble at", mood: "worried", outdoor: true, drive: false, crime: "mugging", launch: TABLE },
  { id: "breakIn", about: "tries the parked cars", label: "trying the parked cars", log: "went to try the cars outside", mood: "worried", outdoor: true, drive: false, crime: "breakIn", launch: TABLE },
  { id: "fight", about: "gets into a fight in the street", label: "a fight", log: "got into a fight outside", mood: "angry", outdoor: true, drive: false, crime: "none", launch: ["ai/civilians/society-reactions.ts#enterFight"] },
  { id: "lookOn", about: "stands at the door looking at trouble", label: "looking on", log: "stood looking at the trouble outside", mood: "afraid", outdoor: true, drive: false, crime: "none", launch: ["ai/civilians/society-alarm.ts#alarmAt"] },
  { id: "callAmbulance", about: "calls an ambulance for someone down", label: "calling an ambulance", log: "called an ambulance from", mood: "worried", outdoor: true, drive: false, crime: "none", launch: ["ai/civilians/society-alarm.ts#callAmbulanceFor"] },
] as const satisfies readonly PurposeRow[];

/** Needs then purposes: every leg purpose by its code. */
export const LEG_PURPOSES: readonly PurposeRow[] = [...NEEDS, ...PURPOSES];

/** What a civilian is doing that her drawing animates. `words` is the look-at bubble's (null when the line above says it), `seconds` a finite clip's length (0 loops until its owner ends it). */
type ActivityRow = Row & { readonly words: string | null; readonly seconds: number; readonly launch: Launch };

const READ = "ai/civilians/society-activity.ts#";
const LAW: Launch = ["ai/openworld-crime/crime-poses.ts#fillCopPoses"];

export const ACTIVITIES = [
  { id: "none", about: "walking, or standing still", words: null, seconds: 0, launch: [`${READ}readActivity`] },
  { id: "idle", about: "standing about", words: null, seconds: 0, launch: [`${READ}readOutdoor`, `${READ}readIndoors`] },
  { id: "talk", about: "talking with someone", words: "talking", seconds: 0, launch: [`${READ}readOutdoor`] },
  { id: "buy", about: "buying at the counter", words: "buying at the counter", seconds: 3.2, launch: [`${READ}readBuying`] },
  { id: "door", about: "going through a door", words: "going through a door", seconds: 1.8, launch: [`${READ}readWalk`] },
  { id: "sitDown", about: "sitting down", words: "sitting down", seconds: 1.2, launch: [`${READ}readSitting`] },
  { id: "sit", about: "sitting", words: "sitting", seconds: 0, launch: [`${READ}readRoom`, `${READ}readIndoors`] },
  { id: "standUp", about: "getting up", words: "getting up", seconds: 1.1, launch: [`${READ}readSitting`] },
  { id: "bump", about: "bumped into someone", words: "bumped into someone", seconds: 0.7, launch: ["ai/civilians/civilian-crowd.ts#writeActivity"] },
  { id: "swing", about: "swinging a punch", words: "swinging a punch", seconds: 0.6, launch: [`${READ}readFight`] },
  { id: "block", about: "blocking a punch", words: "blocking a punch", seconds: 0, launch: [`${READ}readFight`] },
  { id: "hit", about: "taking a hit", words: "taking a hit", seconds: 0.9, launch: [`${READ}readFight`, "ai/civilians/civilian-crowd.ts#writeActivity"] },
  { id: "sitSteps", about: "sitting out on the stoop", words: "sitting out on the stoop", seconds: 0, launch: [`${READ}readOutdoor`] },
  { id: "cuffing", about: "a cop cuffing a suspect", words: "cuffing a suspect", seconds: 1.5, launch: LAW },
  { id: "cuffed", about: "in handcuffs", words: "in handcuffs", seconds: 0, launch: LAW },
  { id: "arresting", about: "a cop making an arrest", words: "making an arrest", seconds: 1.5, launch: LAW },
  { id: "escorting", about: "a cop leading a suspect away", words: "leading a suspect away", seconds: 0, launch: LAW },
  { id: "carIn", about: "getting into a car", words: "getting into a car", seconds: 2.6, launch: [`${READ}readWalk`] },
  { id: "carOut", about: "getting out of a car", words: "getting out of a car", seconds: 2.4, launch: [`${READ}readWalk`] },
  { id: "phoneCall", about: "phoning for an ambulance", words: "phoning for an ambulance", seconds: 0, launch: [`${READ}readWatcher`] },
  { id: "kneel", about: "a medic kneeling by someone hurt", words: "kneeling by someone hurt", seconds: 0, launch: ["engine/engine-openworld-medics.ts#placeMedics"] },
  { id: "recoil", about: "flinching back from danger", words: "flinching back", seconds: 0.9, launch: [`${READ}readFlinch`, `${READ}readWatcher`] },
] as const satisfies readonly ActivityRow[];

/**
 * The host's input event kinds (wire byte, `net/crowd-codec.ts`). `brain` names the handlers that apply one (none: it rides the log for the
 * engine and the brain drops it); `remark` is what a bystander calls it, null for a kind nobody remarks on.
 */
type EventKindRow = Row & { readonly remark: string | null; readonly brain: Launch };

const EVENTS = "ai/civilians/civilian-events.ts#";
const REACT = "ai/civilians/society-reactions.ts#";
const ALARM = "ai/civilians/society-alarm.ts#";

export const EVENT_KINDS = [
  { id: "knock", about: "a car ran a civilian down", remark: "someone knocked down", brain: [`${EVENTS}knockResident`, `${REACT}applyKnockWitness`, `${ALARM}alarmAtKnock`, `${EVENTS}applyKnock`] },
  { id: "wreck", about: "a car crashed into a building", remark: "the crash", brain: [`${EVENTS}sendMechanicOut`, `${ALARM}alarmAt`, `${EVENTS}applyWreck`] },
  { id: "crime", about: "a crime was committed", remark: "the crime", brain: [`${REACT}applyCrime`, `${REACT}reactToCrime`] },
  { id: "bust", about: "the police arrested someone", remark: "the arrest", brain: [`${REACT}applyBust`, `${REACT}releaseFightPartner`] },
  { id: "push", about: "someone was shoved", remark: "the shoving", brain: [`${REACT}applyPush`] },
  { id: "fight", about: "a fight broke out", remark: "the fight", brain: [`${REACT}startFight`] },
  { id: "alongside", about: "the other civilian in a push or fight", remark: null, brain: [`${EVENTS}queueEvents`] },
  { id: "walker", about: "the player on foot in a push or fight", remark: null, brain: [`${EVENTS}queueEvents`] },
  { id: "jaywalk", about: "the police arrested a jaywalker", remark: "the jaywalker", brain: [`${REACT}applyJaywalk`] },
  { id: "copDown", about: "a car knocked a cop down", remark: "the cop knocked down", brain: [] },
  { id: "ambulance", about: "someone down needs an ambulance", remark: "the ambulance", brain: [`${ALARM}callAmbulanceFor`] },
  { id: "danger", about: "a crash or a car heading at someone", remark: "the near miss", brain: [`${ALARM}alarmAt`] },
  { id: "ambulanceStage", about: "where the ambulance is", remark: null, brain: [] },
  { id: "car", about: "the car that nudged someone in a push", remark: null, brain: [`${EVENTS}queueEvents`] },
  { id: "arrestRide", about: "an arrested resident driven off in a patrol car", remark: null, brain: [] },
  { id: "arrestAlight", about: "the patrol car arrived at the station", remark: null, brain: [] },
] as const satisfies readonly EventKindRow[];

/** The life log's codes and the mood each leaves (null: none); walks are logged from `VISIT_BASE` on, coded after these. */
type LogRow = Row & { readonly mood: MoodId | null };

export const LOG_EVENTS = [
  { id: "none", about: "nothing", mood: "fine" },
  { id: "arrived", about: "moved into the neighbourhood", mood: "happy" },
  { id: "born", about: "was born", mood: "happy" },
  { id: "gotJob", about: "got a job", mood: "proud" },
  { id: "retired", about: "retired", mood: "fine" },
  { id: "fired", about: "lost a job", mood: "sad" },
  { id: "promoted", about: "was promoted", mood: "proud" },
  { id: "relationship", about: "started seeing someone", mood: "busy" },
  { id: "breakup", about: "broke up", mood: "sad" },
  { id: "married", about: "got married", mood: "happy" },
  { id: "baby", about: "had a baby", mood: "exhausted" },
  { id: "moved", about: "moved house", mood: "happy" },
  { id: "injured", about: "was injured", mood: "hurt" },
  { id: "cured", about: "got better", mood: "happy" },
  { id: "knocked", about: "was knocked down by a car", mood: "hurt" },
  { id: "backFromHospital", about: "came back from hospital", mood: "happy" },
  { id: "workplaceClosed", about: "the workplace shut", mood: "sad" },
  { id: "workplaceReopened", about: "the workplace reopened", mood: "happy" },
  { id: "lostSomeone", about: "lost someone close", mood: "sad" },
  { id: "familyKnocked", about: "family was knocked down", mood: "sad" },
  { id: "stoopWrecked", about: "a car wrecked the stoop", mood: "angry" },
  { id: "staticComplaint", about: "the midnight radio's static", mood: "annoyed" },
  { id: "backOnBus", about: "came back on the bus", mood: null },
  { id: "shoplifted", about: "shoplifted", mood: "worried" },
  { id: "muggedSomeone", about: "mugged someone", mood: "worried" },
  { id: "brokeIntoCar", about: "broke into a car", mood: "worried" },
  { id: "wasMugged", about: "was mugged", mood: "afraid" },
  { id: "carBrokenInto", about: "the car was broken into", mood: "angry" },
  { id: "shopRobbed", about: "the shop was robbed", mood: "angry" },
  { id: "reportedCrime", about: "reported a crime", mood: "busy" },
  { id: "fledDanger", about: "ran home from trouble", mood: "afraid" },
  { id: "arrested", about: "was arrested", mood: "sad" },
  { id: "released", about: "was let out of custody", mood: "annoyed" },
  { id: "fought", about: "got into a fight", mood: "angry" },
  { id: "foughtStranger", about: "fought a stranger", mood: "angry" },
  { id: "foughtWalker", about: "fought someone on foot", mood: "angry" },
  { id: "jaywalkArrest", about: "was arrested for jaywalking", mood: "annoyed" },
  { id: "sawDanger", about: "saw trouble outside", mood: "afraid" },
  { id: "calledAmbulance", about: "called an ambulance", mood: "worried" },
] as const satisfies readonly LogRow[];

/** What a place is to the people who go there. `hours` are the default opening hours [from, to) when the map gives none (null: always open). */
type VenueRow = Row & { readonly hours: readonly [number, number] | null; readonly seated: boolean; readonly counter: boolean };

export const VENUES = [
  { id: "other", about: "anywhere else", hours: null, seated: false, counter: false },
  { id: "home", about: "a home", hours: null, seated: false, counter: false },
  { id: "office", about: "a workplace", hours: null, seated: false, counter: false },
  { id: "coffee", about: "a coffee shop, open in the morning", hours: [6, 15], seated: true, counter: true },
  { id: "bar", about: "a bar, open from dusk", hours: [16, 3], seated: true, counter: true },
  { id: "diner", about: "a diner", hours: [7, 23], seated: true, counter: true },
  { id: "shop", about: "a shop, open by day", hours: [7, 22], seated: false, counter: true },
  { id: "supermarket", about: "a supermarket", hours: [8, 21], seated: false, counter: true },
  { id: "park", about: "a park or hangout", hours: null, seated: false, counter: false },
  { id: "transit", about: "a bus stop", hours: null, seated: false, counter: false },
] as const satisfies readonly VenueRow[];

/** The code map of a closed set: each row's id to `base` + its index. Built once at load; the brain reads it like the literal it replaced. */
export function codesOf<R extends readonly Row[]>(rows: R, base = 0): { readonly [K in R[number]["id"]]: number } {
  // The cast holds: one entry per row id (pinned by the spine's test).
  return Object.fromEntries(rows.map((row, at) => [row.id, base + at])) as { readonly [K in R[number]["id"]]: number };
}

/** The code of mood `mood`, -1 for none. */
export function moodCode(mood: MoodId | null): number {
  return mood === null ? -1 : MOODS.findIndex((row) => row.id === mood);
}

/** One byte per code: 1 where `has` holds of the row. */
export function flagsOf<R extends Row>(rows: readonly R[], has: (row: R) => boolean): Uint8Array {
  return Uint8Array.from(rows, (row) => (has(row) ? 1 : 0));
}
