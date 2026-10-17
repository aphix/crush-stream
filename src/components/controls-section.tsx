import { useState } from "react";
import { Button } from "@/components/ui/button";
import { RangeRow } from "@/components/hud-controls";
import { requestTiltAccess, type TiltAccess } from "@/components/use-tilt";
import { useTouchScheme } from "@/components/use-touch-scheme";
import { TILT } from "@/game/hud/tilt-steer";
import { TOUCH_SCHEMES, TOUCH_SCHEME_HINT, TOUCH_SCHEME_LABEL } from "@/game/hud/touch-scheme";
import { cn } from "@/lib/utils";

const SEGMENT = "h-11 px-1 text-xs";

/**
 * The four schemes as one row of segments with the chosen one's hint under it: small enough for the Pause card, so the player can
 * change how the car is driven without leaving the race. Choosing Tilt asks for the sensor where the browser needs a tap for it.
 */
export function SchemePicker({ className }: { className?: string }) {
  const { scheme, setScheme } = useTouchScheme();
  return (
    <div className={className}>
      <div className="grid grid-cols-4 gap-0.5 rounded-md bg-surface-2/70 p-0.5" role="group" aria-label="Touch controls">
        {TOUCH_SCHEMES.map((id) => (
          <Button
            key={id}
            variant={scheme === id ? "default" : "ghost"}
            aria-pressed={scheme === id}
            className={SEGMENT}
            onClick={() => {
              setScheme(id);
              if (id === "tilt") void requestTiltAccess();
            }}
          >
            {TOUCH_SCHEME_LABEL[id]}
          </Button>
        ))}
      </div>
      <p className="px-1 pt-1 text-xs text-muted" role="status">
        {TOUCH_SCHEME_HINT[scheme]}
      </p>
    </div>
  );
}

/** The Settings sheet's Controls section: the scheme, left-handed, and the tilt's two knobs (only while Tilt is the scheme). */
export function ControlsSection({ className }: { className?: string }) {
  const { scheme, mirror, setMirror, tilt, setTiltFullLock, setTiltDeadZone } = useTouchScheme();
  const [access, setAccess] = useState<TiltAccess | null>(null);
  return (
    <div className={cn("space-y-1.5", className)}>
      <SchemePicker />
      <Button variant={mirror ? "default" : "ghost"} aria-pressed={mirror} className={cn(SEGMENT, "w-full")} onClick={() => setMirror(!mirror)}>
        Left-handed: steer on the right
      </Button>
      {scheme === "tilt" ? (
        <>
          <RangeRow label="Turn" name="Tilt for full lock" value={tilt.fullLockDegrees} min={TILT.fullLockDegrees.min} max={TILT.fullLockDegrees.max} step={1} shown={`${tilt.fullLockDegrees}°`} onValue={setTiltFullLock} />
          <RangeRow label="Dead" name="Tilt dead zone" value={tilt.deadZoneDegrees} min={TILT.deadZoneDegrees.min} max={TILT.deadZoneDegrees.max} step={0.5} shown={`${tilt.deadZoneDegrees}°`} onValue={setTiltDeadZone} />
          <Button
            variant="secondary"
            className={cn(SEGMENT, "w-full")}
            onClick={async () => setAccess(await requestTiltAccess())}
          >
            Enable tilt sensor
          </Button>
          {access === "denied" ? <p className="px-1 text-xs text-muted">The browser refused the sensor: allow motion access for this site in its settings.</p> : null}
          {access === "unsupported" ? <p className="px-1 text-xs text-muted">This device has no tilt sensor.</p> : null}
        </>
      ) : null}
    </div>
  );
}
