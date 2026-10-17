import { ChevronLeft } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

/** Inside a sheet, the same four safe-area offsets the HUD's edge pieces use (`hud-top` and friends in styles.css), as padding. */
const SAFE_PADDING = {
  paddingTop: "max(var(--hud-edge), env(safe-area-inset-top))",
  paddingRight: "max(var(--hud-edge), env(safe-area-inset-right))",
  paddingBottom: "max(var(--hud-edge), env(safe-area-inset-bottom))",
  paddingLeft: "max(var(--hud-edge), env(safe-area-inset-left))",
} as const;

/**
 * A phone's full-screen menu: it fades in over the live view and the player taps Back to return to it. Between runs the menus are sheets,
 * never panels hung on the view (the road stays free while driving).
 * - `full`: covers the screen (the view dims behind it), for the Home menu, Online and anything long.
 * - `dock`: a panel on the right half of a phone on its side, or the bottom 70 % of an upright one, with the view left running and
 *   undimmed beside it, so a slider's effect can be watched while it is moved (Settings).
 * Must sit inside `.hud-grid` (the HUD root, which covers the screen).
 */
export function Sheet({ title, edge, onClose, children, className }: { title: string; edge: "full" | "dock"; onClose: () => void; children: ReactNode; className?: string }) {
  return (
    <div className="hud-sheet-in pointer-events-none absolute inset-0 z-40" data-keep-idle>
      {edge === "full" ? <div className="pointer-events-auto absolute inset-0 bg-bg/95" /> : null}
      <section
        role="dialog"
        aria-label={title}
        aria-modal={edge === "full" || undefined}
        style={edge === "full" ? SAFE_PADDING : { paddingRight: SAFE_PADDING.paddingRight, paddingBottom: SAFE_PADDING.paddingBottom }}
        className={cn(
          "pointer-events-auto absolute flex min-h-0 flex-col gap-1 text-fg",
          edge === "full" ? "inset-0" : "bottom-0 right-0 h-[70dvh] w-full rounded-t-2xl bg-surface shadow-[var(--shadow-border)] landscape:inset-y-0 landscape:h-auto landscape:w-[min(26rem,56vw)] landscape:rounded-none landscape:rounded-l-2xl",
          className,
        )}
      >
        <header className="flex h-12 shrink-0 items-center gap-2 pl-1">
          <Button variant="ghost" className="h-12 min-w-12 gap-1 px-2" aria-label={`Back from ${title}`} onClick={onClose}>
            <ChevronLeft />
            <span className="text-sm">Back</span>
          </Button>
          <h2 className="min-w-0 truncate font-display text-lg font-semibold uppercase tracking-[0.12em]">{title}</h2>
        </header>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain pl-2">{children}</div>
      </section>
    </div>
  );
}
