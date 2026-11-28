import { cn } from "@/lib/utils";

/** The spokes' distance (px) from the wheel's middle. */
const RADIUS_PX = 92;

/** The weapon wheel while LB or Tab is held: one spoke a weapon, the first at twelve o'clock and clockwise, the picked one lit. Nothing while it is shut. */
export function WeaponWheel({ wheel }: { wheel: { pick: number; spokes: readonly string[] } | null }) {
  if (wheel === null) return null;
  return (
    <div role="listbox" aria-label="Weapon wheel" className="pointer-events-none fixed left-1/2 top-1/2 z-20 size-0">
      {wheel.spokes.map((name, spoke) => {
        const turn = (2 * Math.PI * spoke) / wheel.spokes.length;
        return (
          <div
            key={name}
            role="option"
            aria-selected={spoke === wheel.pick}
            className={cn("hud-ink hud-label absolute -translate-x-1/2 -translate-y-1/2 whitespace-nowrap rounded-full border px-3 py-1", spoke === wheel.pick ? "border-white bg-white/30 text-fg" : "border-white/30 bg-black/40 text-fg/60")}
            style={{ left: Math.sin(turn) * RADIUS_PX, top: -Math.cos(turn) * RADIUS_PX }}
          >
            {name}
          </div>
        );
      })}
    </div>
  );
}
