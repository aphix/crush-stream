import { useEffect, type RefObject } from "react";
import type { CrashEngine } from "@/game/engine/engine";
import { netDeepLink } from "@/game/hud/share-url";

/** `?net=join&room=CODE[&tx=bc]` joins that room once, when the engine is up (`booted`). Lives with the page, not with the online entry, which comes and goes with the HUD. */
export function useDeepLinkJoin(engine: RefObject<CrashEngine | null>, booted: boolean): void {
  useEffect(() => {
    if (!booted) return;
    const link = netDeepLink(window.location.search);
    if (!link?.join) return;
    engine.current?.net.join(link.code, link.tx);
  }, [engine, booted]);
}
