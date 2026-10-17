import { Siren, Skull } from "lucide-react";
import { useCoarsePointer } from "@/components/use-coarse-pointer";
import type { RaceHud } from "@/game/match/types";
import { cn } from "@/lib/utils";

/**
 * End-of-run banner: the police stopped your car (`BUST`), or, in Survival, the car is wrecked (engine dead or
 * upside down for good; a thrown driver has its own banner). It shows until the camera moves on. On a touch screen it is
 * a compact one-line card (the caller keeps it out of the road zone), not the big centre-screen one.
 */
export function BustedBanner({ race }: { race: RaceHud }) {
  const touch = useCoarsePointer();
  const you = race.you;
  if (!you || race.spectating !== null) return null;
  const wrecked = race.survival !== null && you.status === "out" && !you.busted && !you.driverOut;
  if (!you.busted && !wrecked) return null;
  const Icon = you.busted ? Siren : Skull;
  return (
    <div className={cn("flex flex-col items-center gap-1 rounded-xl bg-signal-red text-fg shadow-lg", touch ? "px-4 py-1.5" : "px-6 py-3")} role="alert">
      <p className={cn("flex items-center gap-3 font-display font-semibold uppercase leading-none tracking-widest", touch ? "text-2xl" : "text-4xl sm:text-6xl")}>
        <Icon className={touch ? "size-6" : "size-8 sm:size-12"} />
        {you.busted ? "Busted" : "Wrecked"}
      </p>
      <p className={cn("font-medium", touch ? "text-xs" : "text-sm sm:text-base")}>
        {you.busted ? (race.survival ? "The cops boxed you in: the run is over" : "The police stopped you: out of the race") : "Your car is totaled: the run is over"}
      </p>
    </div>
  );
}
