import type { World } from "../world/race-world.test-util.ts";
import { NO_CAR_PICK, NO_PERSON_PICK, PERSON_SPRAY, SPRAY_PALETTE } from "../match/look-data.ts";
import { CAR_SPRAY } from "../vehicle/spray-box.ts";
import type { Ejection } from "../vehicle/ejection.ts";
import { PHASES, type CrowdLink, type NetGame } from "./net-ports.ts";

/** The engine's `NetGame` seam over a headless world: what `CrashEngine.net` wires, minus the derby, reels, looks and presentation. `crowd`: the open world's crowd, null while there is none. */
export function worldGame(w: World, name: string, crowd: () => CrowdLink | null = () => null) {
  const log = { cleared: 0, gen: 0 };
  const game: NetGame = {
    cars: () => w.live(),
    setCarCount: (n) => w.race["host"].setCarCount(n),
    matchCar: () => {},
    setRealism: () => {},
    phase: () => PHASES[0]!,
    timeScale: () => 1,
    mirrorClock: () => {},
    race: () => (w.race.active ? w.race : null),
    enterRace: (survival, lobby = false) => {
      if (w.race.active) {
        if (w.race.survival === survival && (!lobby || w.race.free)) return;
        w.race.exit();
      }
      w.race.enter(survival, lobby);
    },
    exitRace: () => w.race.exit(),
    startRace: () => w.race.command({ type: "start" }),
    setSeats: (seats) => w.race.setSeats(seats),
    playerName: () => name,
    hostFit: () => true,
    remoteDrivable: () => true,
    derbyPhase: () => null,
    derbyState: () => null,
    applyDerby: () => {},
    derbyLobby: () => {},
    startDerby: () => {},
    resetLobbyCar: (i) => w.race.resetLobbyCar(i),
    // The engine's `randomizeAndReset`: the clear count moves, then the director puts its lobby back.
    resetLobbyScene: () => {
      log.gen = (log.gen + 1) & 127;
      w.race.reset();
    },
    setVaporized: () => {},
    clearGen: () => log.gen,
    clearScene: () => void log.cleared++,
    playReel: () => {},
    reelPlaying: () => false,
    launchEjection: (_e: Ejection) => {},
    meterOf: () => null,
    courseMenu: () => w.race.courseMenu(),
    playerLook: () => ({
      car: { ...NO_CAR_PICK },
      person: { ...NO_PERSON_PICK },
      carSpray: { texels: new Uint8Array(CAR_SPRAY.w * CAR_SPRAY.h), palette: SPRAY_PALETTE },
      personSpray: { texels: new Uint8Array(PERSON_SPRAY.w * PERSON_SPRAY.h), palette: SPRAY_PALETTE },
    }),
    wearLook: () => {},
    dropLooks: () => {},
    crowdLink: crowd,
    seat: w.seat,
  };
  return { game, log };
}
