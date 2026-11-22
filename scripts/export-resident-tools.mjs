// Writes the resident spine and the thought tools as tool-calling JSON (the shape Needle and other routers read), beside the Minds:
//   src/game/present/minds/resident-spine.tools.json     every purpose, activity and event kind of the spine, one tool each
//   src/game/present/minds/resident-thoughts.tools.json  the thought tools the Minds give Needle
// Run after the spine or the thoughts change: `node scripts/export-resident-tools.mjs`. A test fails while the files differ from a fresh build.
import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { ACTIVITIES, EVENT_KINDS, NEEDS, PURPOSES } from "../src/game/ai/civilians/resident-spine.ts";
import { thoughtTools } from "../src/game/present/minds/thought-tools.ts";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const OUT = join(ROOT, "src/game/present/minds");
export const SPINE_FILE = join(OUT, "resident-spine.tools.json");
export const THOUGHTS_FILE = join(OUT, "resident-thoughts.tools.json");

const RESIDENT = { type: "integer", description: "The resident's index in the city." };
const SECONDS = { type: "number", description: "Crowd seconds (a game minute each) when it happens." };

function tool(name, description, properties) {
  return { name, description, parameters: { type: "object", properties, required: Object.keys(properties) } };
}

/** A purpose's facts the brain acts on, as words after its description. */
function purposeFacts(row) {
  const facts = [row.outdoor ? "ends standing outdoors" : "ends at a door", row.drive ? "may take the car" : "on foot"];
  return `${row.about} (${facts.join(", ")}). Launched by ${row.launch.join(", ")}.`;
}

/** The spine as tools, sorted by name: `purpose_*` (a leg a resident walks), `activity_*` (what she is drawn doing), `event_*` (a host input event). */
export function spineTools() {
  const tools = [
    ...[...Object.entries(NEEDS), ...Object.entries(PURPOSES)].map(([id, row]) => tool(`purpose_${id}`, `${row.label}: ${purposeFacts(row)}`, { resident: RESIDENT })),
    ...Object.entries(ACTIVITIES).map(([id, row]) => tool(`activity_${id}`, `${row.about}${row.clip > 0 ? ` (a ${row.clip} s clip)` : ""}. Read by ${row.launch.join(", ")}.`, { resident: RESIDENT })),
    ...Object.entries(EVENT_KINDS).map(([id, row]) => tool(`event_${id}`, `${row.about}.${row.brain.length > 0 ? ` Applied by ${row.brain.join(", ")}.` : ""}`, { subject: RESIDENT, seconds: SECONDS })),
  ];
  return tools.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
}

/** The text of each file, as written. */
export function residentToolFiles() {
  return { [SPINE_FILE]: `${JSON.stringify(spineTools(), null, 2)}\n`, [THOUGHTS_FILE]: `${JSON.stringify(thoughtTools(), null, 2)}\n` };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [file, text] of Object.entries(residentToolFiles())) writeFileSync(file, text);
}
