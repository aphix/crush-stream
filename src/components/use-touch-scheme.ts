import { useStoredString } from "@/components/use-stored-string";
import { DEFAULT_TOUCH_SCHEME, parseMirror, parseTouchScheme, TILT_DEAD_ZONE_KEY, TILT_FULL_LOCK_KEY, TOUCH_MIRROR_KEY, TOUCH_SCHEME_KEY, type TouchScheme } from "@/game/hud/touch-scheme";
import { parseTiltSettings, TILT, type TiltSettings } from "@/game/hud/tilt-steer";

export type TouchSchemeSettings = {
  scheme: TouchScheme;
  setScheme: (scheme: TouchScheme) => void;
  /** Left-handed: the steering side and the pedal side swap. */
  mirror: boolean;
  setMirror: (mirror: boolean) => void;
  tilt: TiltSettings;
  setTiltFullLock: (degrees: number) => void;
  setTiltDeadZone: (degrees: number) => void;
};

/** The touch controls' stored choices (scheme, mirror, tilt knobs); the server render and a first visit see the defaults. */
export function useTouchScheme(): TouchSchemeSettings {
  const [storedScheme, storeScheme] = useStoredString(TOUCH_SCHEME_KEY, DEFAULT_TOUCH_SCHEME, DEFAULT_TOUCH_SCHEME);
  const [storedMirror, storeMirror] = useStoredString(TOUCH_MIRROR_KEY, "0", "0");
  const [storedFullLock, storeFullLock] = useStoredString(TILT_FULL_LOCK_KEY, String(TILT.fullLockDegrees.default), String(TILT.fullLockDegrees.default));
  const [storedDeadZone, storeDeadZone] = useStoredString(TILT_DEAD_ZONE_KEY, String(TILT.deadZoneDegrees.default), String(TILT.deadZoneDegrees.default));
  return {
    scheme: parseTouchScheme(storedScheme),
    setScheme: storeScheme,
    mirror: parseMirror(storedMirror),
    setMirror: (mirror) => storeMirror(mirror ? "1" : "0"),
    tilt: parseTiltSettings(storedFullLock, storedDeadZone),
    setTiltFullLock: (degrees) => storeFullLock(String(degrees)),
    setTiltDeadZone: (degrees) => storeDeadZone(String(degrees)),
  };
}
