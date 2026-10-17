import { useEffect, useEffectEvent, useRef, useSyncExternalStore } from "react";
import { ChevronLeft, ChevronRight, LockOpen, LogOut, Maximize, Minimize, Mouse, Pause, SwitchCamera, Video, Wrench } from "lucide-react";
import type { HudProps } from "@/components/hud";
import { RESET_GLOW } from "@/components/reset-prompt";
import { Button } from "@/components/ui/button";
import { PadButton, TouchPedals } from "@/components/touch-pedals";
import { TouchSteer } from "@/components/touch-steer";
import { useCoarsePointer } from "@/components/use-coarse-pointer";
import { useTouchScheme } from "@/components/use-touch-scheme";
import { bailArmed } from "@/game/hud/bail-prompt";
import { resetGlow } from "@/game/hud/reset-prompt";
import { pedalsFor, schemeLayout } from "@/game/hud/touch-scheme";
import { PAD_BUTTON } from "@/game/vehicle/gamepad";
import { cn } from "@/lib/utils";

/** The webkit prefixes Safari on iPad still ships (iPhone Safari has neither, so the button hides there). */
type FsDocument = Document & { webkitFullscreenEnabled?: boolean; webkitFullscreenElement?: Element | null; webkitExitFullscreen?: () => void };
type FsRoot = HTMLElement & { webkitRequestFullscreen?: () => void };

function subscribeFullscreen(onChange: () => void): () => void {
  document.addEventListener("fullscreenchange", onChange);
  document.addEventListener("webkitfullscreenchange", onChange);
  return () => {
    document.removeEventListener("fullscreenchange", onChange);
    document.removeEventListener("webkitfullscreenchange", onChange);
  };
}

function inFullscreen(): boolean {
  const d: FsDocument = document;
  return (d.fullscreenElement ?? d.webkitFullscreenElement ?? null) !== null;
}

function fullscreenEnabled(): boolean {
  const d: FsDocument = document;
  return d.fullscreenEnabled === true || d.webkitFullscreenEnabled === true;
}

function warnFullscreen(err: unknown): void {
  console.warn("Fullscreen refused", err);
}

function toggleFullscreen(): void {
  const d: FsDocument = document;
  const root: FsRoot = document.documentElement;
  if (inFullscreen()) {
    if (typeof d.exitFullscreen === "function") d.exitFullscreen().catch(warnFullscreen);
    else d.webkitExitFullscreen?.();
  } else if (typeof root.requestFullscreen === "function") root.requestFullscreen().catch(warnFullscreen);
  else root.webkitRequestFullscreen?.();
}

/** The whole page fullscreen (standard API, webkit fallback); absent where the browser can't. */
export function FullscreenButton({ className }: { className?: string }) {
  const enabled = useSyncExternalStore(subscribeFullscreen, fullscreenEnabled, () => false);
  const on = useSyncExternalStore(subscribeFullscreen, inFullscreen, () => false);
  if (!enabled) return null;
  const label = on ? "Exit fullscreen" : "Fullscreen";
  return (
    <Button variant="ghost" className={className} aria-label={label} aria-pressed={on} title={label} onClick={toggleFullscreen}>
      {on ? <Minimize /> : <Maximize />}
    </Button>
  );
}

/** Mouse look (pointer lock): the pointer hides and mouse movement looks round, no drag. A fine pointer only; Esc or this button ends it. */
export function MouseLookButton({ engine, on, className }: Pick<HudProps, "engine"> & { on: boolean; className?: string }) {
  const coarse = useCoarsePointer();
  if (coarse) return null;
  const label = on ? "Release the mouse" : "Mouse look";
  return (
    <Button variant={on ? "default" : "ghost"} className={cn(className, on && "bg-accent text-accent-fg hover:bg-accent hover:text-accent-fg")} aria-label={label} aria-pressed={on} title={`${label} (;)`} onClick={() => engine.current?.toggleMouseLook()}>
      <Mouse />
    </Button>
  );
}

/** The top strip's buttons: 48 square, the caption (text-xs) under the icon. */
const STRIP_BUTTON = "size-12 px-0";

/**
 * The top-right strip: View, Rear and the way out (Pause in a race, Exit at the wheel, Free in a watched scene), Prev / Next while
 * nobody drives, and the reset control only while the car needs it. Each is held through the pad (`engine.touch`), so the pad bindings
 * run them: the race's pause and respawn, look back. Capped at 62 % of the screen, so a portrait phone wraps it to a second row.
 */
function TopStrip({ state, engine }: Pick<HudProps, "state" | "engine">) {
  const race = state.race;
  const driving = state.seat === "drive";
  const flying = state.cam === "free";
  const watching = state.seat !== "global" || flying;
  // A scene with one car (a Mini game, the garage, the range) has nobody to cycle to and nowhere to step out to.
  const others = state.carCount > 1;
  return (
    <div className="pointer-events-none absolute hud-top hud-right flex max-w-[62%] flex-wrap justify-end gap-2">
      {/* The glow is the prompt: the button exists only while the car needs a reset, so the strip is three buttons the rest of the time. */}
      {driving && resetGlow(state) ? (
        <PadButton engine={engine} button={PAD_BUTTON.down} name="respawn" label={race ? "Respawn" : "Recover car"} caption={race ? "Respawn" : "Recover"} className={cn(STRIP_BUTTON, RESET_GLOW)}>
          <Wrench />
        </PadButton>
      ) : null}
      {!race && !driving && others ? (
        <>
          <PadButton engine={engine} button={PAD_BUTTON.lb} name="prev" label="Previous car" caption="Prev" className={STRIP_BUTTON}>
            <ChevronLeft />
          </PadButton>
          <PadButton engine={engine} button={PAD_BUTTON.rb} name="next" label="Next car" caption="Next" className={STRIP_BUTTON}>
            <ChevronRight />
          </PadButton>
        </>
      ) : null}
      {/* View cycles the spectator cam (the whole field's: orbit and free fly); a spectated race car has it on the Spectating bar. */}
      {!race?.spectating ? (
        <PadButton engine={engine} button={PAD_BUTTON.north} name="view" label="Camera view" caption="View" className={STRIP_BUTTON}>
          <Video />
        </PadButton>
      ) : null}
      {watching ? (
        <PadButton engine={engine} button={PAD_BUTTON.r3} name="rear" label="Look back (hold)" caption="Rear" className={STRIP_BUTTON}>
          <SwitchCamera />
        </PadButton>
      ) : null}
      {race ? (
        <PadButton engine={engine} button={PAD_BUTTON.back} name="pause" label="Pause race" caption="Pause" className={STRIP_BUTTON}>
          <Pause />
        </PadButton>
      ) : watching && (others || !driving || flying) ? (
        <PadButton
          engine={engine}
          button={PAD_BUTTON.back}
          name={flying || !driving ? "free" : "exit"}
          label={flying ? "Leave free fly" : driving ? "Step out of the car" : "Free camera"}
          caption={flying ? "Back" : driving ? "Exit" : "Free"}
          className={STRIP_BUTTON}
        >
          {driving && !flying ? <LogOut /> : <LockOpen />}
        </PadButton>
      ) : null}
    </div>
  );
}

function DriveControls({ state, engine }: HudProps) {
  const { scheme, mirror, tilt } = useTouchScheme();
  const layout = schemeLayout(scheme);
  const race = state.race;
  const driving = state.seat === "drive";
  // A spectated race car is never this player's to drive.
  const canDrive = driving || (state.seat === "follow" && !race?.spectating);
  const raceLive = race !== null && race.phase !== null && race.phase !== "finished";
  const minigameReady = state.minigame?.phase === "ready";
  const bail = state.minigame !== null && bailArmed(state.minigame);

  /**
   * ARMING (Easy and Tilt, whose gas is automatic). In a live race the car pulls whenever the player drives. Everywhere else (sandbox, derby, range,
   * Mini games) the seat can be "drive" without the player having decided to move: a Mini game starts its run when the pedal goes down, and gas
   * on a car that is only being followed would take the wheel. So there auto-gas waits for the first finger on the steering control or on
   * Brake, and drops again when the player stops driving, a Mini game is ready for its next run, or the race ends.
   */
  const armed = useRef(false);
  useEffect(() => {
    if (!driving) armed.current = false;
  }, [driving]);
  useEffect(() => {
    if (minigameReady) armed.current = false;
  }, [minigameReady]);
  useEffect(() => {
    armed.current = false;
  }, [raceLive]);
  const autoGasLive = (): boolean => (raceLive ? driving : armed.current);

  /** The fingers on the two pedals, and the pad's pedals written from them on every change. */
  const fingers = useRef({ gas: false, brake: false });
  const writePedals = (): void => {
    const touch = engine.current?.touch;
    if (!touch) return;
    const { gas, brake } = pedalsFor(scheme, fingers.current, canDrive && (!layout.autoGas || autoGasLive()));
    touch.gas = gas;
    touch.brake = brake;
  };
  // The pedals unmount with the seat or the scheme: a finger on one is gone with it.
  useEffect(() => {
    fingers.current = { gas: false, brake: false };
  }, [scheme, canDrive]);
  // Auto-gas has no finger to write it: it starts with the seat (a fresh race driver, a re-armed car) and stops with it, never stuck on after.
  const applyPedals = useEffectEvent(writePedals);
  useEffect(() => {
    applyPedals();
    // The pad is the engine's, one object for its life: the cleanup lets go of it even after the ref has moved on.
    const touch = engine.current?.touch;
    return () => {
      if (touch) touch.gas = touch.brake = 0;
    };
  }, [engine, scheme, canDrive, driving, raceLive, minigameReady]);
  const arm = (): void => {
    armed.current = true;
    writePedals();
  };

  return (
    <>
      {canDrive ? (
        <div role="group" aria-label="Steering" className={cn("pointer-events-none absolute hud-bottom", mirror ? "hud-right" : "hud-left")}>
          <TouchSteer steer={layout.steer} tilt={tilt} engine={engine} onArm={arm} steerLive={() => raceLive || armed.current} />
        </div>
      ) : null}
      {canDrive ? (
        <TouchPedals
          engine={engine}
          layout={layout}
          canDrive={canDrive}
          driving={driving || state.minigame !== null}
          mirror={mirror}
          bail={bail}
          onPedal={(pedal, down) => {
            fingers.current[pedal] = down;
            writePedals();
          }}
          onArm={arm}
        />
      ) : null}
      <TopStrip state={state} engine={engine} />
    </>
  );
}

/**
 * The thumb controls of a touch screen, three clusters at fixed screen offsets (the safe areas are kept): steering lower left, pedals and
 * buttons lower right (the scheme and Mirror say which is which), View / Rear / Pause on the top right. They write the engine's pad
 * (`engine.touch`), so the pad bindings run them. Nothing here takes pointer events but the controls themselves.
 */
export function TouchControls(props: HudProps) {
  return props.state.race !== null && props.state.race.menu !== null ? null : <DriveControls {...props} />;
}
