import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { Car, ChevronsUp, CircleParking, DoorOpen, OctagonX, Zap } from "lucide-react";
import type { HudProps } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { PedalStrip } from "@/components/touch-strip";
import { thumbSideClass } from "@/components/thumb-side";
import { useBoostTap } from "@/components/use-boost-tap";
import { usePadHold } from "@/components/use-pad-hold";
import type { FootHud } from "@/game/hud/hud-store";
import { tapOnFoot, type SchemeLayout } from "@/game/hud/touch-scheme";
import { PAD_BUTTON } from "@/game/vehicle/gamepad";
import { cn } from "@/lib/utils";

/**
 * Every size of the right-hand cluster, in one place (CSS px; Tailwind's unit is 4): the Easy scheme's Brake pad 80, Boost and Handbrake 64 (56 on an upright phone, where the bottom row must leave the slider its room),
 * and Boost 88 x 72 while the Long jump's bail is armed. Every control is past the 44 floor, gaps of 8 (`gap-2`).
 * `slot` is the bottom row's height: the drive dial's box (80 px wide, 250/220 of that tall, and the padding that keeps its bottle's finger-sized hit area inside the safe area, `race-readouts.tsx`), so the control above it
 * stands at one height in every scene, dial or not. A phone on its side puts the dial beside a two-thumb scheme's control instead, which then takes the slot's height.
 */
const SIZE = { corner: "size-20", button: "size-14 phone-landscape:size-16", bail: "h-18 w-22", dial: "w-23", slot: "min-h-[6.5rem]" } as const;

/** One pad button (`PAD_BUTTON` index): held while a finger is on it, and a tap shorter than a frame still presses. The caller sizes it. */
/**
 * Every in-race control is a round, translucent touch zone with a thin ring and a glyph, as a racing game draws them (Real Racing 3, Asphalt, GRID),
 * never a bordered box with a text label: the glyph says what it is, `caption` (a word under it) is for the ones whose glyph is not obvious, and
 * every button keeps its accessible name. Held, the disc fills.
 */
export const ZONE = "relative rounded-full bg-surface/35 ring-1 ring-inset ring-fg/30 shadow-none hover:bg-surface/35 data-[held]:bg-accent data-[held]:text-accent-fg data-[held]:ring-0";

export function PadButton({ engine, button, name, label, caption, showCaption = false, className, children }: Pick<HudProps, "engine"> & { button: number; name: string; label: string; caption: string; showCaption?: boolean; className: string; children: ReactNode }) {
  return (
    <Button
      variant="ghost"
      aria-label={label}
      title={label}
      data-touch-control={name}
      data-keep-idle
      className={cn(ZONE, "pointer-events-auto touch-none select-none flex-col gap-0.5 px-0 [&_svg]:size-6", className)}
      {...usePadHold(engine, button)}
    >
      {children}
      <span className={showCaption ? "font-display text-[10px] font-semibold uppercase leading-none tracking-wider" : "sr-only"}>{caption}</span>
    </Button>
  );
}

type PedalName = "brake";

/**
 * One pedal: held while any finger is on it. Fingers are counted per pointer (capture keeps a drag that leaves the pedal on it), so a
 * second finger that lifts first does not release the first; `onHold` fires only when the pedal goes from free to held and back.
 */
function Pedal({ name, label, caption, className, onHold, children }: { name: PedalName; label: string; caption: string; className: string; onHold: (down: boolean) => void; children: ReactNode }) {
  const fingers = useRef(new Set<number>());
  const release = (e: ReactPointerEvent<HTMLElement>): void => {
    if (!fingers.current.delete(e.pointerId) || fingers.current.size > 0) return;
    delete e.currentTarget.dataset.held;
    onHold(false);
  };
  return (
    <Button
      variant="ghost"
      aria-label={label}
      title={label}
      data-touch-control={name}
      data-keep-idle
      className={cn(ZONE, "pointer-events-auto touch-none select-none flex-col gap-1 px-0 [&_svg]:size-7", className)}
      onPointerDown={(e) => {
        e.currentTarget.setPointerCapture(e.pointerId);
        fingers.current.add(e.pointerId);
        if (fingers.current.size > 1) return;
        e.currentTarget.dataset.held = "";
        onHold(true);
      }}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      {children}
      <span className="font-display text-[10px] font-semibold uppercase leading-none tracking-wider">{caption}</span>
    </Button>
  );
}

/** The "Auto gas" light of Easy: lit while the car pulls by itself, so nobody wonders where the gas is. */
function AutoGasLight({ on }: { on: boolean }) {
  return (
    <div
      role="status"
      aria-label={on ? "Gas: automatic, on" : "Gas: automatic, off while you brake"}
      className={cn("flex h-8 w-20 items-center justify-center gap-1 rounded-full font-display text-[10px] font-semibold uppercase tracking-wider transition-colors duration-[var(--motion-quick)]", on ? "bg-signal-green/70 text-fg" : "bg-surface/35 text-muted ring-1 ring-inset ring-fg/25")}
    >
      <ChevronsUp className="size-3.5" />
      Auto gas
    </div>
  );
}

/** Boost as a tap (`useBoostTap`): one press is a burst, no finger stays on it. */
function BoostTap({ boost, bail }: { boost: { tap: () => void }; bail: boolean }) {
  return (
    <Button
      variant="ghost"
      aria-label="Boost (tap)"
      title="Boost (tap)"
      data-touch-control="boost"
      data-keep-idle
      className={cn(ZONE, "pointer-events-auto touch-none select-none flex-col gap-0.5 px-0 [&_svg]:size-6", bail ? SIZE.bail : SIZE.button)}
      onPointerDown={boost.tap}
      onContextMenu={(e) => e.preventDefault()}
    >
      <Zap />
      <span className="font-display text-[10px] font-semibold uppercase leading-none tracking-wider">Boost</span>
    </Button>
  );
}

/** Out of the car, or back in once out: a tap, drawn only where the keyboard's Enter would act (`OnFootDirector.hud`). */
function OnFootTap({ engine, foot, className }: Pick<HudProps, "engine"> & { foot: FootHud | null; className: string }) {
  if (foot === null) return null;
  const label = foot.out ? "Get back in the car (tap)" : "Get out and walk (tap)";
  return (
    <Button
      variant="ghost"
      aria-label={label}
      title={label}
      data-touch-control="onfoot"
      data-keep-idle
      className={cn(ZONE, "pointer-events-auto touch-none select-none flex-col gap-0.5 px-0 [&_svg]:size-6", className)}
      onPointerDown={() => {
        const touch = engine.current?.touch;
        if (touch) tapOnFoot(touch);
      }}
      onContextMenu={(e) => e.preventDefault()}
    >
      {foot.out ? <Car /> : <DoorOpen />}
      <span className="font-display text-[10px] font-semibold uppercase leading-none tracking-wider">{foot.out ? "In" : "Out"}</span>
    </Button>
  );
}

/** Easy's right thumb: the gas is automatic, so it holds Brake in the corner and taps Boost above it; braking ends a Boost. */
function BrakeAndBoost({ engine, bail, gasOn, foot, onBrake, onArm }: Pick<HudProps, "engine"> & { bail: boolean; gasOn: boolean; foot: FootHud | null; onBrake: (down: boolean) => void; onArm: () => void }) {
  const boost = useBoostTap(engine);
  return (
    <div className="flex flex-col items-end gap-2">
      <AutoGasLight on={gasOn} />
      <div className="flex items-end gap-2">
        <OnFootTap engine={engine} foot={foot} className={SIZE.button} />
        <BoostTap boost={boost} bail={bail} />
      </div>
      <Pedal
        name="brake"
        label="Brake (hold)"
        caption="Brake"
        className={SIZE.corner}
        onHold={(down) => {
          if (down) {
            onArm();
            boost.release();
          }
          onBrake(down);
        }}
      >
        <OctagonX />
      </Pedal>
    </div>
  );
}

/** Under 380 px the Disc's buttons drop to 48 px: the 128 px disc, both buttons and the dial's slot then fit 360 px side by side. */
const DISC_BUTTON = cn(SIZE.button, "max-[380px]:size-12");

/** The Disc's Out stands over Boost: past the dial's slot and its gap, as a 360 px row has no room for a third button. */
const DIAL_ROOM_RIGHT = "mr-25";
const DIAL_ROOM_LEFT = "ml-25";

/** The Disc's right thumb: Handbrake and Boost, held, beside the dial's slot. */
function DiscButtons({ engine, bail }: Pick<HudProps, "engine"> & { bail: boolean }) {
  return (
    <>
      <PadButton engine={engine} button={PAD_BUTTON.west} name="handbrake" label="Handbrake (hold)" caption="Hand" showCaption className={DISC_BUTTON}>
        <CircleParking />
      </PadButton>
      <PadButton engine={engine} button={PAD_BUTTON.south} name="boost" label="Boost (hold)" caption="Boost" showCaption className={bail ? SIZE.bail : DISC_BUTTON}>
        <Zap />
      </PadButton>
    </>
  );
}

/**
 * The right thumb, above the drive dial's corner. Its control is the layout's `right`: the pedal strip (Pedals, Tilt), a Brake pad with a Boost tap over
 * automatic gas (Easy), or the Disc's Handbrake and Boost beside the dial's slot. The bottom row's height is the dial's box (80 px wide) in every scene, dial or
 * not, so the control above stands at one height. `mirror` puts the cluster at the left edge. Fingers go to `onThumb` (gas and brake, 0..1; the caller writes the pad from them).
 */
export function TouchPedals({ engine, layout, canDrive, driving, mirror, bail, dial, gasOn, foot, onThumb, onArm }: Pick<HudProps, "engine"> & {
  layout: SchemeLayout;
  /** The seat is the player's to drive (or follows a car one touch would take the wheel of): the pedals are drawn. */
  canDrive: boolean;
  /** At the wheel: the Disc's Handbrake and Boost are drawn. */
  driving: boolean;
  mirror: boolean;
  /** The Long jump's bail can still be pressed: Boost is drawn large. */
  bail: boolean;
  /** The drive dial sits in the corner of the bottom row. */
  dial: boolean;
  /** The car is being given gas by itself right now (the "Auto gas" light). */
  gasOn: boolean;
  /** Where getting out (or back in) is offered: the Out / In tap is drawn. */
  foot: FootHud | null;
  onThumb: (gas: number, brake: number) => void;
  onArm: () => void;
}) {
  const disc = layout.right === "buttons";
  return (
    <div role="group" aria-label="Pedals" className={cn("pointer-events-none absolute flex flex-col gap-2", disc ? "hud-bottom" : "thumb-bottom", mirror ? "items-start" : "items-end", thumbSideClass(mirror ? "left" : "right", disc))}>
      {canDrive && layout.right === "strip" ? (
        <div className={cn("flex items-start gap-2", mirror && "flex-row-reverse")}>
          <OnFootTap engine={engine} foot={foot} className={SIZE.button} />
          <PedalStrip engine={engine} onThumb={onThumb} onArm={onArm} />
        </div>
      ) : null}
      {canDrive && layout.right === "brake" ? <BrakeAndBoost engine={engine} bail={bail} gasOn={gasOn} foot={foot} onBrake={(down) => onThumb(0, down ? 1 : 0)} onArm={onArm} /> : null}
      {disc ? <OnFootTap engine={engine} foot={foot} className={cn(DISC_BUTTON, dial && (mirror ? DIAL_ROOM_LEFT : DIAL_ROOM_RIGHT))} /> : null}
      <div className={cn("flex items-end gap-2", mirror && "flex-row-reverse", SIZE.slot, !disc && "phone-landscape:hidden")}>
        {driving && disc ? <DiscButtons engine={engine} bail={bail} /> : null}
        {dial ? <div className={SIZE.dial} aria-hidden /> : null}
      </div>
    </div>
  );
}
