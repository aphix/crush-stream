import { ULTRA_AVAILABLE, type BenchOptions, type BenchRun } from "./bench-loop.ts";
import { BENCH_BUTTON_STYLE, BENCH_CARD_STYLE } from "./constants.ts";

/** A phone's touch target (Apple's HIG minimum), so each option is one sure tap. */
const TOUCH_TARGET_PX = 44;

const TOGGLE_STYLE = `${BENCH_BUTTON_STYLE};display:block;width:100%;min-height:${TOUCH_TARGET_PX}px;text-align:left;font-size:13px`;
const TOGGLE_OFF_STYLE = "border-color:#56606e;background:#1c2530;color:#9aa6b5";

/** Each option's label, in the order the chooser lists them; Ultra only where the build has it. */
const LABELS: readonly (readonly [keyof BenchOptions, string])[] = [
  ["extended", "Extended: A/B blocks and the replay on every page; with Epicenter, every map whole, then epicenter"],
  ["keep", "Loop: run again after the last map"],
  ["epi", "Epicenter: every map runs its epicenter arm"],
  ...(ULTRA_AVAILABLE ? [["ultra", "Ultra: Ultra FX on every page"] as const] : []),
];

/** The chooser before a new loop: a toggle for each option (as `run` offers them: all on unless its address says otherwise) and Start; resolves to the choice on Start. */
export async function chooseOptions(run: BenchRun): Promise<BenchOptions> {
  const choice: BenchOptions = { keep: run.keep, epi: run.epi, ultra: run.ultra, extended: run.extended };
  const root = document.createElement("div");
  root.style.cssText = `${BENCH_CARD_STYLE};pointer-events:auto;width:min(420px,calc(100vw - 16px))`;
  const title = document.createElement("div");
  title.textContent = "Benchmark: these hold for the whole run";
  root.append(title);
  for (const [name, label] of LABELS) {
    const toggle = document.createElement("button");
    toggle.type = "button";
    const show = (): void => {
      toggle.textContent = `${choice[name] ? "\u2611" : "\u2610"} ${label}`;
      toggle.setAttribute("aria-pressed", String(choice[name]));
      toggle.style.cssText = choice[name] ? TOGGLE_STYLE : `${TOGGLE_STYLE};${TOGGLE_OFF_STYLE}`;
    };
    toggle.onclick = () => {
      choice[name] = !choice[name];
      show();
    };
    show();
    root.append(toggle);
  }
  const start = document.createElement("button");
  start.type = "button";
  start.textContent = "Start \u25B6";
  start.style.cssText = `${TOGGLE_STYLE};text-align:center;font-weight:bold;margin-top:10px`;
  root.append(start);
  document.body.append(root);
  await new Promise<void>((resolve) => {
    start.onclick = () => resolve();
  });
  root.remove();
  return choice;
}
