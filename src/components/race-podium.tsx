import { useRef } from "react";
import { Crown, Film, SkipForward } from "lucide-react";
import { usePadMenu } from "@/components/use-pad-menu";
import { FOCUS } from "@/components/race-menu-styles";
import type { PodiumHud, RaceCommand } from "@/game/match/types";
import { cn } from "@/lib/utils";

type Send = (cmd: RaceCommand) => void;

/** A round, translucent pill straight on the view (the touch HUD's look: nothing boxy, nothing over the stand): 40 px on a fine pointer, 48 px on touch. */
const PILL =
  "pointer-events-auto inline-flex h-10 items-center gap-2 rounded-full bg-black/50 px-5 font-display text-sm font-semibold text-white backdrop-blur-sm hover:bg-black/65 pointer-coarse:h-12 [&_svg]:size-4";

/**
 * The podium over the course (docs/PODIUM.md): the HUD is a line of title at the top and a row of pills at the bottom, the view between them left to the stand. Skip (Esc, B, or
 * the pill) takes it down, back to the sheet it came from. A campaign's finale adds "View the highlight reel" where there are clips to play.
 */
export function PodiumView({ podium, onCommand }: { podium: PodiumHud; onCommand: Send }) {
  const ref = useRef<HTMLDivElement>(null);
  const skip = () => onCommand({ type: "podium", on: false });
  usePadMenu(ref, "podium", { onBack: skip, onStart: null });
  const campaign = podium.kind === "campaign";
  return (
    <div ref={ref} className="pointer-events-none absolute inset-0 z-30" role="region" aria-label={campaign ? "Championship podium" : "Race podium"}>
      <p className="hud-ink absolute inset-x-0 hud-top px-4 text-center font-display text-sm font-semibold uppercase tracking-[0.16em] text-white phone-landscape:hidden">
        {campaign ? "Champion" : "Podium"} · <span className="text-signal-amber">{podium.names[0]}</span>
      </p>
      <div className="absolute inset-x-0 hud-bottom flex flex-wrap items-center justify-center gap-2 px-4">
        {podium.reel > 0 ? (
          <button type="button" data-nav className={cn(PILL, FOCUS)} onClick={() => onCommand({ type: "campaignReel" })}>
            <Film />
            View the highlight reel
          </button>
        ) : null}
        <button type="button" data-nav className={cn(PILL, FOCUS)} onClick={skip}>
          {campaign ? <Crown /> : <SkipForward />}
          {campaign ? "Standings" : "Skip"}
        </button>
      </div>
    </div>
  );
}
