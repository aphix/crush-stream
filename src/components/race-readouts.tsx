import { useState, type ReactNode } from "react";
import { showsDriveReadouts } from "@/components/drive-readouts";
import { brakeTint } from "@/components/brake-tint";
import { nitroGlowStyle } from "@/components/nitro-glow";
import { DriveCluster } from "@/components/race-gauge";
import { fmtGap, fmtTime } from "@/game/hud/race-clock";
import { useCoarsePointer } from "@/components/use-coarse-pointer";
import { useTouchScheme } from "@/components/use-touch-scheme";
import { useSpeedUnit } from "@/components/use-speed-unit";
import { SurvivalReadout } from "@/components/survival-hud";
import type { RaceHud, RaceView } from "@/game/match/types";
import { formatSpeed } from "@/game/hud/speed-units";
import { KPH_PER_MS } from "@/game/kernel/constants";
import { cn } from "@/lib/utils";

/** Seconds the split vs the leader stays up after each checkpoint. */
const SPLIT_FLASH = 3;

/** Boost meter cells (Burnout's segmented bar). */
const CELLS = 8;

/** One clock in the readouts cluster: label and value on one line. */
function Clock({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline gap-1">
      <dt className="uppercase tracking-[0.12em] text-fg/70">{label}</dt>
      <dd className="font-semibold">{value}</dd>
    </div>
  );
}

/** Shows the split for `SPLIT_FLASH` race seconds each time it changes (not the one present on mount). */
function useSplitFlash(split: number | null, time: number): boolean {
  const [seen, setSeen] = useState<{ split: number | null; at: number }>({ split, at: -Infinity });
  if (seen.split !== split) setSeen({ split, at: time });
  return split !== null && seen.split === split && time - seen.at < SPLIT_FLASH;
}

/**
 * The race readouts of the driven car, or the watched car's while spectating (what its driver sees), drawn
 * straight on the view (`hud-ink`): position, lap and clocks top right, the speed, gear and boost gauge under
 * them, or in the bottom-right corner (`corner`, the arcade racers' spot) where no thumb pad sits there. On a touch screen
 * they are one band top left instead (position, lap and time, then a thin line of clocks), with the dial bottom centre. None while
 * the results reel plays: its cameras ride replayed wrecks, not a racer.
 */
export function RaceReadouts({ race, corner }: { race: RaceHud; corner: boolean }) {
  const view = race.view;
  if (!view || !showsDriveReadouts(race)) return null;
  // Keyed by car: switching the watched car doesn't flash the new car's standing split.
  return <Cluster key={view.id} race={race} view={view} corner={corner} />;
}

/**
 * The phone's read-out band, top left (never the top right: the strip of buttons owns it): the whole group fades while the player drives (`calm:`).
 * The first row stays narrow in portrait (the strip owns the rest of that row) and under 42 % of the width on a phone on its side.
 */
const PHONE_BAND =
  "pointer-events-none absolute hud-left hud-top flex max-w-[10.5rem] flex-col items-start gap-0.5 font-display tabular-nums phone-landscape:max-w-[42vw] calm:opacity-35 hud-fade";

/** The band's thin line: small clocks that wrap rather than grow wide. */
const PHONE_THIN_LINE = "hud-ink flex flex-wrap items-center gap-x-2 text-[11px] leading-4";

/** The split vs the leader, in a slot that keeps its width while hidden so the line does not jump when it appears. */
function SplitPill({ split, flash, className }: { split: number | null; flash: boolean; className: string }) {
  return (
    <p
      className={cn("rounded-full bg-accent px-2 font-semibold text-accent-fg transition-opacity duration-[var(--motion-fast)]", className, flash ? "opacity-100" : "opacity-0")}
      aria-live="polite"
    >
      {split === null ? "–" : split === 0 ? "Lead" : `Split ${fmtGap(split)}`}
    </p>
  );
}

/** The phone's race lines: place, lap and clock in one line; last, best and the split in a thin one under it. */
function PhoneRaceLines({ race, racer, flash }: { race: RaceHud; racer: NonNullable<RaceView["racer"]>; flash: boolean }) {
  return (
    <>
      <div className="hud-ink flex items-baseline gap-2 whitespace-nowrap">
        <p className="text-2xl font-semibold leading-none tracking-tight phone-landscape:text-3xl">
          P{racer.place}
          <span className="text-sm font-medium text-fg/70">/{race.field}</span>
        </p>
        <p className="text-[10px] font-semibold uppercase tracking-[0.12em] text-fg/70">
          Lap <span className="text-sm text-fg">{racer.lap}</span>/{race.laps}
        </p>
        <p className="text-base font-semibold leading-none" aria-label="Race time">
          {fmtTime(race.time)}
        </p>
      </div>
      <div className={PHONE_THIN_LINE}>
        {racer.done === null ? null : <span aria-label="Race completed">{Math.floor(racer.done * 100)}%</span>}
        <dl className="flex gap-2">
          <Clock label="Last" value={racer.lastLap === null ? "–" : fmtTime(racer.lastLap)} />
          <Clock label="Best" value={racer.bestLap === null ? "–" : fmtTime(racer.bestLap)} />
        </dl>
        <SplitPill split={racer.split} flash={flash} className="text-xs leading-4" />
      </div>
    </>
  );
}

function Cluster({ race, view, corner }: { race: RaceHud; view: RaceView; corner: boolean }) {
  const touch = useCoarsePointer();
  const r = view.racer;
  const flash = useSplitFlash(r?.split ?? null, race.time);
  if (touch) {
    return (
      <>
        <div className={PHONE_BAND}>
          {race.survival ? (
            <SurvivalReadout race={race} survival={race.survival} phone />
          ) : r ? (
            <PhoneRaceLines race={race} racer={r} flash={flash} />
          ) : null}
        </div>
        <Dial view={view} corner={false} spectated={race.spectating !== null} />
      </>
    );
  }
  return (
    <div className="flex flex-col items-end gap-1 self-start text-right font-display tabular-nums" style={{ gridArea: "readouts" }}>
      {race.survival ? (
        <SurvivalReadout race={race} survival={race.survival} />
      ) : r ? (
        <>
          <div className="hud-ink flex items-baseline gap-3">
            <p className="text-sm font-semibold uppercase tracking-[0.12em] text-fg/70">
              Lap <span className="text-2xl text-fg">{r.lap}</span>/{race.laps}
            </p>
            <p className="text-5xl font-semibold leading-none tracking-tight">
              P{r.place}
              <span className="text-xl font-medium text-fg/70">/{race.field}</span>
            </p>
          </div>
          <div className={cn("hud-ink flex items-center gap-3", corner && "md:gap-4")}>
            <p className={cn("text-xl font-semibold leading-none", corner && "md:text-3xl")} aria-label="Race time">
              {fmtTime(race.time)}
            </p>
            {r.done === null ? null : (
              <>
                <span className={cn("h-6 w-px bg-fg/40", corner && "md:h-12")} aria-hidden />
                <p className={cn("text-3xl font-semibold leading-none tracking-tight", corner && "md:text-7xl")} aria-label="Race completed">
                  {Math.floor(r.done * 100)}
                  <span className={cn("ml-0.5 text-lg font-medium text-fg/70", corner && "md:text-3xl")}>%</span>
                </p>
              </>
            )}
          </div>
          <dl className="hud-ink flex gap-3 text-xs">
            <Clock label="Lap" value={fmtTime(r.lapTime)} />
            <Clock label="Last" value={r.lastLap === null ? "–" : fmtTime(r.lastLap)} />
            <Clock label="Best" value={r.bestLap === null ? "–" : fmtTime(r.bestLap)} />
          </dl>
        </>
      ) : null}
      <Gauge view={view} corner={corner} spectated={race.spectating !== null} />
      {race.survival ? null : <SplitPill split={r?.split ?? null} flash={flash} className="text-sm leading-5" />}
    </div>
  );
}

/**
 * The drive cluster in its slot: the bottom right corner, as it always was (on a phone 80 px, in either orientation, the right thumb's pedals standing
 * above it and Boost and Handbrake beside it; the left corner when the controls are mirrored). It fades with the rest while the player drives.
 * Its bottle boosts when tapped, unless the car is a `spectated` one.
 */
function Dial({ view, corner, spectated }: { view: RaceView; corner: boolean; spectated: boolean }) {
  const { mirror } = useTouchScheme();
  return (
    <div
      className={cn(
        "absolute bottom-4 right-4 hidden pointer-coarse:hud-bottom pointer-coarse:block pointer-coarse:[--phone-cluster:5rem] pointer-coarse:calm:opacity-60 pointer-coarse:hud-fade",
        mirror ? "pointer-coarse:hud-left pointer-coarse:right-auto" : "pointer-coarse:hud-right",
        corner && "md:block",
      )}
    >
      <DriveCluster view={view} boostable={!spectated} />
    </div>
  );
}

/** The segmented boost meter (lit while burning) with the draft cue; a car with no nitrous (`boost` null) shows it empty and greyed. `barClass` sizes the bar. */
function BoostMeter({ view, barClass }: { view: RaceView; barClass: string }) {
  const boost = view.boost;
  return (
    <div className={cn("flex items-center gap-2", boost === null && "opacity-30")}>
      {view.racer?.drafting ? <span className="hud-ink text-[10px] font-semibold uppercase tracking-[0.12em] text-accent">Draft</span> : null}
      <span className="hud-ink text-[10px] font-semibold uppercase tracking-[0.12em] text-fg/70">{boost === null ? "No boost" : "Boost"}</span>
      <div
        className={cn("flex gap-0.5 transition-[filter] duration-[var(--motion-fast)]", barClass)}
        style={nitroGlowStyle("bar", boost, view.boosting)}
        role="meter"
        aria-label="Boost"
        aria-valuenow={Math.round((boost ?? 0) * 100)}
      >
        {Array.from({ length: CELLS }, (_, i) => (
          <div key={i} className="flex-1 overflow-hidden rounded-[2px] bg-fg/25 shadow-[var(--shadow-border)]">
            <div className={cn("h-full", view.boosting > 0 ? "bg-fg" : "bg-accent")} style={{ width: `${Math.round(Math.min(1, Math.max(0, (boost ?? 0) * CELLS - i)) * 100)}%` }} />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Speed and gear over the segmented boost meter (lit while burning) and the draft cue; the derby driver's readout too. In `corner` mode a big window, and a phone on its side whatever `corner` says, gets the race's drive cluster (`Dial`) instead; there its bottle boosts when tapped, unless the car is a `spectated` one. */
export function Gauge({ view, corner, spectated = false }: { view: RaceView; corner: boolean; spectated?: boolean }) {
  const unit = useSpeedUnit();
  return (
    <>
      <Dial view={view} corner={corner} spectated={spectated} />
      <div className={cn("flex flex-col items-end gap-1 phone-landscape:hidden", corner && "md:hidden")}>
        <div className="hud-ink flex items-baseline gap-2">
          <p className="grid size-7 place-items-center self-center rounded-md text-lg font-semibold leading-none shadow-[var(--shadow-border)]" aria-label="Gear">
            {view.gear === 0 ? "R" : view.gear}
          </p>
          <p className="text-3xl font-semibold leading-none tracking-tight transition-colors duration-[var(--motion-quick)]" style={{ color: brakeTint(view.brakeCue) }} aria-label="Speed">
            {formatSpeed(view.speedKph / KPH_PER_MS, unit)}
            <span className="ml-0.5 text-xs font-medium text-fg/70">{unit}</span>
          </p>
        </div>
        <BoostMeter view={view} barClass="h-2 w-24" />
      </div>
    </>
  );
}
