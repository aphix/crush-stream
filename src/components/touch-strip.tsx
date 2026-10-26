import { useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronsUp, OctagonX, Zap } from "lucide-react";
import { useBoostTap } from "@/components/use-boost-tap";
import type { HudProps } from "@/components/hud";
import { STRIP, stripReading } from "@/game/hud/touch-scheme";
import { cn } from "@/lib/utils";

/** The strip is a thumb's width (72 px, `w-18`) and tall enough that each zone is a thumb-nail's travel. On a phone on its side the dial stands beside it, so it runs from under the top strip to the bottom edge. */
const STRIP_HEIGHT = "h-[clamp(200px,36vh,280px)] phone-landscape:h-[min(16.5rem,calc(100dvh-max(var(--hud-edge),env(safe-area-inset-top))-3.5rem-max(var(--thumb-edge),env(safe-area-inset-bottom))))]";
const KNOB = 56;
/** Where the knob rests with no finger on it: in the coast zone, so the thumb lands on "nothing pressed". */
const REST_POSITION = (STRIP.brakeTop + STRIP.coastTop) / 2;
const knobBottom = (position: number): string => `calc(${Math.max(0, Math.min(1, position))} * (100% - ${KNOB}px))`;
const percent = (share: number): string => `${share * 100}%`;
const ZONE_MARK = "pointer-events-none absolute inset-x-0 flex flex-col items-center justify-center gap-0.5 font-display text-[10px] font-semibold uppercase leading-none tracking-wider text-fg/70 [&_svg]:size-5";

type StripProps = Pick<HudProps, "engine"> & {
  /** The first finger on the strip: the seat arms (see `touch-controls.tsx`). */
  onArm: () => void;
  /** What the thumb reads now: the caller writes the pad's pedals from it. */
  onThumb: (gas: number, brake: number) => void;
};

/**
 * The right thumb's pedals as one strip: the foot of it brakes (full at the bottom), the middle coasts, the upper part is gas rising to full, and the cap
 * above is Boost, a tap-style latch (`useBoostTap`) taken by sliding into it and ended by sliding back below the gas zone or letting go. Absolute like the steering bar:
 * the knob follows the finger's height, so a thumb always knows where coasting is.
 */
export function PedalStrip({ engine, onThumb, onArm }: StripProps) {
  const strip = useRef<HTMLDivElement>(null);
  const knob = useRef<HTMLDivElement>(null);
  const finger = useRef({ id: -1, inCap: false });
  const boost = useBoostTap(engine);
  const put = (position: number): void => {
    if (knob.current) knob.current.style.bottom = knobBottom(position);
    const reading = stripReading(position);
    if (reading.boost && !finger.current.inCap) boost.tap();
    finger.current.inCap = reading.boost;
    if (reading.gas === 0) boost.release();
    onThumb(reading.gas, reading.brake);
  };
  const move = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerId !== finger.current.id || !strip.current) return;
    const bounds = strip.current.getBoundingClientRect();
    put(1 - (e.clientY - bounds.top) / bounds.height);
  };
  const release = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerId !== finger.current.id) return;
    finger.current = { id: -1, inCap: false };
    if (knob.current) delete knob.current.dataset.drag;
    put(REST_POSITION);
  };
  return (
    <div
      ref={strip}
      role="group"
      aria-label="Pedals: slide down to brake, up for gas, to the top for Boost"
      data-touch-control="pedal-strip"
      data-keep-idle
      className={cn("pointer-events-auto relative w-18 shrink-0 touch-none select-none overflow-hidden rounded-full bg-surface/35 ring-1 ring-inset ring-fg/30", STRIP_HEIGHT)}
      onPointerDown={(e) => {
        if (finger.current.id !== -1) return;
        onArm();
        finger.current.id = e.pointerId;
        e.currentTarget.setPointerCapture(e.pointerId);
        if (knob.current) knob.current.dataset.drag = "";
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
      onContextMenu={(e) => e.preventDefault()}
    >
      <div className="pointer-events-none absolute inset-x-0 bottom-0 bg-signal-red/25" style={{ height: percent(STRIP.brakeTop) }} />
      <div className="pointer-events-none absolute inset-x-0 bg-signal-green/25" style={{ bottom: percent(STRIP.coastTop), height: percent(STRIP.gasTop - STRIP.coastTop) }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 bg-accent/30" style={{ height: percent(1 - STRIP.gasTop) }} />
      <span className={ZONE_MARK} style={{ top: 0, height: percent(1 - STRIP.gasTop) }}>
        <Zap aria-hidden />
        Boost
      </span>
      <span className={ZONE_MARK} style={{ bottom: percent(STRIP.coastTop), height: percent(STRIP.gasTop - STRIP.coastTop) }}>
        <ChevronsUp aria-hidden />
        Gas
      </span>
      <span className={ZONE_MARK} style={{ bottom: 0, height: percent(STRIP.brakeTop) }}>
        <OctagonX aria-hidden />
        Brake
      </span>
      <div
        ref={knob}
        className="pointer-events-none absolute left-1/2 -translate-x-1/2 rounded-full bg-accent/70 ring-1 ring-inset ring-fg/40 transition-[bottom] duration-[var(--motion-quick)] data-[drag]:transition-none"
        style={{ width: KNOB, height: KNOB, bottom: knobBottom(REST_POSITION) }}
      />
    </div>
  );
}
