import { useState } from "react";
import { ChevronDown, ChevronUp, Play, SlidersHorizontal } from "lucide-react";
import { BenchEntry } from "@/components/bench-controls";
import { CreditsDialog } from "@/components/credits-dialog";
import type { HudProps } from "@/components/hud";
import { homeModes, pickScene, sceneInPlay, TEST_RIGS } from "@/components/scene-picks";
import { Sheet } from "@/components/sheet";
import { FullscreenButton } from "@/components/touch-controls";
import { Button } from "@/components/ui/button";
import type { SceneId } from "@/game/scenes/scene-id";
import { cn } from "@/lib/utils";

/** A mode card: big enough to hit with a thumb at a glance. */
const MODE_CARD = "h-24 flex-col gap-1 font-display text-lg font-semibold";
/** A row of the Home sheet that is not a mode card: Free play, the Test rigs fold, a test rig. */
const ROW_BUTTON = "h-12 text-sm";
/** The right-hand buttons: the commands, one size up from a row. */
const COMMAND_BUTTON = "h-14 text-base";
/** The Benchmark chip is the dock's (`bench-controls.tsx`, 40 px tall, 28 px past 640 px wide): it is brought up to a thumb here. */
const BENCH_AS_CHIP = "[&_button]:h-11 [&_button]:px-3";

/**
 * The phone's Home menu, a full-screen sheet: the game modes as big cards (the one in play pressed), Fleet as "Free play", the test rigs
 * folded away, and the commands (Settings, Fullscreen, Credits, Resume) in a column beside them on a phone on its side, below them upright.
 * Picking a mode runs its toggle and closes the sheet; the dock's chips (desktop) run the same toggles from the same list (`scene-picks.ts`).
 */
export function HomeSheet({ state, engine, onClose, onOpenSettings }: Pick<HudProps, "state" | "engine"> & { onClose: () => void; onOpenSettings: () => void }) {
  const [rigsOpen, setRigsOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  // A pick in its fade lights its target at once, so the card pressed is the one the player just chose.
  const inPlay = state.pendingScene ?? sceneInPlay(state);
  const pick = (id: SceneId): void => {
    pickScene(engine, inPlay, id);
    onClose();
  };
  return (
    <Sheet edge="full" title="Menu" onClose={onClose}>
      <div className="flex flex-col gap-3 pb-2 pr-2 landscape:flex-row landscape:items-start">
        <div className="flex min-w-0 flex-1 flex-col gap-2">
          <div className="grid grid-cols-2 gap-2 landscape:grid-cols-3" role="group" aria-label="Mode">
            {homeModes(state.inRoom).map(({ id, label, aria, tone }) => (
              <Button key={id} variant="ghost" aria-pressed={inPlay === id} aria-label={aria} className={cn(MODE_CARD, tone, tone && "scene-chip")} onClick={() => pick(id)}>
                {label}
              </Button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <Button variant={inPlay === "fleet" ? "default" : "secondary"} aria-pressed={inPlay === "fleet"} aria-label="Fleet scene: free play" className={ROW_BUTTON} onClick={() => pick("fleet")}>
              Free play
            </Button>
            <Button variant="secondary" aria-expanded={rigsOpen} className={ROW_BUTTON} onClick={() => setRigsOpen(!rigsOpen)}>
              Test rigs
              {rigsOpen ? <ChevronUp /> : <ChevronDown />}
            </Button>
          </div>
          {rigsOpen ? (
            <div className="flex flex-wrap gap-2" role="group" aria-label="Test rigs">
              {TEST_RIGS.map(({ id, label, aria }) => (
                <Button key={id} variant={inPlay === id ? "default" : "ghost"} aria-pressed={inPlay === id} aria-label={aria} className="h-11 px-3 text-xs" onClick={() => pick(id)}>
                  {label}
                </Button>
              ))}
              {state.inRoom ? null : (
                <div className={BENCH_AS_CHIP}>
                  <BenchEntry />
                </div>
              )}
            </div>
          ) : null}
        </div>
        <div className="flex shrink-0 flex-col gap-2 landscape:w-56">
          <Button variant="secondary" className={COMMAND_BUTTON} onClick={onOpenSettings}>
            <SlidersHorizontal />
            Settings
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" className={cn(COMMAND_BUTTON, "flex-1")} onClick={() => setCreditsOpen(true)}>
              Credits
            </Button>
            {/* Hidden where the browser has no Fullscreen API (iPhone Safari): Credits then has the row. */}
            <FullscreenButton className="h-14 w-14 shrink-0 [&_svg]:size-5" />
          </div>
          <Button className={COMMAND_BUTTON} onClick={onClose}>
            <Play />
            Resume
          </Button>
        </div>
      </div>
      <CreditsDialog open={creditsOpen} onClose={() => setCreditsOpen(false)} />
    </Sheet>
  );
}
