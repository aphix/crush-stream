import { z } from "zod";
import { PURPOSE_LABELS } from "../../ai/civilians/civilian-names.ts";
import { EVENT_KINDS, NEEDS, codesOf } from "../../ai/civilians/resident-spine.ts";
import { LOOK_WORDS } from "../civilian-gaze-constants.ts";
import { STIMULUS } from "../civilian-gaze.ts";

/** What a resident's mind may turn to: the model's closed tool set, keyed by the tool name the model sees; `arg` names the one argument (none for `ignore`). */
const THOUGHTS = {
  ignore: { about: "Carry on: nothing here is worth attention.", arg: null, argAbout: "" },
  look_at: { about: "Look at something nearby.", arg: "stimulus", argAbout: "The thing to look at." },
  worry_about: { about: "Worry about one of their needs.", arg: "need", argAbout: "The need." },
  remark_on: { about: "Talk about news from the neighbourhood.", arg: "event", argAbout: "The news." },
  think_about: { about: "Think about home, work, company or plans.", arg: "about", argAbout: "The subject." },
} as const;

export const THOUGHT = codesOf(THOUGHTS);

/** What `think_about` can be about; `line` is the panel's words. */
const THINK_ABOUT = {
  home: { about: "getting home", line: "Home soon." },
  work: { about: "their work", line: "Work again tomorrow." },
  company: { about: "the person with them", line: "Glad of the company." },
  plans: { about: "what they are off to do", line: "" },
} as const;

export const THINK = codesOf(THINK_ABOUT);

/** The stimulus kinds a thought may look at: what the gaze table holds of the world (not her own outside requests or idle glances). */
const LOOKABLE: readonly number[] = [STIMULUS.player, STIMULUS.car, STIMULUS.siren, STIMULUS.crash, STIMULUS.knock, STIMULUS.gunshot, STIMULUS.down, STIMULUS.person];

/** The event kinds a bystander remarks on: the spine's rows with a remark. */
const REMARKABLE: readonly number[] = Object.values(EVENT_KINDS).flatMap((row, kind) => (row.remark === null ? [] : [kind]));

/** What a pressing need sounds like in the panel, by need. */
const WORRY_LINES = {
  rest: "I need to lie down.",
  food: "I'm starving.",
  work: "Can't be late for work.",
  social: "I could do with some company.",
  errand: "So much to get done.",
  solitude: "I need some quiet.",
} as const satisfies Record<keyof typeof NEEDS, string>;

export const STIMULUS_IDS = Object.keys(STIMULUS);
export const EVENT_IDS = Object.keys(EVENT_KINDS);
export const NEED_IDS = Object.keys(NEEDS);
const THINK_IDS = Object.keys(THINK_ABOUT);

/** Each tool's argument values, as the model names them and as their codes (stimulus, need, event kind or `THINK`), in code order. */
const ARG_CODES: readonly (readonly number[])[] = [[], LOOKABLE, NEED_IDS.map((_, need) => need), REMARKABLE, THINK_IDS.map((_, about) => about)];
const ARG_NAMES: readonly (readonly string[])[] = [[], LOOKABLE.map((kind) => STIMULUS_IDS[kind]!), NEED_IDS, REMARKABLE.map((kind) => EVENT_IDS[kind]!), THINK_IDS];

/** The argument code the model's word names for tool `tool`, or -1 when the word is not one of its values. */
function argCodeOf(tool: number, word: string): number {
  const at = ARG_NAMES[tool]!.indexOf(word);
  return at < 0 ? -1 : ARG_CODES[tool]![at]!;
}

/** Whether `arg` is one of tool `tool`'s argument codes. */
export function isArgOf(tool: number, arg: number): boolean {
  return tool === THOUGHT.ignore ? arg === 0 : ARG_CODES[tool]!.includes(arg);
}

type ToolJson = { name: string; description: string; parameters: { type: "object"; properties: Record<string, { type: "string"; description: string; enum: readonly string[] }>; required: readonly string[] } };

/**
 * The thought tools as the model is given them, sorted by name, each with one string argument of closed values. `keep` narrows the values to
 * those that fit a moment (a tool left with none is dropped; `ignore` always stays), so the model can only pick something that is there.
 */
export function thoughtTools(keep: (tool: number, arg: number) => boolean = isArgOf): ToolJson[] {
  const tools: ToolJson[] = [];
  for (const [name, row] of Object.entries(THOUGHTS)) {
    const tool = THOUGHT[name as keyof typeof THOUGHTS];
    const kept = ARG_CODES[tool]!.flatMap((arg, at) => (keep(tool, arg) ? [ARG_NAMES[tool]![at]!] : []));
    if (row.arg !== null && kept.length === 0) continue;
    const properties = row.arg === null ? {} : { [row.arg]: { type: "string" as const, description: row.argAbout, enum: kept } };
    tools.push({ name, description: row.about, parameters: { type: "object", properties, required: row.arg === null ? [] : [row.arg] } });
  }
  return tools.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

function quoted(text: string): string {
  return `Thinks "${text}"`;
}

/** The panel's line for every (tool, argument code), built once; `plans` lines by purpose. */
const LINES: readonly (readonly string[])[] = [
  [quoted("Minding my own business.")],
  STIMULUS_IDS.map((_, kind) => quoted(`What's going on with ${LOOK_WORDS[kind]}?`)),
  Object.values(WORRY_LINES).map(quoted),
  Object.values(EVENT_KINDS).map((row) => quoted(`Did you see ${row.remark ?? "that"}?`)),
  Object.values(THINK_ABOUT).map((row) => quoted(row.line)),
];
const PLANS_LINES: readonly string[] = PURPOSE_LABELS.map((label) => quoted(`Off for ${label}.`));

/** The look-at panel's line for thought (tool, arg) of someone on purpose `purpose` (-1: none). */
export function thoughtLine(tool: number, arg: number, purpose: number): string {
  if (tool === THOUGHT.think_about && arg === THINK.plans) return PLANS_LINES[purpose] ?? LINES[THOUGHT.ignore]![0]!;
  return LINES[tool]![arg] ?? LINES[THOUGHT.ignore]![0]!;
}

/** What became of a model's answer: taken, a deliberate "no tool" (`[]`), rejected (the fallback stands: `absent` names a thought that does not fit the moment), or too late. */
export const VERDICT = { taken: 0, abstained: 1, malformed: 2, unknownTool: 3, badArgs: 4, absent: 5, late: 6 } as const;

/** A picked thought: a `THOUGHT` tool and its argument code. */
export class Thought {
  tool: number = THOUGHT.ignore;
  arg = 0;
}

const CALL_OPEN = "<tool_call>";
const ABSTAIN = "[]";
/** The first whole call in a payload: Needle often lists more calls than asked for and runs out of tokens inside a later one. Thought arguments are flat, so no `{` nests inside. */
const FIRST_CALL = /\{\s*"name"\s*:\s*"[^"]*"\s*,\s*"arguments"\s*:\s*\{[^{}]*\}\s*\}/;

/** One call as the model writes it: a tool name and its arguments. */
const callSchema = z.object({ name: z.string(), arguments: z.record(z.string(), z.unknown()) });

function parsed(payload: string): unknown {
  try {
    return JSON.parse(payload);
  } catch (err) {
    if (err instanceof SyntaxError) return undefined;
    throw err;
  }
}

/** Reads the first call of a model's completion into `out` when it names a thought tool with exactly its one closed argument; else says why not (`VERDICT`). */
export function readCall(completion: string, out: Thought): number {
  const open = completion.lastIndexOf(CALL_OPEN);
  const payload = open < 0 ? completion : completion.slice(open + CALL_OPEN.length);
  if (payload.trimStart().startsWith(ABSTAIN)) return VERDICT.abstained;
  const first = FIRST_CALL.exec(payload);
  const read = callSchema.safeParse(first === null ? undefined : parsed(first[0]));
  if (!read.success) return VERDICT.malformed;
  const call = read.data;
  if (!Object.hasOwn(THOUGHTS, call.name)) return VERDICT.unknownTool;
  // The cast holds: `hasOwn` just found the name among THOUGHTS' keys.
  const name = call.name as keyof typeof THOUGHTS;
  const argName = THOUGHTS[name].arg;
  const word = argName === null ? null : call.arguments[argName];
  if (Object.keys(call.arguments).length !== (argName === null ? 0 : 1) || (argName !== null && typeof word !== "string")) return VERDICT.badArgs;
  const tool = THOUGHT[name];
  const arg = typeof word === "string" ? argCodeOf(tool, word) : 0;
  if (arg < 0) return VERDICT.badArgs;
  out.tool = tool;
  out.arg = arg;
  return VERDICT.taken;
}
