import { Fragment, useEffect, useRef, useState, type RefObject } from "react";
import * as Popover from "@radix-ui/react-popover";
import { BrickWall, CircleDot, CircleHelp, Menu, Pause, Play, RotateCcw, SlidersHorizontal, TriangleRight, Video } from "lucide-react";
import { DerbyBoard, DoorPanel, LabPanel, MinigamePick, PistonPanel, RangePanel, StackPanel } from "@/components/hud-panels";
import { CreditsDialog } from "@/components/credits-dialog";
import { GaragePanel } from "@/components/garage-panel";
import { HudSections } from "@/components/hud-sections";
import { HomeSheet } from "@/components/home-sheet";
import { RaceOverlay, RaceStandings, RaceViewToggle, SpectateBar } from "@/components/race-hud";
import { BenchEntry } from "@/components/bench-controls";
import { OnlineEntry } from "@/components/online-entry";
import { Gauge, RaceReadouts } from "@/components/race-readouts";
import { RaceStatus } from "@/components/race-status";
import { SoloExit } from "@/components/race-reel";
import { DriftLabel, DriftOverlay } from "@/components/drift-charge";
import { RESET_GLOW, ResetPrompt } from "@/components/reset-prompt";
import { pickScene, sceneInPlay, sceneLabel, scenesFor } from "@/components/scene-picks";
import { StartLights } from "@/components/start-lights";
import { FullscreenButton, MouseLookButton, TouchControls } from "@/components/touch-controls";
import { useCoarsePointer } from "@/components/use-coarse-pointer";
import { useSpeedUnit } from "@/components/use-speed-unit";
import { useStoredString } from "@/components/use-stored-string";
import { useTouchScheme } from "@/components/use-touch-scheme";
import { Button } from "@/components/ui/button";
import type { CrashEngine } from "@/game/engine/engine";
import { SCENE_KEY_BINDINGS } from "@/game/engine/engine-keys";
import { audioLevels } from "@/game/hud/audio-levels";
import { driveKeys } from "@/game/hud/drive-keys";
import { freeHelp } from "@/game/hud/free-help";
import { watchCalm, type CalmWatch } from "@/game/hud/hud-collapse";
import { resetGlow, resetInput, type ResetInput } from "@/game/hud/reset-prompt";
import { netDeepLink } from "@/game/hud/share-url";
import { KPH_PER_MS } from "@/game/kernel/constants";
import { PAD_BUTTON } from "@/game/vehicle/gamepad";
import type { CrashHudState } from "@/game/hud/hud-store";
import { formatSpeed } from "@/game/hud/speed-units";
import type { RaceCommand } from "@/game/match/types";
import { benchHoldsCommand } from "@/game/hud/submit-rules";
import { MinigamePanel } from "@/components/minigame-panel";
import { cn } from "@/lib/utils";

export type HudProps = {
  state: CrashHudState;
  /** The engine once booted (null before): controls call it directly. */
  engine: RefObject<CrashEngine | null>;
  /** Whether the online entry shows (not on a `?bench=` page). */
  onlineShown: boolean;
};

/** What `Hud` works out once for both layouts (`DesktopHud` keeps the bar and the grid areas, `PhoneHud` the corner pieces). */
type HudShell = {
  hud: HudProps;
  /** The control the player resets with now (null: none on screen). */
  reset: ResetInput | null;
  raceCommand: (cmd: RaceCommand) => void;
  /** The prompt's tap: presses the thumb pad's reset button (D-pad down). */
  tapReset: () => void;
  /** Race focus view: race panels only; the sandbox HUD comes back with the Full menu toggle (H), which a phone has none of. */
  focus: boolean;
};

const PHASE: Record<CrashHudState["phase"], string> = {
  approach: "Approach",
  impact: "Impact",
  slowmo: "Slow-mo",
  aftermath: "Aftermath",
};

const STAGE: Record<CrashHudState["compactStage"], string> = {
  open: "open",
  contact: "crush zone",
  wells: "wheel wells",
  mid: "past hubs",
  max: "max crush",
};

/** Camera names: the drive views and the spectator cams. */
const CAM_LABEL: Record<NonNullable<CrashHudState["cam"]>, string> = { third: "Chase cam", far: "Far chase", first: "Hood cam", cine: "Trackside", dutch: "Wheel cam", orbit: "Orbit", auto: "Auto", free: "Free fly" };

const SCENE_KEYS: [string, string][] = [
  ["Space", "Pause / play"],
  ["R", "Reset"],
  ["L", "Loop"],
  ...SCENE_KEY_BINDINGS.map((binding): [string, string] => [binding.label, sceneLabel(binding.scene)]),
  ["H", "In a race: race view · full menu"],
  ["1–8 · 0", "Fire ram · all"],
  ["1–3 · 4 · 5 · 6 · 7", "Door ram A–C · open · side · panel D · E"],
  ["B", "Wall"],
  ["K", "Balls"],
  [".", "Ramps"],
  ["M", "Slow-mo"],
  ["O", "Orbit"],
  ["U", "Audio"],
  ["Y", "Shape / lattice"],
  ["G", "Rig"],
  ["P", "Particles"],
  ["J", "JSON capture"],
  ["\\", "Stats overlay"],
];

const CAMERA_KEYS: [string, string][] = [
  ["Click · Q / E", "Follow a car"],
  ["W A S D", "Take the wheel"],
  ["Esc", "Step back out"],
  ["` (hold)", "Look back"],
  ["Drag · scroll", "Orbit camera"],
  [";", "Mouse look (Esc ends it)"],
  ["V", "Camera view (also C, T): chase, far, hood / trackside, wheel, orbit, auto, free fly"],
  ["Free fly · V", "Detached camera: W A S D · PgUp / PgDn up, down · Shift fast · wheel speed · drag look · V or Esc back"],
];

function seatHint(state: CrashHudState): { title: string; keys: string } {
  if (state.race && state.seat === "drive") {
    return {
      title: `Racing · ${CAM_LABEL[state.view]}`,
      keys: state.pad
        ? "RT gas · LT brake, then reverse · left stick steer · X handbrake · A boost · Y view · R3 look back · D-pad ↓ respawn · hold D-pad ↓ back on the road, damage kept · Start pause"
        : "W gas · S brake, then reverse · A/D steer · Space handbrake · Shift boost · V view · ` look back · R respawn · hold R back on the road, damage kept · Esc pause",
    };
  }
  if (state.seat === "drive") {
    return { title: `Driving · ${CAM_LABEL[state.view]}`, keys: driveKeys(state.pad !== null, state.minigame?.bail == null) };
  }
  if (state.cam === "free") return { title: `${state.seat === "global" ? "Whole field" : "Watching"} · ${CAM_LABEL.free}`, keys: freeHelp(state.pad !== null, false) };
  if (state.seat === "follow") {
    return {
      title: state.cam ? `Watching · ${CAM_LABEL[state.cam]}` : "Watching",
      keys: state.pad
        ? "RT, LT or left stick to drive · LB/RB switch car · Y camera · right stick look · R3 look back · Back exit"
        : "W/A/S/D to drive · Q/E switch car · V camera · drag look · ` look back · Esc back",
    };
  }
  return { title: "Whole field", keys: "LB/RB to pick a car" };
}

export function Hud(props: HudProps) {
  const { state, engine, onlineShown } = props;
  // Phones and tablets get the thumb controls and the corner layout; a fine pointer keeps the desktop HUD as it was.
  const touch = useCoarsePointer();
  // What resets the driven car: the connected pad, the thumb pad's button, or R.
  const reset = resetInput(state.pad !== null, touch, state.seat === "drive");
  const raceCommand = (cmd: RaceCommand) => {
    if (!benchHoldsCommand(cmd, !onlineShown)) engine.current?.raceCommand(cmd);
  };
  // The prompt's tap presses the thumb pad's reset button (D-pad down).
  const tapReset = () => {
    const t = engine.current?.touch;
    if (t) t.tapped |= 1 << PAD_BUTTON.down;
  };
  // Race focus view: race panels only; the sandbox HUD comes back with the Full menu toggle (H). A phone has no such toggle, so its race is always the focus view.
  const focus = state.race !== null && (touch || !state.race.fullUi);
  // Solo view: one clip alone, full screen; the HUD is nothing but its exit.
  if (state.race?.solo != null) return <SoloExit title={state.race.solo} shown={state.race.shown} onCommand={raceCommand} />;
  const shell: HudShell = { hud: props, reset, raceCommand, tapReset, focus };
  return touch ? <PhoneHud {...shell} /> : <DesktopHud {...shell} />;
}

/** The scene's own panels: rig controls, the Range card and its Mini games pick, the Mini game card, the Lab, the garage and the derby board. Desktop hangs them in the context column, a phone in its left column. */
function ScenePanels({ state, engine, touch }: HudProps & { touch: boolean }) {
  // The Range's Mini games pick (one button per mode) opens from the range card and closes once a mode is picked.
  const [minigamePickOpen, setMinigamePickOpen] = useState(false);
  return (
    <>
      {state.showPistons ? <PistonPanel pistons={state.pistons} engine={engine} /> : null}
      {state.showDoors ? <DoorPanel doors={state.doors} engine={engine} /> : null}
      {state.stack ? <StackPanel stack={state.stack} engine={engine} /> : null}
      {state.range ? <RangePanel range={state.range} onOpenMinigames={() => setMinigamePickOpen((open) => !open)} /> : null}
      {state.range && minigamePickOpen ? <MinigamePick engine={engine} onPicked={() => setMinigamePickOpen(false)} /> : null}
      {state.minigame ? (
        <MinigamePanel
          state={state.minigame}
          padFamily={state.padFamily}
          touch={touch}
          onRetry={() => engine.current?.retryMinigame()}
          onResetRun={() => engine.current?.resetMinigameRun()}
          onPickMode={(mode) => engine.current?.startMinigame(mode)}
          onSetThrowsPerSet={(count) => engine.current?.setMinigameThrowsPerSet(count)}
          onExit={() => engine.current?.exitMinigame()}
        />
      ) : null}
      {state.lab ? <LabPanel lab={state.lab} engine={engine} /> : null}
      {state.garage ? <GaragePanel garage={state.garage} playerCar={state.playerCar} engine={engine} /> : null}
      {state.derby && state.derbyBoard.length > 0 ? <DerbyBoard board={state.derbyBoard} engine={engine} /> : null}
    </>
  );
}

/** The desktop and tablet-with-a-mouse HUD: the grid areas (title, readouts, context, settings, dock) with the always-visible bar. */
function DesktopHud({ hud, reset, raceCommand, tapReset, focus }: HudShell) {
  const { state, engine, onlineShown } = hud;
  // Wide screens show the (collapsed) sections; narrower windows start with the settings tucked away.
  const [settings, setSettings] = useStoredString("crush.hud.settings", "hidden", "shown");
  const settingsShown = settings === "shown";
  return (
    <div className="hud-grid pointer-events-none absolute inset-0 text-fg" data-focus={focus || undefined}>
      <div className="flex min-w-0 flex-col items-start max-sm:min-h-11" style={{ gridArea: "title" }}>
        {focus && state.race ? (
          <header className="hud-ink min-w-0 font-display">
            <p className="truncate text-sm font-semibold uppercase leading-tight tracking-[0.12em] text-fg/80">
              {state.race.survival || state.race.menu === "survival" ? "Survival" : state.race.mode === "campaign" ? "Campaign" : "Race"} · <span className="text-fg">{state.race.trackName || "Pick a course"}</span>
            </p>
          </header>
        ) : null}
        {/* The one online entry sits at the top left, under the race title when there is one. The solo clip view returned above; the results reel and bench pages have none. */}
        {onlineShown && state.race?.reel == null ? <OnlineEntry engine={engine} race={state.race} /> : null}
      </div>

      {state.race ? (
        <RaceReadouts race={state.race} corner={focus} />
      ) : state.derbyView ? (
        <div className="flex flex-col items-end self-start font-display tabular-nums" style={{ gridArea: "readouts" }}>
          <Gauge view={state.derbyView} corner={false} />
        </div>
      ) : (
        <Readouts state={state} />
      )}

      <div className="flex min-h-0 flex-col items-start" style={{ gridArea: "context" }}>
        <ScenePanels {...hud} touch={false} />
        {state.race && !state.race.survival ? <RaceStandings race={state.race} onCommand={raceCommand} /> : null}
        {state.race ? <ResetPrompt view={state.race.view} input={reset} race onTap={tapReset} className="mt-2 sm:hidden" /> : null}
      </div>

      {focus || !settingsShown ? null : <HudSections {...hud} />}

      <div className="flex min-w-0 flex-col items-start gap-2 self-end" style={{ gridArea: "dock" }}>
        {state.race ? <SpectateBar race={state.race} pad={state.pad !== null} cam={state.cam && CAM_LABEL[state.cam]} freeHelp={state.cam === "free" ? freeHelp(state.pad !== null, false) : null} onCommand={raceCommand} onCam={() => engine.current?.cycleCamera()} /> : null}
        {!focus && (state.seat !== "global" || state.pad || state.cam) && !state.race?.spectating ? <DriveHint state={state} engine={engine} /> : null}
        {focus && state.race ? (
          // Under a race menu these would only peek out beside the card.
          state.race.menu === null ? (
            <div className="flex items-center gap-1">
              <RaceViewToggle race={state.race} onCommand={raceCommand} bare />
              <MouseLookButton engine={engine} on={state.mouseLook} className="hud-ink pointer-events-auto text-fg/80 hover:bg-surface/60 hover:text-fg pointer-fine:h-8" />
              <FullscreenButton className="hud-ink pointer-events-auto text-fg/80 hover:bg-surface/60 hover:text-fg pointer-fine:h-8" />
            </div>
          ) : null
        ) : (
          <Dock {...hud} raceCommand={raceCommand} settingsShown={settingsShown} onShowSettings={(show) => setSettings(show ? "shown" : "hidden")} />
        )}
      </div>

      {state.derbyWinner ? (
        <div className="pointer-events-none absolute inset-x-0 top-[38%] z-10 flex justify-center">
          <div className="hud-panel px-6 py-3 text-center">
            <p className="hud-label">{state.derbyDecided === "time" ? "Time!" : "Winner"}</p>
            <p className="font-display text-4xl font-semibold tracking-tight text-fg">{state.derbyWinner}</p>
            <p className="mt-1 text-xs text-muted">
              {state.derbyDecided === "time" ? "Winner on points" : state.derbyDecided === "countout" ? "Last car in the fight; the rest counted out" : "Last engine still running"}
            </p>
          </div>
        </div>
      ) : null}
      {state.derbyTime !== null ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 z-10 flex justify-center px-3 sm:top-1/4">
          <StartLights time={state.derbyTime} />
        </div>
      ) : null}
      {state.race ? (
        <RaceOverlay
          race={state.race}
          pad={state.pad !== null}
          reset={reset}
          onReset={tapReset}
          onCommand={raceCommand}
          inRoom={state.inRoom}
          audio={audioLevels(state, engine)}
        />
      ) : null}
      {state.race ? <RaceStatus race={state.race} corner={focus} /> : null}
      {state.derbyView && !state.derbyWinner ? (
        <div className="pointer-events-none absolute inset-x-0 top-1/3 z-10 flex justify-center px-3 sm:top-1/4">
          <ResetPrompt view={state.derbyView} input={reset} race={false} onTap={tapReset} className="mt-14 sm:mt-0" />
        </div>
      ) : null}
    </div>
  );
}

/** localStorage key of "the Home sheet has opened on its own once": the first visit to a bare URL lands on the mode picker, never again. */
const HOME_SEEN_KEY = "crush.home.seen";

/** The left column hangs under the top-left cluster: its 44 px buttons and the 8 px gap (`gap-2`) before the next line. */
const LEFT_COLUMN_TOP = "calc(max(var(--hud-edge), env(safe-area-inset-top)) + 3.75rem)";
/** The left column's reach: the Menu cluster above it and the steering slider (72 px) with its clearance below it (`6.5rem`), so a long panel scrolls inside instead of running under the thumb. */
const LEFT_COLUMN_HEIGHT = "calc(100dvh - 3.75rem - 6.5rem - 2 * var(--hud-edge))";
/** Top-centre moments of a derby (lights, reset prompt, winner): the top edge on a phone on its side, under the top strip's row upright, as the race moments are (`RaceOverlay`). */
const DERBY_MOMENTS = "pointer-events-none absolute inset-x-0 z-10 flex flex-col items-center gap-1 px-3 top-[calc(max(var(--hud-edge),env(safe-area-inset-top))+3.5rem)] phone-landscape:hud-top";
/** The boost bar and drift label sit just above the steering slider: its 72 px and an 8 px gap above the bottom edge. */
const ABOVE_STEERING = "bottom-[calc(max(var(--hud-edge),env(safe-area-inset-bottom))+5rem)]";

/**
 * The phone HUD. Every piece is `absolute` at a screen edge (`hud-*`), so the middle of the screen, where the road and the car are, stays
 * clear: the Menu cluster top left (outside a race), the scene's panels in one left column under it, the race read-outs top left (a race),
 * the thumb controls in the two bottom corners and the top-right strip (`TouchControls`), the race moments top centre. Menus are sheets.
 * While driving, what is only read falls to a third of its opacity once nothing has changed for a few seconds (`data-calm`).
 */
function PhoneHud({ hud, reset, raceCommand, tapReset, focus }: HudShell) {
  const { state, engine, onlineShown } = hud;
  const race = state.race;
  const { mirror } = useTouchScheme();
  // Menus: plain state, never stored, so a sheet is never open on load.
  const [homeOpen, setHomeOpen] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const calm = useCalm(state);
  useFirstVisitHome(onlineShown, setHomeOpen);
  const driving = state.seat === "drive";
  const glow = resetGlow(state);
  // Free fly's gestures have no button, so its line stays; a sandbox drive keeps its boost bar. Everything else the old hint said is on the buttons' captions.
  const freeView = race === null && state.cam === "free";
  const sandboxDrive = driving && race === null && state.derbyView === null;
  return (
    <div className="hud-grid pointer-events-none absolute inset-0 text-fg" data-focus={focus || undefined} data-calm={calm || undefined}>
      {/* The cluster is hidden, not unmounted, in a race: the online entry inside stays mounted because the race menus portal it into their own header (`online-slot.ts`). */}
      <div className={cn("absolute hud-left hud-top max-w-[calc(100%_-_11rem)] flex-wrap items-start gap-2 calm:opacity-35 hud-fade", race === null ? "flex" : "hidden")}>
        <Button variant="secondary" size="icon" className="pointer-events-auto" aria-label="Menu" title="Menu" onClick={() => setHomeOpen(true)}>
          <Menu />
        </Button>
        <Button variant="secondary" size="icon" className={cn("pointer-events-auto", state.fleetView && glow && RESET_GLOW)} aria-label="Reset crash" title="Reset" onClick={() => engine.current?.reset()}>
          <RotateCcw />
        </Button>
        <Button size="icon" className="pointer-events-auto" aria-label={state.playing ? "Pause" : "Play"} title={state.playing ? "Pause" : "Play"} onClick={() => engine.current?.togglePlay()}>
          {state.playing ? <Pause /> : <Play className="ml-0.5" />}
        </Button>
        {/* Not while driving: the pill is a thing to tap between runs. */}
        {onlineShown && race?.reel == null ? (
          <div className={cn(driving && "hidden")}>
            <OnlineEntry engine={engine} race={race} />
          </div>
        ) : null}
      </div>

      {/* The scene's panels, one column under the cluster, stopping above the steering slider; the garage's panel docks itself to the bottom of it. */}
      <div
        className={cn("pointer-events-none absolute hud-left flex w-52 max-w-[calc(100%_-_2rem)] flex-col gap-1 overflow-y-auto overscroll-contain", state.garage && "justify-end")}
        // The garage's panel docks itself to the bottom (`mt-auto`), which needs a column of that height; every other scene's is as tall as its panels.
        style={{ top: LEFT_COLUMN_TOP, maxHeight: LEFT_COLUMN_HEIGHT, height: state.garage ? LEFT_COLUMN_HEIGHT : undefined }}
      >
        {race === null && !state.lab && !state.garage ? <SandboxLine state={state} /> : null}
        <ScenePanels {...hud} touch />
      </div>

      {race ? <RaceReadouts race={race} corner={false} /> : null}
      {race && !race.survival ? <RaceStandings race={race} onCommand={raceCommand} /> : null}
      {race ? <SpectateBar race={race} pad={state.pad !== null} cam={state.cam && CAM_LABEL[state.cam]} freeHelp={state.cam === "free" ? freeHelp(state.pad !== null, true) : null} onCommand={raceCommand} onCam={() => engine.current?.cycleCamera()} /> : null}
      {/* The Lab's control is the flick on the view itself, the garage's the pickers and the can: no stick, no car buttons. */}
      {!state.lab && !state.garage ? <TouchControls {...hud} /> : null}

      {freeView || sandboxDrive ? (
        <div className={cn("pointer-events-none absolute flex w-48 flex-col gap-1 calm:opacity-35 hud-fade", ABOVE_STEERING, mirror ? "hud-right items-end" : "hud-left items-start")} role="status">
          {freeView ? <p className="hud-ink text-xs leading-snug text-fg/80">{freeHelp(state.pad !== null, true)}</p> : null}
          {sandboxDrive ? <BoostBar state={state} /> : null}
        </div>
      ) : null}

      {state.derbyView ? (
        // The dial (bottom centre on a phone on its side) takes its place from this full-screen box; Gauge's speed text is the desktop's, the sandbox line carries the speed upright.
        <div className="pointer-events-none absolute inset-0 [&>div:last-child]:hidden">
          <Gauge view={state.derbyView} corner={false} />
        </div>
      ) : null}
      {state.derbyTime !== null || state.derbyWinner || state.derbyView ? (
        <div className={DERBY_MOMENTS}>
          {state.derbyTime !== null ? <StartLights time={state.derbyTime} /> : null}
          {state.derbyWinner ? (
            <div className="hud-panel px-4 py-1.5 text-center">
              <p className="hud-label">{state.derbyDecided === "time" ? "Time!" : "Winner"}</p>
              <p className="font-display text-2xl font-semibold tracking-tight text-fg">{state.derbyWinner}</p>
            </div>
          ) : state.derbyView ? (
            <ResetPrompt view={state.derbyView} input={reset} race={false} onTap={tapReset} />
          ) : null}
        </div>
      ) : null}

      {race ? (
        <RaceOverlay
          race={race}
          pad={state.pad !== null}
          reset={reset}
          onReset={tapReset}
          onCommand={raceCommand}
          inRoom={state.inRoom}
          audio={audioLevels(state, engine)}
          onOpenHome={() => setHomeOpen(true)}
        />
      ) : null}
      {race ? <RaceStatus race={race} corner={false} /> : null}

      {homeOpen ? (
        <HomeSheet
          state={state}
          engine={engine}
          onClose={() => setHomeOpen(false)}
          onOpenSettings={() => {
            setHomeOpen(false);
            setSettingsOpen(true);
          }}
        />
      ) : null}
      {settingsOpen ? <HudSections {...hud} onClose={() => setSettingsOpen(false)} /> : null}
    </div>
  );
}

/**
 * Whether the driving phone's HUD is calm. Driving = a live race with no menu over it, or a seat at the wheel. Calm comes after `CALM_MS` of
 * nothing new; a tap outside the driving controls clears it (`watchCalm`), and so does news: a place or lap change, a banner (wrong way,
 * missed checkpoint, driver out, respawn), a chase starting, a new race / derby / Mini game phase, the reset control starting to glow.
 */
function useCalm(state: CrashHudState): boolean {
  const race = state.race;
  const driving = race?.menu == null && (race?.phase === "racing" || state.seat === "drive");
  const [calm, setCalm] = useState(false);
  const watch = useRef<CalmWatch | null>(null);
  useEffect(() => {
    if (!driving) return;
    const started = watchCalm(
      window,
      () => setCalm(true),
      () => setCalm(false),
    );
    watch.current = started;
    return () => {
      started.stop();
      watch.current = null;
      setCalm(false);
    };
  }, [driving]);
  const you = race?.you;
  const news = [you?.place, you?.lap, you?.status, you?.wrongWay, you?.missed, you?.driverOut, you?.respawnIn != null, race?.view?.chase != null, race?.phase, state.derbyTime !== null, state.derbyWinner, state.minigame?.phase, resetGlow(state)].join("|");
  useEffect(() => {
    watch.current?.wake();
  }, [news]);
  return driving && calm;
}

/** The first visit to a bare URL (no `#` scene link, no `?net=` link, not a bench page) opens the Home sheet once: the mode picker, not a live crash with no menu in sight. */
function useFirstVisitHome(onlineShown: boolean, openHome: (open: boolean) => void): void {
  const [seen, setSeen] = useStoredString(HOME_SEEN_KEY, "", "");
  useEffect(() => {
    if (seen !== "" || !onlineShown || window.location.hash !== "" || netDeepLink(window.location.search) !== null) return;
    setSeen("1");
    openHome(true);
  }, [seen, onlineShown, openHome, setSeen]);
}

/** A phone's sandbox reading: the lead car's speed (the driven car's at the wheel), the car count and the phase, one line of text on the view. */
function SandboxLine({ state }: { state: CrashHudState }) {
  const unit = useSpeedUnit();
  const view = state.derbyView ?? state.fleetView;
  const lead = state.showCompactor
    ? `Press gap ${state.wallGap.toFixed(2)} m`
    : `${formatSpeed(view ? view.speedKph / KPH_PER_MS : state.speedA, unit)} ${unit}`;
  const cars = state.carCount === 1 ? "1 car" : `${state.carCount} cars`;
  const phase = state.derby ? (state.derbyWinner ? "Winner" : "Derby") : PHASE[state.phase];
  return <p className="hud-ink shrink-0 truncate font-display text-xs tabular-nums text-fg/80 calm:opacity-35 hud-fade">{[lead, cars, phase].join(" · ")}</p>;
}

/** Every number the sim reports, in one compact card. */
function Readouts({ state }: { state: CrashHudState }) {
  const press = state.showCompactor;
  const hot = state.phase === "slowmo" || state.phase === "impact";
  const unit = useSpeedUnit();
  return (
    // A narrow window in the Lab keeps the top of the screen for the pegboard: the Lab panel reads each throw out.
    <div className={cn("hud-panel self-start px-2 py-1.5 md:justify-self-end", state.lab && "max-sm:hidden")} style={{ gridArea: "readouts" }}>
      <dl className="grid grid-cols-4 gap-x-3 gap-y-1">
        <Readout
          label={press ? "Press gap" : state.carCount === 1 ? "Car" : "Lead"}
          value={press ? state.wallGap.toFixed(2) : formatSpeed(state.speedA, unit)}
          unit={press ? "m" : unit}
        />
        {press ? (
          <Readout label="Plate speed" value={formatSpeed(state.closingKph / 3.6, unit)} unit={unit} />
        ) : state.carCount !== 2 ? (
          <Readout label={state.carCount === 1 ? "Solo" : "Fleet"} value={String(state.carCount)} unit={state.carCount === 1 ? "car" : "cars"} />
        ) : (
          <Readout label={state.phase === "approach" ? "Second" : "Second wreck"} value={formatSpeed(state.speedB, unit)} unit={unit} />
        )}
        {press ? (
          <Readout label="Stage" value={STAGE[state.compactStage]} />
        ) : state.impactKph != null ? (
          <Readout label="Impact" value={formatSpeed(state.impactKph / 3.6, unit)} unit={unit} />
        ) : (
          <Readout
            label={state.eta > 0 && state.eta < 8 ? `Closing ${state.eta.toFixed(1)}s` : "Closing"}
            value={formatSpeed(state.closingKph / 3.6, unit)}
            unit={unit}
          />
        )}
        <div className="min-w-0">
          <dt className="hud-label">Phase</dt>
          <dd className="truncate font-display text-sm font-semibold leading-5">
            <span className={cn("rounded px-1", hot ? "bg-accent text-accent-fg" : "-mx-1 text-fg")}>
              {state.derby ? (state.derbyWinner ? "Winner" : "Derby") : PHASE[state.phase]}
            </span>
          </dd>
        </div>
        <Readout label="Time scale" value={state.timeScale.toFixed(2)} unit="×" />
        <Readout label="T+" value={state.elapsed.toFixed(2)} unit="s" />
        <Readout label="FPS" value={String(Math.round(state.fps))} />
      </dl>
    </div>
  );
}

function Readout({ label, value, unit, className }: { label: string; value: string; unit?: string; className?: string }) {
  return (
    <div className={cn("min-w-0", className)}>
      <dt className="hud-label truncate">{label}</dt>
      <dd className="truncate font-display text-sm font-semibold leading-5 tabular-nums">
        {value}
        {unit ? <span className="ml-0.5 text-xs font-medium text-muted">{unit}</span> : null}
      </dd>
    </div>
  );
}

/** The reset entry of a seat hint's key list ("R respawn", "D-pad ↓ recover"): what glows while the car needs a reset. */
const RESET_KEY = /^(R|D-pad ↓) (respawn|recover)$/;

/** The sandbox drive's boost bar with its drift label. */
function BoostBar({ state }: { state: CrashHudState }) {
  return (
    <div className="mt-1 flex items-center gap-2">
      <div className="relative h-1.5 w-40 overflow-hidden rounded-full bg-surface-2/80" aria-label="Boost">
        <div className="h-full bg-accent" style={{ width: `${Math.round(state.boost * 100)}%` }} />
        <DriftOverlay drift={state.drift} boost={state.boost} vertical={false} />
      </div>
      <DriftLabel drift={state.drift} />
    </div>
  );
}

/** Desktop only: seat keys and the controller label, inked straight onto the view above the dock so it never covers a control. Watching shows the View button: the camera cycle, named for the view it shows. (A phone's buttons carry captions; its free-view line and boost bar are `PhoneHud`'s.) */
function DriveHint({ state, engine }: { state: CrashHudState; engine: HudProps["engine"] }) {
  const { title, keys } = seatHint(state);
  const glow = resetGlow(state);
  return (
    <div className="hud-ink w-full max-w-md" role="status">
      <p className="font-display text-xs font-semibold uppercase tracking-[0.12em] text-fg">
        {title}
        {state.pad ? <span className="hud-label ml-2 text-fg/80">{state.pad} connected</span> : null}
      </p>
      {state.cam ? (
        <Button variant="ghost" className="hud-ink pointer-events-auto -ml-2 h-8 gap-1.5 px-2 text-fg/80 hover:bg-surface/60 hover:text-fg" aria-label="Camera view" aria-keyshortcuts="V" title={`Camera view · ${state.pad ? "Y" : "V"}`} onMouseDown={(e) => e.preventDefault()} onClick={() => engine.current?.cycleCamera()}>
          <Video />
          <span className="text-xs">View · {CAM_LABEL[state.cam]}</span>
        </Button>
      ) : null}
      <p className="text-xs leading-snug text-fg/80">
        {keys.split(" · ").map((key, i) => (
          <Fragment key={key}>
            {i > 0 ? " · " : null}
            {glow && RESET_KEY.test(key) ? <span className={cn(RESET_GLOW, "rounded bg-accent px-1 text-accent-fg")}>{key}</span> : key}
          </Fragment>
        ))}
      </p>
      {state.seat === "drive" && !state.race && !state.derbyView ? <BoostBar state={state} /> : null}
    </div>
  );
}

const BAR_BUTTON = "h-11 min-w-11 px-2.5 text-xs pointer-fine:h-8 pointer-fine:min-w-8";

/** Desktop's always-visible bar (full view): race view toggle in a race, play, reset, scene, the three fleet props, settings and key help. */
function Dock(props: HudProps & { raceCommand: (cmd: RaceCommand) => void; settingsShown: boolean; onShowSettings: (show: boolean) => void }) {
  const { state, engine, raceCommand, settingsShown, onShowSettings } = props;
  // A pick in its fade lights its target at once, so a second click (Fleet included) retargets it.
  const scene = state.pendingScene ?? sceneInPlay(state);
  // Barrier, balls and ramps are fleet props; the engine ignores them while the press, a rig, the range, the Lab, the garage or the race owns the pad.
  const propsLocked = state.showCompactor || state.showPistons || state.showDoors || state.showCorkscrew || state.stack !== null || state.range !== null || state.lab !== null || state.garage !== null || state.race !== null;
  return (
    <div className="hud-panel pointer-events-auto flex w-full flex-wrap items-center gap-1 p-1 sm:w-auto">
      {state.race ? <RaceViewToggle race={state.race} onCommand={raceCommand} compact /> : null}
      <Button
        onClick={() => engine.current?.togglePlay()}
        className={BAR_BUTTON}
        aria-label={state.playing ? "Pause" : "Play"}
        title={state.playing ? "Pause (Space)" : "Play (Space)"}
      >
        {state.playing ? <Pause /> : <Play className="ml-0.5" />}
      </Button>
      <Button
        onClick={() => engine.current?.reset()}
        variant="secondary"
        // A race or derby restarts the whole match, so only the sandbox's reset (which does put a wreck right) hints.
        className={cn(BAR_BUTTON, state.fleetView && resetGlow(state) && RESET_GLOW)}
        aria-label="Reset crash"
        title="Reset (R)"
      >
        <RotateCcw />
      </Button>
      <div
        className="order-last grid w-full grid-cols-4 gap-0.5 rounded-md bg-surface-2/70 p-0.5 sm:order-none sm:flex sm:w-auto sm:max-w-full sm:flex-wrap"
        role="group"
        aria-label="Scene"
      >
        {scenesFor(state.inRoom).map(({ id, label, aria, tone, quiet }) => (
          <Button
            key={id}
            variant={scene === id ? "default" : "ghost"}
            aria-pressed={scene === id}
            aria-label={aria}
            className={cn("h-10 px-1 text-xs pointer-fine:h-7 sm:px-2.5", tone, tone && "scene-chip", quiet && scene !== id && "font-normal text-muted")}
            onClick={() => pickScene(engine, scene, id)}
          >
            {label}
          </Button>
        ))}
        {state.inRoom ? null : <BenchEntry />}
      </div>
      <Button
        onClick={() => engine.current?.toggleBarrier()}
        disabled={propsLocked}
        variant={state.showBarrier ? "default" : "ghost"}
        className={BAR_BUTTON}
        aria-pressed={state.showBarrier}
        aria-label="Toggle jersey barrier"
        title="Jersey barrier (B)"
      >
        <BrickWall />
      </Button>
      <Button
        onClick={() => engine.current?.toggleBalls()}
        disabled={propsLocked}
        variant={state.showBalls ? "default" : "ghost"}
        className={BAR_BUTTON}
        aria-pressed={state.showBalls}
        aria-label="Toggle ramp balls"
        title="Ramp balls (K)"
      >
        <CircleDot />
      </Button>
      <Button
        onClick={() => engine.current?.toggleRamps()}
        disabled={propsLocked}
        variant={state.showRamps ? "default" : "ghost"}
        className={BAR_BUTTON}
        aria-pressed={state.showRamps}
        aria-label="Toggle jump ramps"
        title="Jump ramps (.)"
      >
        <TriangleRight />
      </Button>
      <Button
        onClick={() => onShowSettings(!settingsShown)}
        variant={settingsShown ? "secondary" : "ghost"}
        className={cn(BAR_BUTTON, "ml-auto sm:ml-0")}
        aria-pressed={settingsShown}
        aria-label="Show settings"
        title="Settings"
      >
        <SlidersHorizontal />
      </Button>
      <KeyHelp glow={resetGlow(state)} />
      <MouseLookButton engine={engine} on={state.mouseLook} className={BAR_BUTTON} />
      <FullscreenButton className={BAR_BUTTON} />
    </div>
  );
}

function KeyHelp({ glow }: { glow: boolean }) {
  const [keysOpen, setKeysOpen] = useState(false);
  const [creditsOpen, setCreditsOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  return (
    <>
      <Popover.Root open={keysOpen} onOpenChange={setKeysOpen}>
        <Popover.Trigger asChild>
          <Button ref={triggerRef} variant="ghost" className={BAR_BUTTON} aria-label="Keyboard shortcuts" title="Keys">
            <CircleHelp />
          </Button>
        </Popover.Trigger>
        <Popover.Portal>
          <Popover.Content
            side="top"
            align="end"
            sideOffset={8}
            collisionPadding={8}
            className="z-50 w-80 max-w-[calc(100vw-1rem)] rounded-lg bg-surface p-3 text-fg shadow-[var(--shadow-border)]"
          >
            <KeyList title="Scene" keys={SCENE_KEYS} glowKey={glow ? "R" : undefined} />
            <KeyList title="Cars & camera" keys={CAMERA_KEYS} className="mt-3" />
            <p className="mt-2 text-xs text-muted">Reversing steers like a real car: left swings the tail left.</p>
            <Button
              variant="ghost"
              className="mt-2 h-8 px-2 text-xs"
              onClick={() => {
                setKeysOpen(false);
                setCreditsOpen(true);
              }}
            >
              Credits
            </Button>
          </Popover.Content>
        </Popover.Portal>
      </Popover.Root>
      {/* Beside the popover, so it outlives the popover closing; closing it puts focus back on the ? button. */}
      <CreditsDialog
        open={creditsOpen}
        onClose={() => {
          setCreditsOpen(false);
          triggerRef.current?.focus();
        }}
      />
    </>
  );
}

function KeyList({ title, keys, glowKey, className }: { title: string; keys: [string, string][]; glowKey?: string; className?: string }) {
  return (
    <div className={className}>
      <p className="hud-label">{title}</p>
      <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1">
        {keys.map(([key, action]) => (
          <div key={key} className="flex items-baseline gap-2 text-xs">
            <dt>
              <kbd className={cn("rounded bg-surface-2 px-1.5 py-0.5 font-display text-xs text-fg shadow-[var(--shadow-border)]", key === glowKey && RESET_GLOW)}>{key}</kbd>
            </dt>
            <dd className="text-muted">{action}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
