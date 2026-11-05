import type { GameKind } from "@/game/net/codec";
import { NET_TX, type CourseMenu, type NetTx } from "@/game/net/net-ports";
import { DEFAULT_MIN_PLAYERS } from "@/game/net/net-constants";

/** A field's caption: on a phone it is 14 px and wide enough for "Password". */
export const FIELD_LABEL = "hud-label w-12 shrink-0 pointer-coarse:w-24 pointer-coarse:text-sm";
/** A text field or list: 16 px on a phone, since iOS zooms the page in on focusing anything smaller. */
export const FIELD = "w-full rounded-md bg-surface-2 px-2 pointer-coarse:text-base";

/** What the hosting panel holds between openings: the host's picks before the room exists. */
export interface HostDraft {
  kind: GameKind;
  /** Public: listed for anyone. Private: unlisted, joined by the password (the room code). */
  visibility: "public" | "private";
  /** The private room's password; empty makes one up. */
  code: string;
  tx: NetTx;
  minPlayers: number;
  raceCourse: string;
  survivalCourse: string;
  playlist: readonly string[];
}

/** A first draft: a public race on the menu's first course, the campaign over every course, Survival on the first Survival course. */
export function newDraft(menu: CourseMenu): HostDraft {
  return {
    kind: "race",
    visibility: "public",
    code: "",
    tx: NET_TX.rtc,
    minPlayers: DEFAULT_MIN_PLAYERS,
    raceCourse: menu.courses[0]?.id ?? "",
    survivalCourse: menu.survival[0]?.id ?? "",
    playlist: menu.courses.map((c) => c.id),
  };
}
