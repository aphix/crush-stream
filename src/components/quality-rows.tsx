import type { HudProps } from "@/components/hud";
import { ChangedDot, SEGMENT, TRACK } from "@/components/hud-controls";
import { Button } from "@/components/ui/button";
import { useQualityPrefs } from "@/components/use-quality";
import { DRAW_DISTANCES, RENDER_SCALES, SHADOW_QUALITIES, type DrawDistance, type ShadowQuality } from "@/game/present/player-quality";
import { cn } from "@/lib/utils";

/** What each Draw distance and Shadows pick does, for the button's hover title. */
const DRAW_TITLE: Record<DrawDistance, string> = {
  auto: "The scene's own view distance and fog",
  far: "1.5× the view distance; the fog thins to match",
  max: "2× the view distance; the fog thins to match",
};
const SHADOW_TITLE: Record<ShadowQuality, string> = {
  auto: "1024² over 48 m",
  high: "2048² over 72 m",
  max: "4096² over 96 m",
};

interface KnobTrackProps<T extends string> {
  /** The row's label, and the track's name (its group's and each button's aria-label prefix). */
  label: string;
  name: string;
  values: readonly T[];
  picked: T;
  /** What the pick gives now, beside the track. */
  readout: string;
  title: (value: T) => string;
  text: (value: T) => string;
  onPick: (value: T) => void;
}

/** One quality knob's row: its label (dotted when off Auto), a track of its values and what is in force. */
function KnobTrack<T extends string>({ label, name, values, picked, readout, title, text, onPick }: KnobTrackProps<T>) {
  return (
    <div className="flex items-center gap-2">
      <span className="hud-label relative w-12 shrink-0">
        {label}
        <ChangedDot on={picked !== "auto"} />
      </span>
      <div className={cn(TRACK, "grid-cols-3")} role="group" aria-label={name}>
        {values.map((value) => (
          <Button
            key={value}
            className={cn(SEGMENT, "capitalize")}
            variant={picked === value ? "default" : "ghost"}
            aria-pressed={picked === value}
            aria-label={`${name} ${value}`}
            title={title(value)}
            onClick={() => onPick(value)}
          >
            {text(value)}
          </Button>
        ))}
      </div>
      <span className="w-12 shrink-0 text-right font-display text-xs tabular-nums text-fg">{readout}</span>
    </div>
  );
}

/** The player's Draw distance, Render scale and Shadows under Sky in the Playback section: each reaches the engine and is saved for this browser. */
export function QualityRows({ state, engine }: Pick<HudProps, "state" | "engine">) {
  const quality = useQualityPrefs();
  return (
    <>
      <KnobTrack
        label="Draw"
        name="Draw distance"
        values={DRAW_DISTANCES}
        picked={state.drawDistance}
        readout={`${state.viewFar} m`}
        title={(value) => DRAW_TITLE[value]}
        text={(value) => value}
        onPick={(value) => {
          engine.current?.setDrawDistance(value);
          quality.setDraw(value);
        }}
      />
      <KnobTrack
        label="Scale"
        name="Render scale"
        values={RENDER_SCALES}
        picked={state.renderScale}
        readout={`${state.pixelRatio}×`}
        title={(value) => (value === "auto" ? "1.5×, 1.25× or 1× by how busy the GPU is in a match (never above the screen's own)" : `${value} rendered pixels per screen pixel`)}
        text={(value) => (value === "auto" ? "Auto" : `${value}×`)}
        onPick={(value) => {
          engine.current?.setRenderScale(value);
          quality.setScale(value);
        }}
      />
      <KnobTrack
        label="Shadow"
        name="Shadow quality"
        values={SHADOW_QUALITIES}
        picked={state.shadowQuality}
        readout={`${state.shadowMap}²`}
        title={(value) => SHADOW_TITLE[value]}
        text={(value) => value}
        onPick={(value) => {
          engine.current?.setShadows(value);
          quality.setShadow(value);
        }}
      />
    </>
  );
}
