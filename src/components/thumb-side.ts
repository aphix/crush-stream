const THUMB_SIDE = { left: "thumb-left", right: "thumb-right" } as const;
const DISC_SIDE = { left: "hud-left", right: "hud-right" } as const;

/** The screen edge a thumb cluster stands at: the Disc keeps the HUD's own margin, every other scheme keeps the wider one that clears the system's edge gestures. */
export function thumbSideClass(side: "left" | "right", disc: boolean): string {
  return (disc ? DISC_SIDE : THUMB_SIDE)[side];
}
