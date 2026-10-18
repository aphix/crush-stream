import { useRef, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { ChevronsUp, CircleParking, OctagonX, Zap } from "lucide-react";
import type { HudProps } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { usePadHold } from "@/components/use-pad-hold";
import type { SchemeLayout } from "@/game/hud/touch-scheme";
import { PAD_BUTTON } from "@/game/vehicle/gamepad";
import { cn } from "@/lib/utils";

/**
 * Every size of the right-hand cluster, in one place (CSS px; Tailwind's unit is 4): the corner pedal 96, the Pedals scheme's Brake 72,
 * Boost and Handbrake 64 (56 on an upright phone, where the bottom row must leave the slider its room), and Boost 88 x 72 while the Long jump's bail is armed. Every control is past the 44 floor, gaps of 8 (`gap-2`).
 * `slot` is the bottom row's height: the drive dial's box (80 px wide, 250/220 of that tall, and the padding that keeps its bottle's finger-sized hit area inside the safe area, `race-readouts.tsx`), so the pedals above it
 * stand at one height in every scene, dial or not, and the dial sits in the screen's corner as it always did.
 */
const SIZE = { corner: "size-24", brake: "size-18", button: "size-14 phone-landscape:size-16", bail: "h-18 w-22", dial: "w-23", slot: "min-h-[6.5rem]" } as const;

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

type PedalName = "gas" | "brake";

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

/**
 * The right thumb, above the drive dial's corner: the pedals in one row and, under them, a row of Boost and Handbrake with the dial's slot
 * at its outer end. Pedals scheme: Gas in the corner column, Brake beside it. A scheme whose gas is automatic has Brake in the corner and
 * an "Auto gas" light over it, lit while the car pulls, so nobody wonders where gas is. `mirror` puts the cluster at the left edge, the
 * corner column still outermost. Pedal fingers go to `onPedal` (the caller writes the pad from them); the first finger on Brake also calls `onArm`.
 */
export function TouchPedals({ engine, layout, canDrive, driving, mirror, bail, dial, gasOn, onPedal, onArm }: Pick<HudProps, "engine"> & {
  layout: SchemeLayout;
  /** The seat is the player's to drive (or follows a car one touch would take the wheel of): the pedals are drawn. */
  canDrive: boolean;
  /** At the wheel: Boost and Handbrake are drawn. */
  driving: boolean;
  mirror: boolean;
  /** The Long jump's bail can still be pressed: Boost is drawn large. */
  bail: boolean;
  /** The drive dial sits in the corner of the bottom row: Boost and Handbrake stand beside it. */
  dial: boolean;
  /** The car is being given gas by itself right now (the "Auto gas" light). */
  gasOn: boolean;
  onPedal: (pedal: PedalName, down: boolean) => void;
  onArm: () => void;
}) {
  const row = cn("flex items-end gap-2", mirror && "flex-row-reverse");
  return (
    <div role="group" aria-label="Pedals" className={cn("pointer-events-none absolute hud-bottom flex flex-col gap-2", mirror ? "hud-left items-start" : "hud-right items-end")}>
      {canDrive && layout.brakePedal ? (
        <div className={cn(row, "items-end")}>
          {layout.autoGas ? (
            <div className="flex flex-col items-end gap-1">
              <div
                role="status"
                aria-label={gasOn ? "Gas: automatic, on" : "Gas: automatic, off while you brake"}
                className={cn("flex h-8 items-center gap-1 rounded-full px-3 font-display text-xs font-semibold uppercase tracking-wider transition-colors duration-[var(--motion-quick)]", gasOn ? "bg-signal-green/70 text-fg" : "bg-surface/35 text-muted ring-1 ring-inset ring-fg/25")}
              >
                <ChevronsUp className="size-4" />
                Auto gas
              </div>
              <Pedal
                name="brake"
                label="Brake (hold)"
                caption="Brake"
                className={SIZE.corner}
                onHold={(down) => {
                  if (down) onArm();
                  onPedal("brake", down);
                }}
              >
                <OctagonX />
              </Pedal>
            </div>
          ) : (
            <>
              <Pedal
                name="brake"
                label="Brake (hold)"
                caption="Brake"
                className={SIZE.brake}
                onHold={(down) => {
                  if (down) onArm();
                  onPedal("brake", down);
                }}
              >
                <OctagonX />
              </Pedal>
              <Pedal name="gas" label="Gas (hold)" caption="Gas" className={cn(SIZE.corner, "bg-signal-green/30 ring-signal-green/60 data-[held]:bg-signal-green data-[held]:text-fg")} onHold={(down) => onPedal("gas", down)}>
                <ChevronsUp />
              </Pedal>
            </>
          )}
        </div>
      ) : null}
      <div className={cn(row, SIZE.slot)}>
        {driving ? (
          <>
            <PadButton engine={engine} button={PAD_BUTTON.west} name="handbrake" label="Handbrake (hold)" caption="Hand" showCaption className={SIZE.button}>
              <CircleParking />
            </PadButton>
            <PadButton engine={engine} button={PAD_BUTTON.south} name="boost" label="Boost (hold)" caption="Boost" showCaption className={bail ? SIZE.bail : SIZE.button}>
              <Zap />
            </PadButton>
          </>
        ) : null}
        {dial ? <div className={SIZE.dial} aria-hidden /> : null}
      </div>
    </div>
  );
}
