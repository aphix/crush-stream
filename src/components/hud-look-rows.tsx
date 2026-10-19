import type { HudProps } from "@/components/hud";
import { RangeRow } from "@/components/hud-controls";
import { Button } from "@/components/ui/button";
import { KNOB_RANGES } from "@/game/hud/hud-store";
import { isChanged } from "@/game/hud/settings-changes";

/** `off` for an unset look, else its strength as a percentage. */
const strengthText = (v: number | null): string => (v === null ? "off" : `${Math.round(v * 100)}%`);

/** The looks under Cel in the Playback section: the procedural sky, the two print looks (post tiers only) and the people's rim light. */
export function LookRows({ state, engine }: Pick<HudProps, "state" | "engine">) {
  const noPost = state.fxTier === "off" || state.fxTier === "minimal";
  return (
    <>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1">
          <RangeRow
            label="Clouds"
            changed={isChanged(state, "psky")}
            name="Procedural sky cloud cover"
            title="Draws a procedural sky with this much cloud in place of the painted one"
            value={state.proceduralSky ?? 0}
            min={KNOB_RANGES.psky.min}
            max={KNOB_RANGES.psky.max}
            step={0.01}
            shown={state.proceduralSky === null ? "picture" : strengthText(state.proceduralSky)}
            onValue={(v) => engine.current?.setProceduralSky(v)}
          />
        </div>
        <Button
          className="h-11 shrink-0 px-2 text-xs pointer-fine:h-8"
          variant={state.proceduralSky === null ? "default" : "ghost"}
          aria-pressed={state.proceduralSky === null}
          aria-label="Sky picture"
          title="The time of day's painted sky; the slider draws a procedural one with this much cloud"
          onClick={() => engine.current?.setProceduralSky(null)}
        >
          Picture
        </Button>
      </div>
      {state.sky === "off" ? <p className="hud-label">Sky is off</p> : null}
      <RangeRow
        label="Dots"
        changed={isChanged(state, "halftone")}
        name="Halftone dots"
        value={state.halftone ?? 0}
        min={KNOB_RANGES.dots.min}
        max={KNOB_RANGES.dots.max}
        step={0.01}
        shown={strengthText(state.halftone)}
        disabled={noPost}
        onValue={(v) => engine.current?.setHalftone(v)}
      />
      <RangeRow
        label="Hatch"
        changed={isChanged(state, "hatch")}
        name="Pencil hatching"
        value={state.hatching ?? 0}
        min={KNOB_RANGES.hatch.min}
        max={KNOB_RANGES.hatch.max}
        step={0.01}
        shown={strengthText(state.hatching)}
        disabled={noPost}
        onValue={(v) => engine.current?.setHatching(v)}
      />
      <RangeRow
        label="Rim"
        changed={isChanged(state, "rim")}
        name="Rim light on people"
        value={state.rimLight ?? 0}
        min={KNOB_RANGES.rim.min}
        max={KNOB_RANGES.rim.max}
        step={0.01}
        shown={strengthText(state.rimLight)}
        onValue={(v) => engine.current?.setRimLight(v)}
      />
    </>
  );
}
