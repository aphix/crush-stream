import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import { ChevronDown, ChevronsLeft, ChevronsRight, ChevronUp } from "lucide-react";
import type { HudProps } from "@/components/hud";
import { Button } from "@/components/ui/button";
import { requestTiltAccess, useTilt } from "@/components/use-tilt";
import type { TiltSettings } from "@/game/hud/tilt-steer";
import { cn } from "@/lib/utils";
import { discReading, sliderSteer, STEER_SLIDER, type SchemeLayout } from "@/game/hud/touch-scheme";

/** Knob travel (px) at full throw: the 56 px knob just reaches the 128 px base's rim. */
const STICK_TRAVEL = 36;

/** The slider's knob (px) and how far its centre travels from the bar's centre: the knob stays inside the bar's ends. */
const SLIDER_KNOB = 56;
const SLIDER_HALF_TRAVEL = (STEER_SLIDER.length - SLIDER_KNOB) / 2;

/** The tilt level marker (px): a thin tick, so it reads as a level and not as a knob to drag; it keeps a small margin to the bar's ends. */
const TILT_MARKER_WIDTH = 8;
const TILT_MARKER_MARGIN = 8;
const TILT_MARKER_TRAVEL = (STEER_SLIDER.length - TILT_MARKER_WIDTH) / 2 - TILT_MARKER_MARGIN;

const BAR_SIZE = { width: STEER_SLIDER.length, height: STEER_SLIDER.height };
/** The disc's two words and arrows on its ring, so nobody wonders what up and down do. */
const DISC_MARK = "pointer-events-none absolute left-1/2 flex -translate-x-1/2 flex-col items-center font-display text-[10px] font-semibold uppercase leading-none tracking-wider text-fg/60";
const BAR = "relative shrink-0 rounded-full bg-surface/35 ring-1 ring-inset ring-fg/30";

type SteerProps = Pick<HudProps, "engine"> & {
  /** The first finger on the steering control: the seat's auto-gas arms (see `touch-controls.tsx`). */
  onArm: () => void;
};

/** Left thumb, stick scheme: x steers (left = LEFT), up is gas, down brakes then reverses, through the pad's left stick and triggers. */
function Stick({ engine, onArm }: SteerProps) {
  const knob = useRef<HTMLDivElement>(null);
  /** The finger on the stick and the base centre it is measured from. */
  const finger = useRef({ id: -1, x: 0, y: 0 });
  const put = (x: number, y: number): void => {
    const t = engine.current?.touch;
    if (t) {
      const reading = discReading(x, y);
      t.x = reading.x;
      t.y = reading.y;
    }
    if (knob.current) knob.current.style.transform = `translate(${x * STICK_TRAVEL}px, ${y * STICK_TRAVEL}px)`;
  };
  useEffect(
    () => () => {
      const t = engine.current?.touch;
      if (t) t.x = t.y = 0;
    },
    [engine],
  );
  const move = (e: ReactPointerEvent<HTMLDivElement>): void => {
    const f = finger.current;
    if (e.pointerId !== f.id) return;
    let x = (e.clientX - f.x) / STICK_TRAVEL;
    let y = (e.clientY - f.y) / STICK_TRAVEL;
    const m = Math.hypot(x, y);
    if (m > 1) {
      x /= m;
      y /= m;
    }
    put(x, y);
  };
  const release = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerId !== finger.current.id) return;
    finger.current.id = -1;
    put(0, 0);
  };
  return (
    <div
      data-touch-control="steer"
      data-keep-idle
      className="pointer-events-auto relative grid size-32 shrink-0 touch-none select-none place-items-center rounded-full bg-surface/35 ring-1 ring-inset ring-fg/30"
      onPointerDown={(e) => {
        const f = finger.current;
        if (f.id !== -1) return;
        onArm();
        const r = e.currentTarget.getBoundingClientRect();
        f.id = e.pointerId;
        f.x = r.left + r.width / 2;
        f.y = r.top + r.height / 2;
        e.currentTarget.setPointerCapture(e.pointerId);
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      <span className={cn(DISC_MARK, "top-1.5")}>
        <ChevronUp aria-hidden className="size-4" />
        Go
      </span>
      <span className={cn(DISC_MARK, "bottom-1.5")}>
        Brake
        <ChevronDown aria-hidden className="size-4" />
      </span>
      <div ref={knob} className="pointer-events-none size-14 rounded-full bg-accent/60 ring-1 ring-inset ring-fg/40" />
    </div>
  );
}

/**
 * Left thumb, Easy and Pedals: a bar with a knob. Absolute, not relative to where the finger lands: the knob follows the finger's x
 * from the bar's centre and the offset is the steering, so the thumb always knows where straight ahead is; let go and it springs back.
 * Steering only (x): the pedals are the other thumb's.
 */
function Slider({ engine, onArm }: SteerProps) {
  const knob = useRef<HTMLDivElement>(null);
  /** The finger on the bar and the bar centre (screen x) it is measured from. */
  const finger = useRef({ id: -1, centre: 0 });
  const put = (offset: number): void => {
    const t = engine.current?.touch;
    if (t) t.x = sliderSteer(offset, SLIDER_HALF_TRAVEL);
    if (knob.current) knob.current.style.transform = `translateX(${Math.max(-SLIDER_HALF_TRAVEL, Math.min(SLIDER_HALF_TRAVEL, offset))}px)`;
  };
  useEffect(
    () => () => {
      const t = engine.current?.touch;
      if (t) t.x = 0;
    },
    [engine],
  );
  const move = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerId === finger.current.id) put(e.clientX - finger.current.centre);
  };
  const release = (e: ReactPointerEvent<HTMLDivElement>): void => {
    if (e.pointerId !== finger.current.id) return;
    finger.current.id = -1;
    // The spring-back is the knob's CSS transition, which is off while a finger drags it.
    if (knob.current) delete knob.current.dataset.drag;
    put(0);
  };
  return (
    <div
      data-touch-control="steer"
      data-keep-idle
      className={cn(BAR, "pointer-events-auto relative flex touch-none select-none items-center justify-center")}
      style={BAR_SIZE}
      onPointerDown={(e) => {
        const f = finger.current;
        if (f.id !== -1) return;
        onArm();
        const r = e.currentTarget.getBoundingClientRect();
        f.id = e.pointerId;
        f.centre = r.left + r.width / 2;
        e.currentTarget.setPointerCapture(e.pointerId);
        if (knob.current) knob.current.dataset.drag = "";
        move(e);
      }}
      onPointerMove={move}
      onPointerUp={release}
      onPointerCancel={release}
      onLostPointerCapture={release}
    >
      {/* The two ends say which way is which, so a bar with a knob reads as a wheel. */}
      <ChevronsLeft aria-hidden className="pointer-events-none absolute left-2 size-5 text-fg/50" />
      <ChevronsRight aria-hidden className="pointer-events-none absolute right-2 size-5 text-fg/50" />
      <div
        ref={knob}
        className="pointer-events-none rounded-full bg-accent/60 ring-1 ring-inset ring-fg/40 transition-transform duration-[var(--motion-quick)] data-[drag]:transition-none"
        style={{ width: SLIDER_KNOB, height: SLIDER_KNOB }}
      />
    </div>
  );
}

/**
 * Left thumb, Tilt: the phone's tilt steers; the bar only shows it (a level marker follows the steering value) and a tap on it
 * recentres, the way a wheel is straightened. Until the first orientation event arrives (iOS asks first, a desktop has no sensor) the bar is an
 * Enable tilt button. `steerLive` is false while the car is not the player's to drive (following one must not take the wheel by tilting).
 */
function TiltBar({ engine, tilt, onArm, steerLive }: SteerProps & { tilt: TiltSettings; steerLive: () => boolean }) {
  const marker = useRef<HTMLDivElement>(null);
  const { available, recentre } = useTilt(true, tilt, (steer) => {
    const t = engine.current?.touch;
    if (t) t.x = steerLive() ? steer : 0;
    if (marker.current) marker.current.style.transform = `translateX(${steer * TILT_MARKER_TRAVEL}px)`;
  });
  if (!available) {
    return (
      <div data-touch-control="steer" data-keep-idle className={cn(BAR, "pointer-events-none flex items-center justify-center")} style={BAR_SIZE}>
        <Button variant="secondary" className="pointer-events-auto h-11 touch-none select-none px-4" onClick={() => void requestTiltAccess().then(() => recentre())}>
          Enable tilt
        </Button>
      </div>
    );
  }
  const level = <div ref={marker} className="pointer-events-none h-10 rounded-full bg-accent/70" style={{ width: TILT_MARKER_WIDTH }} />;
  return (
    <button
      type="button"
      tabIndex={-1}
      aria-label="Centre tilt"
      data-touch-control="steer"
      data-keep-idle
      className={cn(BAR, "pointer-events-auto flex touch-none select-none items-center justify-center")}
      style={BAR_SIZE}
      onPointerDown={onArm}
      onClick={() => recentre()}
    >
      {level}
    </button>
  );
}

/** The steering control of a scheme (`schemeLayout(scheme).steer`), drawn where its cluster puts it. */
export function TouchSteer({ steer, tilt, steerLive, ...rest }: SteerProps & { steer: SchemeLayout["steer"]; tilt: TiltSettings; steerLive: () => boolean }) {
  if (steer === "stick") return <Stick {...rest} />;
  if (steer === "tilt") return <TiltBar {...rest} tilt={tilt} steerLive={steerLive} />;
  return <Slider {...rest} />;
}
