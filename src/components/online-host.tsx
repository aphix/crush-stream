import type { RefObject } from "react";
import { GameOptions } from "@/components/game-options";
import { useAutoNext } from "@/components/use-auto-next";
import { PlayersStepper } from "@/components/players-stepper";
import { Button } from "@/components/ui/button";
import type { CrashEngine } from "@/game/engine/engine";
import { FIELD, FIELD_LABEL, type HostDraft } from "@/components/online-host-shared";
import { NET_TX } from "@/game/net/net-ports";
import { ROOM_MAX } from "@/lib/multiplayer/rooms";
import { cn } from "@/lib/utils";

/** Buttons and fields: 44 px tall on phones, 32 px with a mouse. */
const CONTROL = "h-11 pointer-fine:h-8";
const keepFocus = (e: { preventDefault: () => void }): void => e.preventDefault();
/** Generated passwords: 8 of these 32 characters (no I, O, 0 or 1) from `crypto.getRandomValues`, 40 bits, unguessable. */
const CODE_CHARS = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

/** The one hosting form, for every game (docs/MULTIPLAYER.md "Rooms, joining, migration"): the game and its options, who may join, how many players Go waits for. */
export function HostForm({ engine, draft, onDraft, onHosted }: { engine: RefObject<CrashEngine | null>; draft: HostDraft; onDraft: (draft: HostDraft) => void; onHosted: () => void }) {
  const [autoNext] = useAutoNext();
  const net = engine.current?.net;
  if (!net) return null;
  const menu = net.courseMenu();
  const set = (patch: Partial<HostDraft>): void => onDraft({ ...draft, ...patch });
  const isPublic = draft.visibility === "public";
  const host = (): void => {
    const code = isPublic ? null : draft.code.trim().toUpperCase() || Array.from(crypto.getRandomValues(new Uint8Array(8)), (b) => CODE_CHARS[b & 31]).join("");
    net.hostRoom({
      kind: draft.kind,
      code,
      tx: isPublic ? NET_TX.rtc : draft.tx,
      minPlayers: draft.minPlayers,
      course: draft.kind === "survival" ? draft.survivalCourse : draft.raceCourse,
      playlist: draft.playlist,
      autoNext,
    });
    onHosted();
  };
  return (
    // A phone on its side has the width and not the height: what to play and who may join stand left, the password, player count and Host right.
    <div className="grid gap-2 phone-landscape:grid-cols-2 phone-landscape:items-start phone-landscape:gap-x-4">
      <div className="space-y-2">
        <GameOptions
          kind={draft.kind}
          onKind={(kind) => set({ kind })}
          course={draft.kind === "survival" ? draft.survivalCourse : draft.raceCourse}
          onCourse={(id) => set(draft.kind === "survival" ? { survivalCourse: id } : { raceCourse: id })}
          playlist={draft.playlist}
          onPlaylist={(playlist) => set({ playlist })}
          menu={menu}
        />
        <div className="flex gap-1" role="group" aria-label="Who can join">
          {(["public", "private"] as const).map((v) => (
            <Button key={v} className={cn(CONTROL, "flex-1 px-2 text-xs pointer-coarse:text-sm")} variant={draft.visibility === v ? "default" : "secondary"} aria-pressed={draft.visibility === v} onMouseDown={keepFocus} onClick={() => set({ visibility: v })}>
              {v === "public" ? "Public" : "Private"}
            </Button>
          ))}
        </div>
        {isPublic ? <p className="text-subtle">Listed for anyone to join.</p> : null}
      </div>
      <div className="space-y-2">
        {isPublic ? null : (
          <>
            <label className="flex items-center gap-2">
              <span className={FIELD_LABEL}>Password</span>
              <input
                value={draft.code}
                onChange={(e) => set({ code: e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "") })}
                placeholder="new password"
                maxLength={12}
                aria-label="Room password"
                className={cn(CONTROL, FIELD, "font-display uppercase")}
              />
            </label>
            <label className="flex items-center gap-2">
              <span className={FIELD_LABEL}>Link</span>
              <select value={draft.tx} onChange={(e) => set({ tx: e.target.value === NET_TX.bc ? NET_TX.bc : NET_TX.rtc })} aria-label="Connection" className={cn(CONTROL, FIELD)}>
                <option value={NET_TX.rtc}>Internet (WebRTC)</option>
                <option value={NET_TX.bc}>This browser (tabs)</option>
              </select>
            </label>
            <p className="text-subtle">Not listed: players join with this password or your link.</p>
          </>
        )}
        <PlayersStepper value={draft.minPlayers} onStep={(by) => set({ minPlayers: Math.min(ROOM_MAX, Math.max(1, draft.minPlayers + by)) })} />
        <Button className={cn(CONTROL, "w-full text-xs pointer-coarse:text-sm")} disabled={draft.kind === "campaign" && draft.playlist.length === 0} onClick={host}>
          Host {isPublic ? "public" : "private"} room
        </Button>
      </div>
    </div>
  );
}
