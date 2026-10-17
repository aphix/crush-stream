import { useState } from "react";
import { ChevronDown, ChevronUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { MinigameMode } from "@/game/scenes/minigame-constants";
import type { MinigameHudState } from "@/game/scenes/minigame-session";
import { bailControlName } from "@/game/hud/bail-prompt";
import type { PadFamily } from "@/game/vehicle/gamepad";
import { minigamePanelCompact, minigamePanelView } from "@/components/minigame-panel-view";

const RIG_BUTTON = "h-11 px-2 text-xs pointer-fine:h-7";

/**
 * The Range minigame card: the mode's reading, score, bests and the retry / reset / switch / exit buttons. The engine's commands arrive as props.
 * A touch screen shows it short (the reading and the bail prompt) while the attempt is under way, so the card stays off the road and the car;
 * the More button opens it in place, and a scored attempt opens it to Retry.
 */
export function MinigamePanel({
  state,
  padFamily,
  touch,
  onRetry,
  onResetRun,
  onPickMode,
  onSetThrowsPerSet,
  onExit,
}: {
  state: MinigameHudState;
  /** The connected pad's family and whether this is a touch screen: which control the bail prompt names. */
  padFamily: PadFamily | null;
  touch: boolean;
  onRetry: () => void;
  onResetRun: () => void;
  onPickMode: (mode: MinigameMode) => void;
  onSetThrowsPerSet: (count: number) => void;
  onExit: () => void;
}) {
  const view = minigamePanelView(state, bailControlName(padFamily, touch));
  const stepper = view.stepper;
  // The phase the player last flipped the card in: the flip lapses when the phase changes, with no effect to reset it.
  const [toggledPhase, setToggledPhase] = useState<MinigameHudState["phase"] | null>(null);
  const toggled = toggledPhase === state.phase;
  const compact = touch && minigamePanelCompact(state.phase, toggled);
  const toggle = touch ? (
    <Button
      className="shrink-0"
      size="icon"
      variant="ghost"
      aria-expanded={!compact}
      aria-label={compact ? "More" : "Less"}
      onClick={() => setToggledPhase(toggled ? null : state.phase)}
    >
      {compact ? <ChevronDown /> : <ChevronUp />}
    </Button>
  ) : null;
  if (compact) {
    return (
      <div className="hud-panel pointer-events-auto w-52 p-2" role="group" aria-label={view.title}>
        <div className="flex items-center justify-between gap-1">
          <div className="min-w-0">
            <p className="hud-label">{view.title}</p>
            <p className="truncate font-display text-lg font-semibold leading-tight tabular-nums" role="status">
              {view.score === null ? (view.live ?? "–") : `Score ${view.score}`}
            </p>
          </div>
          {toggle}
        </div>
        {view.bailPrompt === null ? null : <p className="font-display text-xs text-accent">{view.bailPrompt}</p>}
        {view.bailResult === null ? null : (
          <p className="font-display text-xs font-semibold" role="status" aria-label="Bail timing">
            {view.bailResult}
          </p>
        )}
      </div>
    );
  }
  return (
    <div className="hud-panel pointer-events-auto w-48 space-y-1 p-2 pointer-coarse:max-h-[50dvh] pointer-coarse:w-52 pointer-coarse:overflow-y-auto pointer-coarse:overscroll-contain" role="group" aria-label={view.title}>
      {toggle === null ? (
        <p className="hud-label">{view.title}</p>
      ) : (
        <div className="flex items-center justify-between gap-1">
          <p className="hud-label">{view.title}</p>
          {toggle}
        </div>
      )}
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
      <div className="grid grid-cols-2 gap-1">
        <Button className={RIG_BUTTON} disabled={!view.retryEnabled} onClick={onRetry}>
          {view.retryLabel}
        </Button>
        <Button className={RIG_BUTTON} variant="secondary" disabled={!view.resetEnabled} onClick={onResetRun}>
          Reset run
        </Button>
        {view.otherModes.map(({ mode, label }) => (
          <Button key={mode} className={RIG_BUTTON} variant="ghost" onClick={() => onPickMode(mode)}>
            {label}
          </Button>
        ))}
      </div>
      {stepper === null ? null : (
        <div className="flex items-center justify-between gap-1 pointer-coarse:flex-wrap">
          <span className="hud-label pointer-coarse:w-full">Throws per set</span>
          <Button className={RIG_BUTTON} variant="secondary" disabled={!stepper.canDecrease} aria-label="Fewer throws per set" onClick={() => onSetThrowsPerSet(stepper.value - 1)}>
            -
          </Button>
          <span className="font-display text-sm tabular-nums">{stepper.value}</span>
          <Button className={RIG_BUTTON} variant="secondary" disabled={!stepper.canIncrease} aria-label="More throws per set" onClick={() => onSetThrowsPerSet(stepper.value + 1)}>
            +
          </Button>
        </div>
      )}
      <Button className={`${RIG_BUTTON} w-full`} variant="ghost" onClick={onExit}>
        Exit
      </Button>
    </div>
  );
}
