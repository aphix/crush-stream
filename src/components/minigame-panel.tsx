import { useState } from "react";
import { createPortal } from "react-dom";
import { Ellipsis } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Sheet } from "@/components/sheet";
import type { MinigameMode } from "@/game/scenes/minigame-constants";
import type { MinigameHudState } from "@/game/scenes/minigame-session";
import { bailControlName } from "@/game/hud/bail-prompt";
import type { PadFamily } from "@/game/vehicle/gamepad";
import { minigamePanelView, type MinigamePanelView } from "@/components/minigame-panel-view";
import { cn } from "@/lib/utils";

const RIG_BUTTON = "h-11 px-2 text-xs pointer-fine:h-7";

type MinigameCommands = {
  onRetry: () => void;
  onResetRun: () => void;
  onPickMode: (mode: MinigameMode) => void;
  onSetThrowsPerSet: (count: number) => void;
  onExit: () => void;
};

/** The readings: the throw counter, the live value or the score, the hint, the bail's prompt and timing, the set's scores and bests. Both cards draw them. */
function Readings({ view }: { view: MinigamePanelView }) {
  return (
    <>
      {view.throwCounter === null ? null : <p className="font-display text-xs tabular-nums text-muted">{view.throwCounter}</p>}
      {view.live === null && view.score !== null ? null : (
        <p className="font-display text-xl font-semibold leading-none tabular-nums" role="status">
          {view.live ?? "–"}
        </p>
      )}
      {view.score === null ? null : (
        <p className="font-display text-xl font-semibold tabular-nums">
          Score <span className="text-2xl">{view.score}</span>
        </p>
      )}
      {view.scoreHint === null ? null : <p className="font-display text-xs text-muted">{view.scoreHint}</p>}
      {view.bailResult === null ? null : (
        <p className="font-display text-xs font-semibold" role="status" aria-label="Bail timing">
          {view.bailResult}
        </p>
      )}
      {view.bailPrompt === null ? null : <p className="font-display text-xs text-accent">{view.bailPrompt}</p>}
      {view.setScores === null ? null : <p className="truncate font-display text-xs tabular-nums text-muted">{view.setScores}</p>}
      {view.total === null ? null : (
        <p className="font-display text-xs tabular-nums text-muted">
          {view.totalLabel}: {view.total}
        </p>
      )}
      <p className="font-display text-xs tabular-nums text-muted">
        Best (this car) {view.bestThisCar} · Best (all) {view.bestOverall}
      </p>
    </>
  );
}

/** The buttons: retry / reset, the other modes, the set length stepper, Exit. The desktop card has them under the readings, a phone's sheet is made of them. */
function Actions({ view, commands, buttonClass }: { view: MinigamePanelView; commands: MinigameCommands; buttonClass: string }) {
  const stepper = view.stepper;
  return (
    <>
      <div className="grid grid-cols-2 gap-1">
        <Button className={buttonClass} disabled={!view.retryEnabled} onClick={commands.onRetry}>
          {view.retryLabel}
        </Button>
        <Button className={buttonClass} variant="secondary" disabled={!view.resetEnabled} onClick={commands.onResetRun}>
          Reset run
        </Button>
        {view.otherModes.map(({ mode, label }) => (
          <Button key={mode} className={buttonClass} variant="ghost" onClick={() => commands.onPickMode(mode)}>
            {label}
          </Button>
        ))}
      </div>
      {stepper === null ? null : (
        <div className="flex items-center justify-between gap-1">
          <span className="hud-label">Throws per set</span>
          <Button className={buttonClass} variant="secondary" disabled={!stepper.canDecrease} aria-label="Fewer throws per set" onClick={() => commands.onSetThrowsPerSet(stepper.value - 1)}>
            -
          </Button>
          <span className="font-display text-sm tabular-nums">{stepper.value}</span>
          <Button className={buttonClass} variant="secondary" disabled={!stepper.canIncrease} aria-label="More throws per set" onClick={() => commands.onSetThrowsPerSet(stepper.value + 1)}>
            +
          </Button>
        </div>
      )}
      <Button className={cn(buttonClass, "w-full")} variant="ghost" onClick={commands.onExit}>
        Exit
      </Button>
    </>
  );
}

/**
 * The Range minigame card. On a desktop it is the full card: the reading, bests and every button. On a phone it is a few lines that stay
 * out of the road: the title and the reading (the score once scored), the bail's prompt, and, once scored, Retry and Reset run; every
 * other command (the other modes, the set length, Exit) sits in a sheet behind the 44 px menu button, and the card fades while the player
 * drives (`calm:`). The engine's commands arrive as props.
 */
export function MinigamePanel({
  state,
  padFamily,
  touch,
  ...commands
}: {
  state: MinigameHudState;
  /** The connected pad's family and whether this is a touch screen: which control the bail prompt names. */
  padFamily: PadFamily | null;
  touch: boolean;
} & MinigameCommands) {
  const view = minigamePanelView(state, bailControlName(padFamily, touch));
  const [sheetOpen, setSheetOpen] = useState(false);
  if (!touch) {
    return (
      <div className="hud-panel pointer-events-auto w-48 space-y-1 p-2" role="group" aria-label={view.title}>
        <p className="hud-label">{view.title}</p>
        <Readings view={view} />
        <Actions view={view} commands={commands} buttonClass={RIG_BUTTON} />
      </div>
    );
  }
  // A command from the sheet closes it, so the player is back on the view at once.
  const closing = (run: () => void) => () => {
    setSheetOpen(false);
    run();
  };
  const sheetCommands: MinigameCommands = {
    onRetry: closing(commands.onRetry),
    onResetRun: closing(commands.onResetRun),
    onPickMode: (mode) => closing(() => commands.onPickMode(mode))(),
    onSetThrowsPerSet: commands.onSetThrowsPerSet,
    onExit: closing(commands.onExit),
  };
  return (
    <>
      <div className="hud-panel pointer-events-auto w-52 p-2 calm:opacity-35 hud-fade" role="group" aria-label={view.title}>
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">
            <p className="hud-label">{view.title}</p>
            <p className="truncate font-display text-lg font-semibold leading-tight tabular-nums" role="status">
              {view.score === null ? (view.live ?? "–") : `Score ${view.score}`}
            </p>
          </div>
          <Button className="shrink-0" size="icon" variant="ghost" aria-label="Mini game menu" onClick={() => setSheetOpen(true)}>
            <Ellipsis />
          </Button>
        </div>
        {view.bailPrompt === null ? null : <p className="font-display text-xs text-accent">{view.bailPrompt}</p>}
        {view.bailResult === null ? null : (
          <p className="font-display text-xs font-semibold" role="status" aria-label="Bail timing">
            {view.bailResult}
          </p>
        )}
        {view.retryEnabled ? (
          <div className="mt-1 grid grid-cols-2 gap-1">
            <Button className="h-11 px-2 text-xs" onClick={commands.onRetry}>
              {view.retryLabel}
            </Button>
            <Button className="h-11 px-2 text-xs" variant="secondary" disabled={!view.resetEnabled} onClick={commands.onResetRun}>
              Reset run
            </Button>
          </div>
        ) : null}
      </div>
      {sheetOpen
        ? // Portaled: the card sits in a scrolling column, whose box would otherwise be what the sheet fills.
          createPortal(
            <div className="fixed inset-0 z-50">
              <Sheet title={view.title} edge="dock" onClose={() => setSheetOpen(false)}>
                <div className="space-y-2 pb-2 pr-2">
                  <Readings view={view} />
                  <Actions view={view} commands={sheetCommands} buttonClass="h-12 px-2 text-sm" />
                </div>
              </Sheet>
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
