import { useRef } from "react";
import { Bookmark, BookmarkCheck, Play, Trash2 } from "lucide-react";
import { NavButton } from "@/components/race-menu-shell";
import { usePadMenu } from "@/components/use-pad-menu";
import { FOCUS } from "@/components/race-menu-styles";
import type { RaceCommand, ReelHud, SavedHud, SaveResult } from "@/game/match/types";
import { flagButton } from "@/game/hud/submit-rules";
import { FlagButton } from "@/components/flag-button";
import { cn } from "@/lib/utils";

type Send = (cmd: RaceCommand) => void;

/** Highlight row: title and detail line, then its touch-sized actions. */
const CLIP_ROW = "flex items-center gap-1.5 rounded-md py-1 pl-2 pr-1 shadow-[var(--shadow-border)]";

/** Why a Save was refused (`SaveResult`), on the clip's row. */
const SAVE_REFUSED: Record<Exclude<SaveResult, "saved">, string> = {
  "too big": "Not saved: this clip is too big to store",
  full: "Not saved: saved highlights are full (delete one in race setup)",
  failed: "Not saved: this browser refused the storage",
};

/** The results reel's clips (docs/HIGHLIGHTS.md): the one on screen now, watch one alone, keep one in this browser. */
export function ReelList({ reel, shown, onCommand }: { reel: ReelHud; shown: number | null; onCommand: Send }) {
  return (
    <section className="mt-3" aria-label="Highlights">
      <div className="flex items-center justify-between gap-2">
        <p className="hud-label">Highlights</p>
        <FlagButton clip={flagButton({ reel, solo: null, shown }).clip} />
      </div>
      <ol className="mt-1 grid gap-1.5">
        {reel.clips.map((c, i) => {
          const now = i === reel.playing;
          return (
            <li key={i} aria-current={now || undefined} className={cn(CLIP_ROW, now ? "bg-accent text-accent-fg" : "bg-surface-2")}>
              <div className="min-w-0 flex-1">
                <p className="truncate font-display text-sm font-semibold leading-tight">{c.title}</p>
                <p className={cn("text-xs tabular-nums", now ? "text-accent-fg" : "text-muted")}>
                  {now ? "Now · " : ""}Score {c.score.toFixed(1)} · {c.cars} {c.cars === 1 ? "car" : "cars"}
                </p>
                {c.saved && c.saved !== "saved" ? (
                  <p role="status" className="text-xs font-semibold">
                    {SAVE_REFUSED[c.saved]}
                  </p>
                ) : null}
              </div>
              <NavButton variant="secondary" className="w-auto px-3" onClick={() => onCommand({ type: "reelView", clip: i })}>
                <Play />
                Watch
              </NavButton>
              <NavButton variant="secondary" className="w-auto px-3" disabled={c.saved === "saved"} onClick={() => onCommand({ type: "reelSave", clip: i })}>
                {c.saved === "saved" ? <BookmarkCheck /> : <Bookmark />}
                {c.saved === "saved" ? "Saved" : "Save"}
              </NavButton>
            </li>
          );
        })}
      </ol>
    </section>
  );
}

/**
 * This browser's saved highlights in the setup menu: play one alone, or delete it. Highlights this build cannot replay are not listed:
 * one line says how many are outdated, with the button that deletes them, and a checkbox purges them as soon as they are found.
 */
export function SavedList({ saved, outdated, autoPurge, onCommand }: { saved: SavedHud[]; outdated: number; autoPurge: boolean; onCommand: Send }) {
  if (saved.length === 0 && outdated === 0 && !autoPurge) return null;
  return (
    <section className="mt-3" aria-label="Saved highlights">
      <p className="hud-label">Saved highlights</p>
      <div className="mt-1 flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        {outdated > 0 ? (
          <div className="flex items-center gap-2 text-xs text-muted">
            <p role="status">
              {outdated} {outdated === 1 ? "replay is" : "replays are"} outdated
            </p>
            <NavButton variant="secondary" className="w-auto px-3" onClick={() => onCommand({ type: "savedPurge" })}>
              Purge now
            </NavButton>
          </div>
        ) : null}
        <label className="ml-auto flex h-11 items-center gap-2 text-xs pointer-fine:h-8">
          <input
            type="checkbox"
            data-nav
            className={cn("size-4 accent-[var(--color-accent)]", FOCUS)}
            checked={autoPurge}
            onChange={(e) => onCommand({ type: "savedAutoPurge", on: e.target.checked })}
          />
          Automatically purge
        </label>
      </div>
      <ul className="mt-1 grid gap-1.5">
        {saved.map((s) => (
          <li key={s.key} className={cn(CLIP_ROW, "bg-surface-2")}>
            <div className="min-w-0 flex-1">
              <p className="truncate font-display text-sm font-semibold leading-tight">{s.title}</p>
              <p className="truncate text-xs text-muted">
                {s.trackName} · {new Date(s.savedAt).toLocaleDateString()}
              </p>
            </div>
            <NavButton variant="secondary" className="w-auto px-3" onClick={() => onCommand({ type: "savedPlay", key: s.key })}>
              <Play />
              Play
            </NavButton>
            <NavButton
              variant="ghost"
              className="w-11 px-0 pointer-fine:w-8"
              aria-label={`Delete ${s.title}`}
              title="Delete"
              onClick={() => onCommand({ type: "savedDelete", key: s.key })}
            >
              <Trash2 />
            </NavButton>
          </li>
        ))}
      </ul>
    </section>
  );
}

/** Solo view (a reel clip or a saved one shown alone): the whole HUD is this transparent exit; a tap, Esc or pad B sends `reelBack`. */
export function SoloExit({ title, shown, onCommand }: { title: string; shown: number | null; onCommand: Send }) {
  const ref = useRef<HTMLButtonElement>(null);
  const back = () => onCommand({ type: "reelBack" });
  // No `[data-nav]` inside: the hook only supplies Esc and B.
  usePadMenu(ref, "solo", { onBack: back, onStart: null });
  return (
    <>
      <button
        ref={ref}
        type="button"
        aria-label="Exit replay"
        title={`${title} · tap or Esc to exit`}
        onClick={back}
        className="pointer-events-auto absolute inset-0 z-30 cursor-pointer bg-transparent outline-none"
      />
      {/* Above the exit tap (its own element: a tap on [!] does not leave the view). */}
      <div className="pointer-events-auto absolute right-3 top-3 z-40 pointer-coarse:hud-right pointer-coarse:hud-top">
        <FlagButton clip={flagButton({ reel: null, solo: title, shown }).clip} />
      </div>
    </>
  );
}
