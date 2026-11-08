import { MAP_CHOICES, ULTRA_AVAILABLE, type BenchOptions, type BenchRun } from "./bench-loop.ts";
import { BENCH_BUTTON_STYLE, BENCH_CARD_STYLE } from "./constants.ts";

/** A phone's touch target (Apple's HIG minimum), so each option is one sure tap. */
const TOUCH_TARGET_PX = 44;

const TOGGLE_STYLE = `${BENCH_BUTTON_STYLE};display:block;width:100%;min-height:${TOUCH_TARGET_PX}px;text-align:left;font-size:13px`;
const TOGGLE_OFF_STYLE = "border-color:#56606e;background:#1c2530;color:#9aa6b5";
/** The maps' toggles sit two to a row; the margin of a toggle's right is the grid's gap. */
const MAPS_GRID_STYLE = "display:grid;grid-template-columns:1fr 1fr;gap:0 6px";
const MAP_TOGGLE_STYLE = `${TOGGLE_STYLE};margin-right:0;min-width:0`;

/** Each option's label, in the order the chooser lists them; Ultra only where the build has it. */
const LABELS: readonly (readonly [Exclude<keyof BenchOptions, "maps">, string])[] = [
  ["extended", "Extended: A/B blocks and the replay on every page; with Epicenter, every map whole, then epicenter"],
  ["keep", "Loop: run again after the last map"],
  ["epi", "Epicenter: every map runs its epicenter arm"],
  ...(ULTRA_AVAILABLE ? [["ultra", "Ultra: Ultra FX on every page"] as const] : []),
];

/** A toggle button: its text and look follow `isOn`, a tap runs `flip` and shows it again. */
function toggleButton(label: string, style: string, isOn: () => boolean, flip: () => void): HTMLButtonElement {
  const toggle = document.createElement("button");
  toggle.type = "button";
  const show = (): void => {
    toggle.textContent = `${isOn() ? "\u2611" : "\u2610"} ${label}`;
    toggle.setAttribute("aria-pressed", String(isOn()));
    toggle.style.cssText = isOn() ? style : `${style};${TOGGLE_OFF_STYLE}`;
  };
  toggle.onclick = () => {
    flip();
    show();
  };
  show();
  return toggle;
}

/**
 * The chooser before a new loop: a toggle for each option and each map (as `run` offers them: all options on unless its address says otherwise, its maps picked) and Start; resolves to the choice on Start.
 * The maps come back in the chooser's order, which is the cycle's; Start waits while none is picked.
 */
export async function chooseOptions(run: BenchRun): Promise<BenchOptions> {
  const choice: Omit<BenchOptions, "maps"> = { keep: run.keep, epi: run.epi, ultra: run.ultra, extended: run.extended };
  const picked = new Set(run.maps);
  const root = document.createElement("div");
  root.style.cssText = `${BENCH_CARD_STYLE};pointer-events:auto;width:min(420px,calc(100vw - 16px))`;
  const title = document.createElement("div");
  title.textContent = "Benchmark: these hold for the whole run";
  root.append(title);
  for (const [name, label] of LABELS) {
    root.append(toggleButton(label, TOGGLE_STYLE, () => choice[name], () => void (choice[name] = !choice[name])));
  }
  const start = document.createElement("button");
  const mapsTitle = document.createElement("div");
  mapsTitle.style.cssText = "margin-top:8px";
  mapsTitle.textContent = "Maps: each runs in this order";
  const grid = document.createElement("div");
  grid.style.cssText = MAPS_GRID_STYLE;
  for (const { id, label } of MAP_CHOICES) {
    const flip = (): void => {
      if (!picked.delete(id)) picked.add(id);
      start.disabled = picked.size === 0;
    };
    grid.append(toggleButton(label, MAP_TOGGLE_STYLE, () => picked.has(id), flip));
  }
  root.append(mapsTitle, grid);
  start.type = "button";
  start.textContent = "Start \u25B6";
  start.style.cssText = `${TOGGLE_STYLE};text-align:center;font-weight:bold;margin-top:10px`;
  root.append(start);
  document.body.append(root);
  await new Promise<void>((resolve) => {
    start.onclick = () => resolve();
  });
  root.remove();
  return { ...choice, maps: MAP_CHOICES.filter((m) => picked.has(m.id)).map((m) => m.id) };
}
