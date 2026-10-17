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
 * Boost and Handbrake 64, and Boost 88 x 72 while the Long jump's bail is armed. Cluster at most 190 wide x 170 tall (176 tall while
 * the bail is armed: the one control the prompt names gets the room), every control past the 44 floor, gaps of 8 (`gap-2`).
 */
const SIZE = { corner: "size-24", brake: "size-18", button: "size-16", bail: "h-18 w-22" } as const;

/** One pad button (`PAD_BUTTON` index): held while a finger is on it, and a tap shorter than a frame still presses. The caller sizes it. */
export function PadButton({ engine, button, name, label, caption, className, children }: Pick<HudProps, "engine"> & { button: number; name: string; label: string; caption: string; className: string; children: ReactNode }) {
  return (
    <Button
      variant="secondary"
      aria-label={label}
      title={label}
      data-touch-control={name}
      data-keep-idle
      className={cn("pointer-events-auto touch-none select-none flex-col gap-0.5 bg-surface/60 px-1 data-[held]:bg-accent data-[held]:text-accent-fg [&_svg]:size-5", className)}
      {...usePadHold(engine, button)}
    >
      {children}
      <span className="font-display text-xs leading-none">{caption}</span>
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
      variant="secondary"
      aria-label={label}
      title={label}
      data-touch-control={name}
      data-keep-idle
      className={cn("pointer-events-auto touch-none select-none flex-col gap-1 bg-surface/60 px-1 data-[held]:bg-accent data-[held]:text-accent-fg [&_svg]:size-6", className)}
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
      <span className="font-display text-xs leading-none">{caption}</span>
    </Button>
  );
}

/**
 * The right thumb: the pedals the scheme draws (Gas at the corner and Brake beside it, or Brake alone at the corner when the car pulls by itself),
 * and Boost and Handbrake above them, Boost in the corner's column. `mirror` puts the cluster at the left edge, the corner pedal still outermost.
 * Pedal fingers go to `onPedal` (the caller writes the pad from them); the first finger on Brake also calls `onArm`.
 */
export function TouchPedals({ engine, layout, canDrive, driving, mirror, bail, onPedal, onArm }: Pick<HudProps, "engine"> & {
  layout: SchemeLayout;
  /** The seat is the player's to drive (or follows a car one touch would take the wheel of): the pedals are drawn. */
  canDrive: boolean;
  /** At the wheel: Boost and Handbrake are drawn. */
  driving: boolean;
  mirror: boolean;
  /** The Long jump's bail can still be pressed: Boost is drawn large. */
  bail: boolean;
  onPedal: (pedal: PedalName, down: boolean) => void;
  onArm: () => void;
}) {
  const row = cn("flex items-end gap-2", mirror && "flex-row-reverse");
  return (
    <div role="group" aria-label="Pedals" className={cn("pointer-events-none absolute hud-bottom flex flex-col gap-2", mirror ? "hud-left items-start" : "hud-right items-end")}>
      {driving ? (
        <div className={row}>
          <PadButton engine={engine} button={PAD_BUTTON.west} name="handbrake" label="Handbrake (hold)" caption="Handbrake" className={SIZE.button}>
            <CircleParking />
          </PadButton>
          <PadButton engine={engine} button={PAD_BUTTON.south} name="boost" label="Boost (hold)" caption="Boost" className={bail ? SIZE.bail : SIZE.button}>
            <Zap />
          </PadButton>
        </div>
      ) : null}
      {canDrive && layout.brakePedal ? (
        <div className={row}>
          <Pedal
            name="brake"
            label="Brake (hold)"
            caption="Brake"
            className={layout.gasPedal ? SIZE.brake : SIZE.corner}
            onHold={(down) => {
              if (down) onArm();
              onPedal("brake", down);
            }}
          >
            <OctagonX />
          </Pedal>
          {layout.gasPedal ? (
            <Pedal name="gas" label="Gas (hold)" caption="Gas" className={SIZE.corner} onHold={(down) => onPedal("gas", down)}>
              <ChevronsUp />
            </Pedal>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
