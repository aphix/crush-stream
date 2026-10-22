import { useStoredString } from "@/components/use-stored-string";

/** localStorage keys of this browser's quality knobs. */
const QUALITY_KEY = { draw: "crush.quality.draw", scale: "crush.quality.scale", shadow: "crush.quality.shadow" } as const;

/** This browser's Draw distance, Render scale and Shadows ("auto" until picked); `CrashLab` mirrors them into the engine. */
export function useQualityPrefs(): { draw: string; scale: string; shadow: string; setDraw: (v: string) => void; setScale: (v: string) => void; setShadow: (v: string) => void } {
  const [draw, setDraw] = useStoredString(QUALITY_KEY.draw, "auto", "auto");
  const [scale, setScale] = useStoredString(QUALITY_KEY.scale, "auto", "auto");
  const [shadow, setShadow] = useStoredString(QUALITY_KEY.shadow, "auto", "auto");
  return { draw, scale, shadow, setDraw, setScale, setShadow };
}
