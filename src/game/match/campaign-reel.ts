import type { HighlightClip } from "./highlights.ts";

/** Clips the campaign's reel plays. */
export const CAMPAIGN_REEL_CLIPS = 3;

/**
 * How much a clip with a final top-three racer in it counts for over one without (owner: the champions "being in the highlight" is a tie break): its score
 * is weighed ×(1 + this), so the clip with a winner in it ranks ahead of a clip without one up to this far behind it, and exactly tied clips go to the winner.
 */
export const WINNER_LEAN = 0.1;

/** The clip's score as the ranking weighs it: a clip with any of `winners` (car ids) among its cars leans up by `WINNER_LEAN`. */
export function reelWeight(clip: HighlightClip, winners: ReadonlySet<number>): number {
  return clip.score * (clip.cars.some((c) => winners.has(c.slot)) ? 1 + WINNER_LEAN : 1);
}

/**
 * The highlights of a whole campaign, kept as the rounds go so the finale can show its best (docs/HIGHLIGHTS.md "Campaign reel"). Every round's reel adds its clips; a clip is let go once
 * `CAMPAIGN_REEL_CLIPS` others score at least `1 + WINNER_LEAN` times its score, since those rank ahead of it whoever the winners turn out to be. So the memory is the three best clips plus the few
 * within `WINNER_LEAN` of them, however many rounds run (a clip is up to 300 KB).
 */
export class CampaignReel {
  private kept: HighlightClip[] = [];

  /** The clips held now (best first). */
  get clips(): readonly HighlightClip[] {
    return this.kept;
  }

  /** A round's reel: its clips join, and any clip that can no longer reach the top is let go. */
  note(clips: readonly HighlightClip[]): void {
    const all = [...this.kept, ...clips].sort((a, b) => b.score - a.score);
    this.kept = all.filter((clip) => all.filter((other) => other !== clip && other.score >= clip.score * (1 + WINNER_LEAN)).length < CAMPAIGN_REEL_CLIPS);
  }

  /** The reel to show once the campaign is over: the best `CAMPAIGN_REEL_CLIPS` by weighed score, best first (an equal weight keeps the clip the rounds found first). */
  top(winners: ReadonlySet<number>): HighlightClip[] {
    return this.kept
      .map((clip, order) => ({ clip, order, weight: reelWeight(clip, winners) }))
      .sort((a, b) => b.weight - a.weight || a.order - b.order)
      .slice(0, CAMPAIGN_REEL_CLIPS)
      .map((r) => r.clip);
  }

  clear(): void {
    this.kept = [];
  }
}
