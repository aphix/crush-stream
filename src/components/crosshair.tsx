/** The aim on foot with a gun in hand: a small ring at the cursor while the mouse is free, at the view's centre otherwise. Nothing with fists or no weapon. */
export function Crosshair({ arms, x, y }: { arms: { slot: number; name: string } | null; x: number | null; y: number | null }) {
  if (arms === null || arms.slot === 0) return null;
  return (
    <div aria-hidden className="pointer-events-none fixed z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60" style={{ left: x ?? "50%", top: y ?? "50%" }}>
      <div className="absolute left-1/2 top-1/2 size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" />
    </div>
  );
}
