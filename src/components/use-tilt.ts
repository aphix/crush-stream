import { useEffect, useRef, useState } from "react";
import { aroundCentre, tiltSteer, wheelAngle, type TiltSettings } from "@/game/hud/tilt-steer";

/** iOS Safari (13+) asks before it sends orientation events, and only from a tap; other browsers have no `requestPermission`. */
type OrientationWithPermission = typeof DeviceOrientationEvent & { requestPermission?: () => Promise<"granted" | "denied"> };

export type TiltAccess = "granted" | "denied" | "unsupported";

/** Ask for the orientation events from a tap. "granted" where the browser needs no asking and has the events. */
export async function requestTiltAccess(): Promise<TiltAccess> {
  if (typeof DeviceOrientationEvent === "undefined") return "unsupported";
  const ask = (DeviceOrientationEvent as OrientationWithPermission).requestPermission;
  if (ask === undefined) return "granted";
  try {
    return await ask.call(DeviceOrientationEvent);
  } catch (error) {
    console.warn("Tilt permission request failed", error);
    return "denied";
  }
}

/** The screen's rotation in degrees: the standard API, the old `window.orientation` on iPhone Safari, else upright. */
function screenRotation(): number {
  if (screen.orientation) return screen.orientation.angle;
  const legacy = (window as Window & { orientation?: number }).orientation;
  return legacy ?? 0;
}

/**
 * The phone's tilt as steering while `active`: every orientation event becomes a wheel angle (`wheelAngle`), measured from where the
 * phone was held at the first event (or at the last `recentre()`), then the pad's steering value (`tiltSteer`), handed to `onSteer`.
 * `available` turns true with the first event, so the UI can offer "Enable tilt" while it is still false (a browser that asks
 * first, a desktop with no sensor). Releases the steering (0) when it stops.
 */
export function useTilt(active: boolean, settings: TiltSettings, onSteer: (steer: number) => void): { available: boolean; recentre: () => void } {
  const [available, setAvailable] = useState(false);
  const centre = useRef<number | null>(null);
  const latest = useRef({ settings, onSteer });
  latest.current = { settings, onSteer };
  useEffect(() => {
    if (!active) return;
    const onOrientation = (event: DeviceOrientationEvent): void => {
      if (event.beta === null || event.gamma === null) return;
      setAvailable(true);
      const angle = wheelAngle(event.beta, event.gamma, screenRotation());
      centre.current ??= angle;
      latest.current.onSteer(tiltSteer(aroundCentre(angle, centre.current), latest.current.settings));
    };
    window.addEventListener("deviceorientation", onOrientation);
    return () => {
      window.removeEventListener("deviceorientation", onOrientation);
      latest.current.onSteer(0);
    };
  }, [active]);
  return { available, recentre: () => (centre.current = null) };
}
