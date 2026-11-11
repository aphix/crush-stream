/** A game minute of the day as a 12-hour clock: 0 is `12:00 AM`, 720 is `12:00 PM`, 1265 is `9:05 PM`. */
export function fmtClock12(minute: number): string {
  const m = ((Math.floor(minute) % 1440) + 1440) % 1440;
  const h = Math.floor(m / 60);
  return `${h % 12 === 0 ? 12 : h % 12}:${String(m % 60).padStart(2, "0")} ${h < 12 ? "AM" : "PM"}`;
}

/** m:ss.mmm; negative clock (before green) reads 0. */
export function fmtTime(seconds: number): string {
  const ms = Math.round(Math.max(0, seconds) * 1000);
  const s = Math.floor(ms / 1000);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}.${String(ms % 1000).padStart(3, "0")}`;
}

export function fmtGap(seconds: number): string {
  return seconds < 60 ? `+${seconds.toFixed(2)}` : `+${fmtTime(seconds)}`;
}
