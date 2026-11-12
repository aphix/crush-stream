import { useEffect, useState } from "react";

/** The aim on foot with a gun in hand: a small ring at the cursor while the mouse is free, at the view's centre otherwise. Nothing with fists, the hook (its reticle is `TetherArt`'s ring) or no weapon. */
export function Crosshair({ arms, mouseLook }: { arms: { slot: number; name: string } | null; mouseLook: boolean }) {
  const shown = arms !== null && arms.slot !== 0 && arms.name !== "Hook";
  const [pointer, setPointer] = useState<{ x: number; y: number } | null>(null);
  // The cursor is followed only while a ring is drawn: a mouse move elsewhere re-renders nothing.
  useEffect(() => {
    if (!shown) return;
    const move = (e: PointerEvent) => setPointer({ x: e.clientX, y: e.clientY });
    window.addEventListener("pointermove", move);
    return () => window.removeEventListener("pointermove", move);
  }, [shown]);
  if (!shown) return null;
  const at = mouseLook || pointer === null ? null : pointer;
  return (
    <div aria-hidden className="pointer-events-none fixed z-10 size-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border border-white/60" style={{ left: at?.x ?? "50%", top: at?.y ?? "50%" }}>
      <div className="absolute left-1/2 top-1/2 size-0.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/60" />
    </div>
  );
}
