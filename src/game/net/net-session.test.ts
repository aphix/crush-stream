import { afterEach, describe, expect, it, type TestContext, vi } from "vitest";
import { DriverSeat, type DriveInput } from "../vehicle/car-drive.ts";
import type { DeformableCar } from "../vehicle/car.ts";
import { makeCar } from "../contact/crash-scenarios.test-util.ts";
import { DEFAULT_RACE_OPTIONS, type RaceCommand, type RaceOptions, type RacePhase, type RaceSnapshot } from "../match/types.ts";
import { INPUT_BYTES, type Reel } from "../match/highlights.ts";
import * as codec from "./codec.ts";
import { NetPlay } from "./net-play.ts";
import { carLayout } from "./car-pose.ts";
import type { HostRoom, NetStatus, NetTx } from "./net-ports.ts";
import { publicRoomName } from "./matchmaking.ts";
import { Hub, FRAME_MS, RELAY_MSG_MAX } from "./net-hub.test-util.ts";
import { packReel } from "./reel-codec.ts";
import { reelParts } from "./reel-wire.ts";
import { makeClip, sameClip } from "./reel-clip.test-util.ts";
import { HOST_WAIT_MS, SLOT_GRACE_MS } from "./net-constants.ts";
import type { LookData } from "./look-codec.ts";
import { CAR_SPRAY, NO_CAR_PICK, NO_PERSON_PICK, PERSON_SPRAY, SPRAY_PALETTE, carPickText, personPickText } from "../match/look-data.ts";
import { assertSameNumbers } from "../vehicle/test-support.ts";
import { FINE_HZ } from "../kernel/constants.ts";
import { FACE_NOSE } from "../deform/load-crush.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";
import { must } from "../kernel/must.test-util.ts";

/** A player who picked nothing and sprayed nothing. */
const bareLook = (): LookData => ({
  car: { ...NO_CAR_PICK },
  person: { ...NO_PERSON_PICK },
  carSpray: { texels: new Uint8Array(CAR_SPRAY.w * CAR_SPRAY.h), palette: SPRAY_PALETTE },
  personSpray: { texels: new Uint8Array(PERSON_SPRAY.w * PERSON_SPRAY.h), palette: SPRAY_PALETTE },
});

/** The last `setSeats` call seated exactly one guest: car `car` under `name`. */
function expectOneSeat(seats: readonly (readonly [number, string])[] | undefined, car: number, name: string): void {
  expect(seats, "seats of the last setSeats call").toHaveLength(1);
  expect(seats?.[0]?.[0], "the seated car").toBe(car);
  expect(seats?.[0]?.[1], "the seated name").toBe(name);
}

/** A lobby gate field by field, `label` naming whose gate it is. */
function expectGate(gate: NetStatus["gate"], want: { min: number; kind: string; course: string; playlist: readonly string[]; players: number }, label: string): void {
  expect(gate, `${label}: the gate is up`).not.toBe(null);
  expect(gate?.min, `${label}: players wanted`).toBe(want.min);
  expect(gate?.kind, `${label}: the game Go starts`).toBe(want.kind);
  expect(gate?.course, `${label}: the course`).toBe(want.course);
  expect(firstMismatch(gate?.playlist, want.playlist), `${label}: the playlist`).toBeUndefined();
  expect(gate?.players, `${label}: players here`).toBe(want.players);
}

/** The engine as NetPlay sees it, with real cars and a real seat; records what the session asked of it. */
function fakeGame(raceApplied?: number[], playerName = "") {
  const cars: DeformableCar[] = [makeCar(), makeCar()];
  const seat = new DriverSeat();
  /** Every `setSeats` call, as [car, name] pairs. */
  const seats: [number, string][][] = [];
  const matched: unknown[][] = [];
  const race = raceApplied
    ? {
        options: { ...DEFAULT_RACE_OPTIONS },
        look: 0,
        phase: null as RacePhase | null,
        survival: false,
        /** Every `command` the session sent; an `options` one also applies, as the director does. */
        commands: [] as RaceCommand[],
        program: null as Partial<RaceOptions> | null,
        command(cmd: RaceCommand): void {
          this.commands.push(cmd);
          if (cmd.type === "options") Object.assign(this.options, cmd.options);
          if (cmd.type === "program") this.program = cmd.options;
        },
        setRemoteInput(_car: number, _input: DriveInput): void {},
        requestRespawn(_id?: number): void {},
        holdReset(_id?: number): void {},
        snapshot: (): RaceSnapshot | null => null,
        applySnapshot(snap: RaceSnapshot, _self: number): void {
          raceApplied.push(snap.laps);
        },
        /** Seconds the guest's race clock was run on, in all. */
        clockRun: 0,
        advanceClock(dt: number): void {
          this.clockRun += dt;
        },
        showLobby(_trackId: string): void {},
        courseId: "havana",
        survivalCourses: [{ id: "havana", name: "Havana" }],
        seatLobby(_self: number): void {},
        /** How many times the host moved a campaign on between rounds (`advance`). */
        advanced: 0,
        advance(): void {
          this.advanced++;
        },
      }
    : null;
  return {
    seats,
    matched,
    /** What `reelPlaying` answers. */
    playing: false,
    /** What `hostFit` answers. */
    fit: true,
    /** Whether race mode is on: `race()` answers null while it is off, the director (and its options) living on. */
    raceOn: true,
    seat,
    cars: () => cars,
    setCarCount(n: number): void {
      while (cars.length < n) cars.push(makeCar());
      cars.length = Math.max(1, n);
    },
    matchCar(i: number, style: unknown, cls: unknown): void {
      matched.push([i, style, cls]);
    },
    setRealism(): void {},
    phase: () => "approach" as const,
    timeScale: () => 1,
    mirrorClock(): void {},
    race(): typeof race {
      return this.raceOn ? race : null;
    },
    /** What each `enterRace` asked for: Survival (true) or a race (false). */
    raceEntered: [] as boolean[],
    /** The lobby flag of each `enterRace`. */
    lobbyEntered: [] as boolean[],
    enterRace(survival: boolean, lobby = false): void {
      this.raceEntered.push(survival);
      this.lobbyEntered.push(lobby);
    },
    /** The cars the host put back at a lobby spawn, in order, and how many times it reset the whole lobby scene. */
    lobbyReset: [] as number[],
    lobbySceneResets: 0,
    resetLobbyCar(i: number): void {
      this.lobbyReset.push(i);
    },
    resetLobbyScene(): void {
      this.lobbySceneResets++;
    },
    /** How many times the session left race mode. */
    raceExits: 0,
    exitRace(): void {
      this.raceExits++;
      this.raceOn = false;
    },
    /** The games the session started, in order: "race", "derby" (`startRace`, `startDerby`); Survival is an `enterRace(true)`. */
    started: [] as string[],
    startRace(): void {
      this.started.push("race");
    },
    setSeats(m: ReadonlyMap<number, string>): void {
      seats.push([...m]);
    },
    playerName: () => playerName,
    hostFit(): boolean {
      return this.fit;
    },
    remoteDrivable: () => true,
    derbyPhase: () => null,
    derbyState: () => null,
    /** How many times the session left derby mode (`applyDerby(null)`). */
    derbyExits: 0,
    applyDerby(state: unknown): void {
      if (state === null) this.derbyExits++;
    },
    derbyLobby(): void {},
    startDerby(): void {
      this.started.push("derby");
    },
    setVaporized(): void {},
    playReel(_reel: Reel, _startAt: number): void {},
    launchEjection(): void {},
    reelPlaying(): boolean {
      return this.playing;
    },
    /** The host's clear count (`clearGen`), bumped by a test the way a scene change, loop or reset bumps it. */
    gen: 0,
    /** How many times the session asked this engine to clear its scene (`clearScene`), which repairs every car like the engine's. */
    clears: 0,
    clearGen(): number {
      return this.gen;
    },
    clearScene(): void {
      this.clears++;
      for (const c of cars) c.resetVisual();
    },
    meterOf: () => null,
    /** What `playerLook` answers. */
    look: bareLook(),
    /** Every `wearLook` call, as [car, look]. */
    worn: [] as [number, LookData | null][],
    playerLook(): LookData {
      return this.look;
    },
    wearLook(i: number, look: LookData | null): void {
      this.worn.push([i, look]);
    },
    dropLooks(): void {},
    courseMenu: () => ({
      courses: [
        { id: "oval", name: "Brickyard Oval", blurb: "" },
        { id: "rally", name: "Ridge Rally", blurb: "" },
        { id: "city", name: "Harbour Streets", blurb: "" },
      ],
      survival: [{ id: "havana", name: "Havana", blurb: "" }],
    }),
  };
}

const open: NetPlay[] = [];
afterEach(() => {
  for (const n of open.splice(0)) n.leave();
});

/** A host and one guest in room R, linked through a `Hub`, on one fake clock (the guest's read `skewMs` ahead). */
function session(opts: { raceApplied?: number[]; hostRace?: boolean; hostName?: string; name?: string; skewMs?: number; hostLook?: LookData; guestLook?: LookData } = {}) {
  const hub = new Hub();
  let now = 1000;
  const clock = () => now;
  const hg = fakeGame(opts.hostRace ? [] : undefined, opts.hostName);
  const cg = fakeGame(opts.raceApplied, opts.name);
  if (opts.hostLook) hg.look = opts.hostLook;
  if (opts.guestLook) cg.look = opts.guestLook;
  const host = new NetPlay(hg, { connect: hub.connect, now: clock });
  const client = new NetPlay(cg, { connect: hub.connect, now: () => now + (opts.skewMs ?? 0) });
  open.push(host, client);
  host.host("R", "bc");
  client.join("R", "bc");
  let sent = 0;
  const s = {
    clock,
    hub,
    hg,
    cg,
    host,
    client,
    hostId: () => host.status().selfId,
    clientId: () => client.status().selfId,
    /** Host snapshots sent so far (one per host frame): the next one's seq is `sent + 1`. */
    sent: () => sent,
    advance(ms: number): void {
      now += ms;
    },
    /** `n` frames: the host drives its peers' cars and sends; the guest (unless hidden) renders and sends. */
    step(n = 1, who: { host?: boolean; client?: boolean } = {}): void {
      for (let k = 0; k < n; k++) {
        now += FRAME_MS;
        if (who.host !== false) {
          host.drive(hg.cars(), FRAME_MS / 1000, -1);
          host.frame(FRAME_MS / 1000);
          sent++;
        }
        if (who.client !== false) client.frame(FRAME_MS / 1000);
        hub.flush();
      }
    },
    /** The guest's seat drives its car with W held. */
    holdThrottle(): void {
      cg.seat.focus(client.status().car);
      cg.seat.mode = "drive";
      cg.seat.sample(new Set(["KeyW"]), null);
    },
    /** Speed (m/s) of the guest's car on the host. */
    hostSpeed(car = 1): number {
      return hg.cars()[car]!.velocity.length();
    },
  };
  s.step(20);
  expect(client.status().car, "the guest got car 1").toBe(1);
  return s;
}

/** A snapshot of `cars` as the host would send it, with `edit` applied to its frames. */
function forgedSnapshot(cars: DeformableCar[], seq: number, edit: (s: codec.Snapshot) => void): Uint8Array {
  const L = carLayout(cars[0]!);
  const s = codec.makeSnapshot();
  codec.ensureFrames(s, cars.length, L);
  s.seq = seq;
  s.time = 1;
  s.count = cars.length;
  edit(s);
  const w = new codec.Writer();
  codec.writeSnapshot(w, s, L);
  return w.done();
}

describe("given a guest that joined a room nobody hosts", () => {
  it("when its frames run for 4.5 s, then it shows no problem yet; at 5.5 s it reports the room has no host; and once a host opens the room the problem clears and the guest is seated in car 1", () => {
    const hub = new Hub();
    let now = 1000;
    const guestGame = fakeGame();
    const guest = new NetPlay(guestGame, { connect: hub.connect, now: () => now });
    open.push(guest);
    guest.join("R", "rtc");
    const frames = (ms: number, host?: NetPlay): void => {
      for (let t = 0; t < ms; t += FRAME_MS) {
        now += FRAME_MS;
        host?.drive(hostGame.cars(), FRAME_MS / 1000, -1);
        host?.frame(FRAME_MS / 1000);
        guest.frame(FRAME_MS / 1000);
        hub.flush();
      }
    };
    const hostGame = fakeGame();
    frames(HOST_WAIT_MS - 500);
    expect(guest.status().problem, "not yet: the host may still be on its way").toBe(null);
    frames(1000);
    expect(guest.status().problem).toBe("no-host");
    const host = new NetPlay(hostGame, { connect: hub.connect, now: () => now });
    open.push(host);
    host.host("R", "rtc");
    frames(2000, host);
    expect(guest.status().problem, "a host answered").toBe(null);
    expect(guest.status().car).toBe(1);
  });
});

describe("given a host and one guest seated in car 1", () => {
  it("when the link drops for a moment and returns, then the guest keeps car 1 and its held throttle drives the car again", () => {
    const s = session();
    s.holdThrottle();
    s.hub.setCut(s.hostId(), s.clientId(), true);
    s.step(10);
    s.hub.setCut(s.hostId(), s.clientId(), false);
    s.step(30);
    expect(s.client.status().car).toBe(1);
    expect(s.hostSpeed(), `the guest drives again after the blip (${s.hostSpeed().toFixed(2)} m/s)`).toBeGreaterThan(3);
  });

  it("when the link stays down for a minute and then returns, then the host frees the car and the guest reports the host lost, and on the return the guest is seated again in its car with its held throttle driving, never dropping to spectating", () => {
    const s = session();
    s.holdThrottle();
    s.hub.setCut(s.hostId(), s.clientId(), true);
    s.step(5);
    s.advance(60_000);
    s.step(5);
    expect(s.host.remoteCar(1), "the host freed the car after the grace period").toBe(false);
    expect(s.client.status().problem).toBe("host-lost");
    s.hub.setCut(s.hostId(), s.clientId(), false);
    s.step(40);
    expect(s.client.status().problem).toBe(null);
    expect(s.host.remoteCar(1), "the guest is seated again in its car").toBeTruthy();
    expect(s.cg.seat.mode, "the seat never dropped back to follow").toBe("drive");
    expect(s.hostSpeed(), `and the throttle held through the outage drives it (${s.hostSpeed().toFixed(2)} m/s)`).toBeGreaterThan(3);
  });

  it("when the host stops hearing the guest for a minute while the guest still hears the host, then the host frees the car but the guest keeps car 1, and its next input seats it again and drives", () => {
    const s = session();
    s.hub.unlisted.add(s.clientId());
    s.step(5, { client: false });
    s.advance(60_000);
    s.step(5, { client: false });
    expect(s.host.remoteCar(1), "the host freed the car after the grace period").toBe(false);
    expect(s.client.status().car, "the guest, still hearing the host, keeps driving car 1").toBe(1);
    s.hub.unlisted.delete(s.clientId());
    s.holdThrottle();
    s.step(30);
    expect(s.host.remoteCar(1), "its next input seats it again").toBeTruthy();
    expect(s.hostSpeed(), `and drives (${s.hostSpeed().toFixed(2)} m/s)`).toBeGreaterThan(3);
  });

  it("when the host leaves and restarts in the same room, then the new host seats the guest in a car and the guest renders the new host's world", () => {
    const s = session();
    s.host.leave();
    const host2 = new NetPlay(s.hg, { connect: s.hub.connect, now: s.clock });
    open.push(host2);
    // The new host shares the session clock; the old one is gone, so step the pair by hand.
    host2.host("R", "bc");
    for (let k = 0; k < 6000 / FRAME_MS + 60; k++) {
      s.advance(FRAME_MS);
      host2.frame(FRAME_MS / 1000);
      s.client.frame(FRAME_MS / 1000);
      s.hub.flush();
    }
    expect(host2.remoteCar(s.client.status().car), "the restarted host seated the guest").toBeTruthy();
    s.hg.cars()[0]!.group.position.x = 7;
    for (let k = 0; k < 20; k++) {
      s.advance(FRAME_MS);
      host2.frame(FRAME_MS / 1000);
      s.client.frame(FRAME_MS / 1000);
      s.hub.flush();
    }
    expect(Math.abs(s.cg.cars()[0]!.group.position.x - 7), "the guest renders the new host's world").toBeLessThan(0.01);
  });

  it("when the host leaves, then every seat is freed, so a solo race or derby has no ghost players", () => {
    const s = session();
    expectOneSeat(s.hg.seats.at(-1), 1, "Player 1");
    s.host.leave();
    expect(s.hg.seats.at(-1)).toHaveLength(0);
  });
});

describe("given a host and a guest who each picked colours and sprayed paint in the garage", () => {
  it("when the guest is seated, then the host's car 1 wears the guest's picks and spray texel for texel, the guest's car 0 wears the host's (its own colour on an ink included), and the guest's own car 1 wears the guest's own look", () => {
    const hostLook = bareLook();
    hostLook.car.body = 0x11aa33;
    hostLook.person.hat = 0xff0000;
    hostLook.carSpray.texels.fill(4, 0, 900);
    hostLook.carSpray.texels.fill(9, 900, 1000);
    hostLook.carSpray = { ...hostLook.carSpray, palette: SPRAY_PALETTE.map((c, ink) => (ink === 9 ? 0x123456 : c)) };
    const guestLook = bareLook();
    guestLook.car.rims = 0xffd700;
    guestLook.person.woman = true;
    for (let i = 0; i < guestLook.personSpray.texels.length; i += 7) guestLook.personSpray.texels[i] = (i % 15) + 1;
    const s = session({ hostLook, guestLook });
    const onHost = s.hg.worn.filter(([car]) => car === 1).at(-1)?.[1];
    const onGuest = s.cg.worn.filter(([car]) => car === 0).at(-1)?.[1];
    must(onHost && onGuest, "each side wore the other's look");
    expect(carPickText(onHost.car), "the guest's car picks on the host").toBe(carPickText(guestLook.car));
    expect(personPickText(onHost.person), "the guest's driver picks on the host").toBe(personPickText(guestLook.person));
    assertSameNumbers(onHost.personSpray.texels, guestLook.personSpray.texels, "the guest's driver spray on the host");
    assertSameNumbers(onHost.carSpray.texels, guestLook.carSpray.texels, "the guest's bare car spray on the host");
    expect(carPickText(onGuest.car), "the host's car picks on the guest").toBe(carPickText(hostLook.car));
    expect(personPickText(onGuest.person), "the host's driver picks on the guest").toBe(personPickText(hostLook.person));
    assertSameNumbers(onGuest.carSpray.texels, hostLook.carSpray.texels, "the host's car spray on the guest");
    assertSameNumbers(onGuest.carSpray.palette, hostLook.carSpray.palette, "the host's car spray inks on the guest, its own colour on ink 9");
    expect(s.cg.worn.some(([car, look]) => car === 1 && look !== null), "the guest's own seat never wears a look from the relay").toBe(false);
    expect(s.cg.worn.some(([car, look]) => car === 1 && look === null), "the guest's own seat put on the guest's own look when seated").toBeTruthy();
  });
});

describe("given a host receiving a guest's hello", () => {
  it("when the hello's name has extra whitespace, control or text-direction characters and is over 16 characters, then the guest is seated under that name cleaned of them and cut to 16 characters", () => {
    const s = session({ name: "  Zed\u202E\u0000 the\tquick brown fox jumps  " });
    expectOneSeat(s.hg.seats.at(-1), 1, "Zed the quick br");
  });

  it("when the hello carries no name (the field's older layout), then the guest is seated as Player 1", () => {
    const hub = new Hub();
    const hg = fakeGame();
    const host = new NetPlay(hg, { connect: hub.connect, now: () => 0 });
    open.push(host);
    host.host("R", "bc");
    hub.connect("bc", "R", "bare", "client").send(new Uint8Array([codec.MSG.hello, codec.NET_VERSION]));
    hub.flush();
    expectOneSeat(hg.seats.at(-1), 1, "Player 1");
  });
});

describe("given a guest connected to its host, with other peers in the room", () => {
  it("when another peer in the room sends assignments and snapshots, then the guest ignores them, stays in car 1 and still applies the host's snapshots", () => {
    const s = session();
    const rogue = s.hub.connect("bc", "R", "rogue", "client");
    rogue.send(new Uint8Array([codec.MSG.assign, 5, codec.NET_VERSION ?? 0]), s.clientId());
    rogue.send(new Uint8Array([codec.MSG.snapshot, 0, 0xfe, 0x7f]), s.clientId());
    s.hub.flush();
    expect(s.client.status().car, "a peer other than the host cannot move the guest to another car").toBe(1);
    s.hg.cars()[0]!.group.position.x = 5;
    s.step(20);
    expect(Math.abs(s.cg.cars()[0]!.group.position.x - 5), "the host's snapshots still apply").toBeLessThan(0.01);
  });

  it("when the host sends a snapshot the guest cannot decode, then the guest keeps applying the host's following snapshots", () => {
    const s = session();
    s.hub.sendAs(s.hostId(), s.clientId(), new Uint8Array([codec.MSG.snapshot, 0, 0xe8, 0x03]));
    s.hub.flush();
    s.hg.cars()[0]!.group.position.x = 5;
    s.step(20);
    expect(Math.abs(s.cg.cars()[0]!.group.position.x - 5), "a truncated snapshot does not block the next ones").toBeLessThan(0.01);
  });

  it("when a snapshot with an unknown body or a non-finite pose arrives, then the guest refuses it: no car is rebuilt on an unknown body and no NaN pose reaches a car", () => {
    const s = session();
    const bad = forgedSnapshot(s.hg.cars(), s.sent() + 1, (snap) => {
      snap.cars[0]!.style = 15;
      snap.cars[0]!.cls = 15;
      snap.cars[1]!.x = Number.NaN;
    });
    s.cg.matched.length = 0;
    s.hub.sendAs(s.hostId(), s.clientId(), bad);
    s.hub.flush();
    for (let k = 0; k < 10; k++) {
      s.step();
      for (const car of s.cg.cars()) expect(Number.isFinite(car.group.position.x), "no NaN pose reaches a car").toBeTruthy();
    }
    expect(s.cg.matched.every(([, style, cls]) => typeof style === "string" && typeof cls === "string"), "no car is rebuilt on an unknown body").toBeTruthy();
  });

  it("when a race state with an out-of-range lap count arrives, then it is not applied, while the same message with a sane lap count is", () => {
    const applied: number[] = [];
    const s = session({ raceApplied: applied });
    const snap = { trackId: "oval", laps: 1e9, noReset: false, phase: "racing", time: 1, lights: 3, winnerId: null, winBy: null, cars: { cols: [], rows: [] }, order: [], firstAt: [] };
    const body = new TextEncoder().encode(JSON.stringify({ lobby: null, trackId: "oval", look: 0, snap }));
    s.hub.sendAs(s.hostId(), s.clientId(), new Uint8Array([codec.MSG.race, ...body]));
    s.hub.flush();
    expect(applied).toHaveLength(0);
    // Control: the same message with a sane lap count is applied, so the empty list above is the lap check's.
    const ok = new TextEncoder().encode(JSON.stringify({ lobby: null, trackId: "oval", look: 0, snap: { ...snap, laps: 3 } }));
    s.hub.sendAs(s.hostId(), s.clientId(), new Uint8Array([codec.MSG.race, ...ok]));
    s.hub.flush();
    expect(firstMismatch(applied, [3])).toBeUndefined();
  });

  it("when a race state carries a campaign table whose entry has no standings row, or a hundred tracks, then it is not applied, while a sound table is", () => {
    const applied: number[] = [];
    const s = session({ raceApplied: applied });
    const row = { id: 0, name: "Ann", kind: "player", aggression: 0, points: 10, wins: 1, places: [1] };
    const sound = { tracks: ["oval", "rally"], round: 1, entry: [0], standings: [row] };
    const send = (campaign: unknown): void => {
      const snap = { trackId: "oval", laps: 3, noReset: false, phase: "racing", time: 1, lights: 3, winnerId: null, winBy: null, cars: { cols: [], rows: [] }, order: [], firstAt: [], campaign, standings: true };
      const body = new TextEncoder().encode(JSON.stringify({ lobby: null, trackId: "oval", look: 0, snap }));
      s.hub.sendAs(s.hostId(), s.clientId(), new Uint8Array([codec.MSG.race, ...body]));
      s.hub.flush();
    };
    send({ ...sound, entry: [0, 5] });
    send({ ...sound, tracks: Array.from({ length: 100 }, () => "oval") });
    expect(applied).toHaveLength(0);
    // Control: the sound table is applied, so the empty list above is the table check's.
    send(sound);
    expect(firstMismatch(applied, [3])).toBeUndefined();
  });
});

describe("given a host and a peer running another build", () => {
  it("when the peer says hello, then the host seats it in no car and tells it that it cannot join", () => {
    const hub = new Hub();
    const host = new NetPlay(fakeGame(), { connect: hub.connect, now: () => 0 });
    open.push(host);
    host.host("R", "bc");
    const old = hub.connect("bc", "R", "old", "client");
    const got: number[][] = [];
    old.onMessage = (_from, data) => got.push([...data]);
    old.send(new Uint8Array([codec.MSG.hello]));
    hub.flush();
    host.frame(FRAME_MS / 1000);
    hub.flush();
    expect(host.remoteCar(1), "a hello without this build's version takes no car").toBe(false);
    const assign = got.find((m) => m[0] === codec.MSG.assign);
    expect(assign && assign[1] === 255, "it is told it cannot join").toBeTruthy();
  });
});

describe("given a host with one guest driving at full throttle", () => {
  it("when the guest's input stops arriving, then its car on the host idles and coasts down", () => {
    const s = session();
    s.holdThrottle();
    s.step(30);
    const moving = s.hostSpeed();
    expect(moving).toBeGreaterThan(3);
    s.step(30, { client: false });
    expect(s.hostSpeed(), `the car coasts down (${moving.toFixed(2)} → ${s.hostSpeed().toFixed(2)} m/s)`).toBeLessThan(moving);
  });

  it("when the guest's tab is hidden, then its car on the host idles at once", () => {
    const s = session();
    s.holdThrottle();
    s.step(30);
    const moving = s.hostSpeed();
    s.client.setHidden(true);
    s.hub.flush();
    s.step(3, { client: false });
    expect(s.hostSpeed(), `no full-throttle zombie (${moving.toFixed(2)} → ${s.hostSpeed().toFixed(2)} m/s)`).toBeLessThan(moving);
  });
});

describe("given a guest connected to a host whose tab is hidden", () => {
  it("when the host stays hidden and then really leaves, then the guest reports the host paused while it waits, and host lost once it is gone, keeping its car, camera and held pedal to seat again", () => {
    const s = session();
    s.step(30, { host: false });
    s.advance(4000);
    s.host.setHidden(true);
    s.hub.flush();
    s.advance(4000);
    s.step(1, { host: false });
    expect(s.client.status().car, "a paused host keeps its guests").toBe(1);
    expect(s.client.status().problem).toBe("host-paused");
    s.host.leave();
    s.advance(6000);
    s.step(1, { host: false });
    expect(s.client.status().problem).toBe("host-lost");
    expect(s.client.status().car, "it keeps its car (camera, held pedal) while it asks for a seat again").toBe(1);
  });
});

const hostModeCases = [{ mode: "race" }, { mode: "survival" }, { mode: "derby" }] as const;
const FRAMES_PER_SECOND = 30;

/** What a host in race, Survival (a race state whose snapshot has the run's hold time) or derby mode sends its guests every few frames. */
function hostModeMessage(mode: "race" | "survival" | "derby"): Uint8Array {
  if (mode === "derby") {
    const w = new codec.Writer();
    codec.writeDerby(w, { round: 1, active: true, time: 3, hold: 0, radius: 18, winnerId: null, winnerName: null, decided: null, lobby: null, seats: 0, board: [] });
    return w.done();
  }
  const snap = { trackId: "oval", laps: 3, noReset: false, phase: "racing", time: 1, lights: 3, winnerId: null, winBy: null, cars: { cols: [], rows: [] }, order: [], firstAt: [], survival: mode === "survival" ? { bustTime: 12 } : null };
  return new Uint8Array([codec.MSG.race, ...new TextEncoder().encode(JSON.stringify({ lobby: null, trackId: "oval", look: 0, snap }))]);
}

/** A guest that has just heard its host's race (or derby) message. */
function guestInHostMode(mode: "race" | "survival" | "derby") {
  const s = session({ raceApplied: [] });
  s.hub.sendAs(s.hostId(), s.clientId(), hostModeMessage(mode));
  s.hub.flush();
  const exits = () => (mode === "derby" ? s.cg.derbyExits : s.cg.raceExits);
  return { s, exits };
}

for (const testCase of hostModeCases) {
  describe(`given a guest following its host's ${testCase.mode}`, () => {
    it("when its own frames stall for 3 s and the host's newest messages reach it only after the first frame back, then it stays in the mode", () => {
      const { s, exits } = guestInHostMode(testCase.mode);
      s.advance(3000);
      s.hub.sendAs(s.hostId(), s.clientId(), hostModeMessage(testCase.mode));
      s.client.frame(FRAME_MS / 1000);
      s.hub.flush();
      s.step(FRAMES_PER_SECOND, { host: false });
      expect(exits()).toBe(0);
    });

    it("when its host's tab is hidden for 3 s (only the paused heartbeat arrives), then it stays in the mode", () => {
      const { s, exits } = guestInHostMode(testCase.mode);
      s.host.setHidden(true);
      s.hub.flush();
      s.step(3 * FRAMES_PER_SECOND, { host: false });
      expect(exits()).toBe(0);
    });

    it("when its live host stops sending the mode for 4 s of the guest's frames, then it leaves the mode once", () => {
      const { s, exits } = guestInHostMode(testCase.mode);
      s.step(4 * FRAMES_PER_SECOND);
      expect(exits()).toBe(1);
    });
  });
}

describe("given a guest following its host", () => {
  it("when the host's race state carries a Survival run, then the guest enters Survival; when it carries a race, then it enters a race", () => {
    const survival = guestInHostMode("survival");
    expect(firstMismatch(survival.s.cg.raceEntered, [true])).toBeUndefined();
    const race = guestInHostMode("race");
    expect(firstMismatch(race.s.cg.raceEntered, [false])).toBeUndefined();
  });
});

describe("given a client whose scene is cleared when the host's clear count changes (a scene change, loop or reset)", () => {
  const torn = (car: DeformableCar): number => car["parts"].filter((p) => p.detached).length;
  const tear = (car: DeformableCar): void => car["detachPart"](car["parts"].find((p) => p.region)!, 12);

  it("when the host's clear count changes, then the client's scene is emptied once, and a steady count never empties it", () => {
    const s = session();
    s.step(10);
    expect(s.cg.clears, "joining a running scene clears nothing").toBe(0);
    tear(s.cg.cars()[1]!);
    s.step(10);
    expect(s.cg.clears, "a steady count leaves the client's scene alone").toBe(0);
    expect(torn(s.cg.cars()[1]!), "the torn part is still there before the host clears").toBe(1);
    s.hg.gen = 1;
    s.step(10);
    expect(s.cg.clears, "one clear for one change").toBe(1);
    expect(torn(s.cg.cars()[1]!), "the client's torn part is gone").toBe(0);
    s.step(30);
    expect(s.cg.clears, "the new count is not cleared again").toBe(1);
  });

  it("when the host clears just before the new scene's own wreck, then a crash right after the host's clear survives on the client", () => {
    const s = session();
    s.step(10);
    s.hg.gen = 1;
    const host = s.hg.cars()[0]!;
    host.crashed = true;
    tear(host);
    s.step(10);
    expect(s.cg.clears).toBe(1);
    expect(s.cg.cars()[0]!.crashed, "the client shows the new scene's crash").toBe(true);
    expect(torn(s.cg.cars()[0]!), "the new scene's torn part is drawn, not wiped by the clear").toBe(1);
  });

  it("when the results reel is playing, then the client does not clear, and does so once the reel ends if the host cleared meanwhile", () => {
    const s = session();
    s.step(10);
    s.cg.playing = true;
    s.hg.gen = 3;
    s.step(10);
    expect(s.cg.clears, "the reel owns the cars").toBe(0);
    s.cg.playing = false;
    s.step(10);
    expect(s.cg.clears, "back to the host's scene: its clear lands").toBe(1);
  });
});

describe("given a host car dented under the crash's depth (8 mm on its nose: no wreck, `SPRING_YIELD`) and a guest drawing it", () => {
  const DENT = 0.008;
  /** A car's body skin as the sim wrote it, before the drawn tyre hold (each peer holds that over its own wheels): what crosses the wire. */
  const skin = (car: DeformableCar): ArrayLike<number> => car["bodyTyres"]?.["written"] ?? car.body.geometry.getAttribute("position").array;
  const apart = (a: ArrayLike<number>, b: ArrayLike<number>): number => {
    let m = 0;
    for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i]! - b[i]!));
    return m;
  };

  it("when the host dents the car, then the guest draws the same dent and no wreck; when the host repairs it, then the dent is cleared on both", () => {
    const s = session();
    const host = s.hg.cars()[0]!;
    const guest = s.cg.cars()[0]!;
    const rest = Float32Array.from(skin(makeCar()));
    host.deform.crush[FACE_NOSE] = DENT;
    host.deform.bakeLoadCrush();
    host.deform.skinLoaded();
    host.updateSkin();
    expect(!host.crashed && host.deform.loadCrushed(), "the host car is dented and no wreck").toBeTruthy();
    const dented = apart(skin(host), rest);
    expect(dented, `the host's skin is dented (${dented.toFixed(4)} m)`).toBeGreaterThan(0.003);
    s.step(20);
    expect(guest.crashed, "the guest draws no wreck").toBe(false);
    const depth = guest.deform.crush[FACE_NOSE]!;
    expect(Math.abs(depth - DENT), `the guest's nose depth is ${depth.toFixed(4)} m, the host's ${DENT} m`).toBeLessThanOrEqual(codec.Q.fine / 2 + 1e-9);
    const off = apart(skin(guest), skin(host));
    expect(off, `the guest's skin is the host's within 2 mm (${off.toFixed(4)} m)`).toBeLessThan(0.002);
    host.resetVisual();
    s.step(20);
    expect(host.deform.loadCrushed(), "the host's dent is repaired").toBe(false);
    expect(guest.deform.loadCrushed(), "the guest's dent is cleared with it").toBe(false);
    const back = apart(skin(guest), rest);
    expect(back, `the guest's skin is the car's rest skin again (${back.toFixed(4)} m off)`).toBeLessThan(0.002);
  });
});

describe("given a host and a guest whose voice follows the host's roster of who drives which car", () => {
  it("when the guest is seated, then each side's voice lists the other player in the car it drives, and neither lists itself", () => {
    const s = session();
    const guestHears = s.client.voice.snapshot().peers;
    const hostHears = s.host.voice.snapshot().peers;
    expect(guestHears.length, "the guest's voice lists one other player").toBe(1);
    expect(guestHears[0]!.id, "the guest lists the host").toBe(s.hostId());
    expect(guestHears[0]!.car, "the host drives car 0").toBe(0);
    expect(hostHears.length, "the host's voice lists one other player").toBe(1);
    expect(hostHears[0]!.id, "the host lists the guest").toBe(s.clientId());
    expect(hostHears[0]!.car, "the guest drives the car the host assigned it").toBe(s.client.status().car);
  });

  it("when the guest leaves and its seat lapses, then the host's voice lists nobody", () => {
    const s = session();
    expect(s.host.voice.snapshot().peers.length, "precondition: the guest is listed").toBe(1);
    s.client.leave();
    s.advance(SLOT_GRACE_MS + 1000);
    s.step(5, { client: false });
    expect(s.host.voice.snapshot().peers.length, "the roster dropped the guest").toBe(0);
  });
});

describe("given a guest whose host sends the highlight reel", () => {
  it("when the host's reel arrives, then it plays at its start time moved onto the guest's clock, and no snapshots are drawn while it plays", { timeout: 5000 }, async () => {
    const s = session({ skewMs: 5000 });
    // Executor form: the tsconfig lib predates `Promise.withResolvers`.
    const played = new Promise<[Reel, number]>((resolve) => {
      s.cg.playReel = (reel, startAt) => resolve([reel, startAt]);
    });
    const hostStart = s.clock() / 1000 + 3;
    for (const part of reelParts(await packReel({ seed: 7, clips: [] }, hostStart))) s.host.sendReliable(part);
    s.hub.flush();
    const [reel, startAt] = await played;
    expect(reel.seed).toBe(7);
    expect(Math.abs(startAt - (hostStart + 5)), `starts at host ${hostStart} + 5 s skew (${startAt})`).toBeLessThan(1e-6);

    s.cg.playing = true;
    s.hg.cars()[0]!.group.position.x = 5;
    s.step(20);
    expect(Math.abs(s.cg.cars()[0]!.group.position.x - 5), "the reel keeps the cars while it plays").toBeGreaterThan(1);
    s.cg.playing = false;
    s.step(20);
    expect(Math.abs(s.cg.cars()[0]!.group.position.x - 5), "snapshots draw again once it ends").toBeLessThan(0.01);
  });

  it("when a reel larger than the relay's message cap is sent, then it reaches the guest with every clip", { timeout: 20000 }, async () => {
    const s = session();
    const played = new Promise<Reel>((resolve) => {
      s.cg.playReel = (reel) => resolve(reel);
    });
    const { clip } = makeClip();
    // Incompressible inputs and schedules: five clips that deflate to over the cap together.
    let seed = 1;
    const next = (): number => (seed = (Math.imul(seed, 1103515245) + 12345) >>> 0);
    const noise = (n: number): Uint8Array => Uint8Array.from({ length: n }, () => next() >>> 24);
    const steps = 8000;
    const shape = Uint32Array.from({ length: steps }, () => next() >>> 13);
    const lone = Uint32Array.from({ length: steps }, () => (next() >>> 24) & 3);
    const big = { ...clip, h: new Float32Array(steps).fill(1 / FINE_HZ), shape, lone, inputs: noise(steps * 2 * INPUT_BYTES) };
    const clips = [big, { ...big, score: 9 }, { ...big, score: 8 }, { ...big, score: 7 }, { ...big, score: 6 }];
    const msg = await packReel({ seed: 5, clips }, s.clock() / 1000 + 3);
    expect(msg.length, `precondition: the reel is ${msg.length} bytes, over the cap`).toBeGreaterThan(RELAY_MSG_MAX);
    const parts = reelParts(msg);
    expect(parts.length > 1 && parts.every((p) => p.length <= RELAY_MSG_MAX), "no frame over the cap").toBeTruthy();
    for (const part of parts) s.host.sendReliable(part);
    s.hub.flush();
    const reel = await played;
    expect(reel.clips.length, "every clip arrives").toBe(5);
    sameClip(reel.clips[0]!, big);
    sameClip(reel.clips[4]!, clips[4]!);
  });
});

describe("given public matches played over a stubbed relay on a virtual clock", () => {
  const dead = publicRoomName("race", "AAAA");
  /** What the relay lists; `addrs` (distinct addresses) is the room's `players` unless a test says otherwise. */
  const listing = (rooms: { room: string; players: number; addrs?: number; meta?: string }[]) => async () =>
    new Response(JSON.stringify({ rooms: rooms.map((r) => ({ addrs: r.players, ...r })) }));
  /** A virtual clock: a search's pauses advance it and nothing else waits. */
  const virtual = (start = 1000) => {
    const t = { now: start };
    return { t, opts: { now: () => t.now, sleep: async (ms: number) => void (t.now += ms), random: () => 0 } };
  };
  /** The searches `np`'s frame loop starts without awaiting them (`void this.search`), recorded as they begin. */
  const recordSearches = (np: NetPlay): Promise<void>[] => {
    const searches: Promise<void>[] = [];
    const search = np["search"].bind(np);
    np["search"] = (kind) => {
      const started = search(kind);
      searches.push(started);
      return started;
    };
    return searches;
  };
  /** Lets the searches a frame loop started run to their end. */
  const settle = async (searches: Promise<void>[]) => void (await Promise.all(searches.splice(0)));
  /** `ms` of the guests' frame time, the hub moving messages between steps. */
  const run = (hub: Hub, t: { now: number }, ms: number, who: NetPlay[]) => {
    for (let k = 0; k < ms / FRAME_MS; k++) {
      t.now += FRAME_MS;
      for (const n of who) n.frame(FRAME_MS / 1000);
      hub.flush();
    }
  };
  /** A guest that pressed Play online against `names` (all open, none with a live host): the rooms it linked to, in order. */
  const guestOf = async (t: TestContext, names: string[]) => {
    const hub = new Hub();
    const v = virtual();
    const linked: string[] = [];
    const client = new NetPlay(fakeGame(), {
      connect: (tx, room, id, role, meta) => {
        linked.push(`${role} ${room}`);
        return hub.connect(tx, room, id, role, meta);
      },
      ...v.opts,
    });
    open.push(client);
    const searches = recordSearches(client);
    vi.spyOn(globalThis, "fetch").mockImplementation(listing(names.map((room) => ({ room, players: 1, meta: "lobby.oval" }))));
    await client.publicMatch("race");
    /** Waits out the silence that makes the guest give up on its room, and the search that follows. */
    const dwell = async () => {
      run(hub, v.t, 7000, [client]);
      await settle(searches);
    };
    return { hub, v, client, linked, dwell };
  };

  it("given a guest in a public room, when the host of that room leaves, then the stranded guest hosts a fresh public room of its own", async () => {
    const hub = new Hub();
    const v = virtual();
    const host = new NetPlay(fakeGame(), { connect: hub.connect, now: v.opts.now });
    const client = new NetPlay(fakeGame(), { connect: hub.connect, ...v.opts });
    open.push(host, client);
    const searches = recordSearches(client);
    host.host(dead, "rtc");
    vi.spyOn(globalThis, "fetch").mockImplementation(listing([{ room: dead, players: 1, meta: "lobby.oval" }]));
    await client.publicMatch("race");
    const step = (frames: number, who: NetPlay[]) => {
      for (let k = 0; k < frames; k++) {
        v.t.now += FRAME_MS;
        for (const n of who) n.frame(FRAME_MS / 1000);
        hub.flush();
      }
    };
    step(20, [host, client]);
    expect(client.status().role).toBe("client");
    expect(client.status().car).toBe(1);
    host.leave();
    step(7000 / FRAME_MS, [client]);
    await settle(searches);
    const st = client.status();
    expect(st.role, "the stranded guest hosts instead").toBe("host");
    expect(st.public).toBe("race");
    expect(st.room).not.toBe(dead);
    expect(st.finding).toBe(false);
  });

  it("given a public guest in an open room, when its page loads with its engine running no frames for 9 s and again when it stalls 9 s mid-session, then it stays in the room as car 1 both times", async () => {
    const hub = new Hub();
    let now = 1000;
    const host = new NetPlay(fakeGame(), { connect: hub.connect, now: () => now });
    const client = new NetPlay(fakeGame(), { connect: hub.connect, now: () => now });
    open.push(host, client);
    host.host(dead, "rtc");
    vi.spyOn(globalThis, "fetch").mockImplementation(listing([{ room: dead, players: 1 }]));
    const run = (ms: number, client_ = true) => {
      for (let k = 0; k < ms / FRAME_MS; k++) {
        now += FRAME_MS;
        host.frame(FRAME_MS / 1000);
        if (client_) client.frame(FRAME_MS / 1000);
        hub.flush();
      }
    };
    // A page that just loaded (or reloaded) joins, then its engine's boot warm-up runs no frames for 9 s.
    await client.publicMatch("race");
    run(9000, false);
    run(1000);
    expect(firstMismatch([client.status().role, client.status().room === dead, client.status().car], ["client", true, 1])).toBeUndefined();
    // A 9 s stall mid-session (a course loading): the host's messages wait in the queue behind the client's next frame.
    now += 9000;
    client.frame(0.1);
    run(1000);
    expect(firstMismatch([client.status().role, client.status().room === dead, client.status().car], ["client", true, 1])).toBeUndefined();
  });

  it("given a weak device with nothing to join, when it presses Play online, then it looks, hosts a field of 4 (the player plus 3 AI cars) without changing the player's own AI count, and drops that field on leaving", async () => {
    const v = virtual();
    const g = fakeGame([]);
    g.fit = false;
    const np = new NetPlay(g, { connect: new Hub().connect, ...v.opts });
    open.push(np);
    vi.spyOn(globalThis, "fetch").mockImplementation(listing([]));
    const searching = np.publicMatch("race");
    expect(np.status().finding).toBe(true);
    await searching;
    expect(firstMismatch([np.status().role, np.status().public, np.status().finding], ["host", "race", false])).toBeUndefined();
    const race = g.race()!;
    expect(race.program?.aiCount, "a weak host's field is the player plus 3").toBe(3);
    expect(race.options.aiCount, "the player's own field size stays").toBe(DEFAULT_RACE_OPTIONS.aiCount);
    np.leave();
    expect(race.program, "a solo race is back to its own field").toBe(null);
    expect(race.options.aiCount).toBe(DEFAULT_RACE_OPTIONS.aiCount);
  });

  it("given a device able to host with nothing to join, when it presses Play online, then it hosts a full field at once, within 5 s of the start", async () => {
    const v = virtual();
    const g = fakeGame([]);
    const np = new NetPlay(g, { connect: new Hub().connect, ...v.opts });
    open.push(np);
    vi.spyOn(globalThis, "fetch").mockImplementation(listing([]));
    await np.publicMatch("race");
    expect(np.status().role).toBe("host");
    expect(g.race()!.options.aiCount).toBe(DEFAULT_RACE_OPTIONS.aiCount);
    expect(v.t.now - 1000, "no long search before hosting").toBeLessThan(5000);
  });

  it("given a Play online search in progress, when the player leaves, then no room is joined or hosted afterwards", async () => {
    const v = virtual();
    const np = new NetPlay(fakeGame(), { connect: new Hub().connect, ...v.opts });
    open.push(np);
    let release = (): void => {};
    vi.spyOn(globalThis, "fetch").mockImplementation(async () => {
      await new Promise<void>((resolve) => (release = resolve));
      return new Response(JSON.stringify({ rooms: [{ room: dead, players: 1 }] }));
    });
    const searching = np.publicMatch("race");
    np.leave();
    release();
    await searching;
    expect(firstMismatch([np.status().role, np.status().finding], ["off", false])).toBeUndefined();
  });

  it("given a public host, when its match goes from the lobby through grid, countdown, racing and finished, then its relay tag reads lobby, running, running, running, over with the course, and a guest sends none", () => {
    const hub = new Hub();
    const g = fakeGame([]);
    const host = new NetPlay(g, { connect: hub.connect });
    const guest = new NetPlay(fakeGame([]), { connect: hub.connect });
    open.push(host, guest);
    host.publicHost("race", false);
    const tag = hub.metas.get(host.status().selfId)!;
    const seen: string[] = [tag()];
    // The lobby holds the tag at "lobby" whatever the race director says, until the game starts.
    g.race()!.phase = "racing";
    expect(tag(), "in the lobby").toBe("lobby.oval");
    host.setMinPlayers(1);
    expect(host.go(), "alone, with one player wanted").toBeTruthy();
    for (const phase of ["grid", "countdown", "racing", "finished"] as const) {
      g.race()!.phase = phase;
      seen.push(tag());
    }
    expect(firstMismatch(seen, ["lobby.oval", "running.oval", "running.oval", "running.oval", "over.oval"])).toBeUndefined();
    guest.publicJoin(dead, "race");
    expect(hub.metas.get(guest.status().selfId)!()).toBe("");
  });

  it("given two public rooms whose hosts never answer, when a guest presses Play online, then it tries each once, never goes back to either, and then hosts", async (t) => {
    const [x, y] = ["AAAA", "BBBB"].map((c) => publicRoomName("race", c));
    const g = await guestOf(t, [x!, y!]);
    for (let k = 0; k < 3; k++) await g.dwell();
    expect(g.linked.length, g.linked.join(" | ")).toBe(3);
    expect(g.linked.slice(0, 2).join(" | ")).toBe(`client ${x} | client ${y}`);
    expect(g.linked[2]!).toMatch(/^host pub-race-/);
  });

  it("given four public rooms whose hosts never answer, when a guest presses Play online, then after 3 dead rooms in a row it hosts instead of trying a fourth", async (t) => {
    const names = ["AAAA", "BBBB", "CCCC", "DDDD"].map((c) => publicRoomName("race", c));
    const g = await guestOf(t, names);
    for (let k = 0; k < 4; k++) await g.dwell();
    expect(g.linked.length, g.linked.join(" | ")).toBe(4);
    expect(g.linked.slice(0, 3).join(" | ")).toBe(names.slice(0, 3).map((n) => `client ${n}`).join(" | "));
    expect(g.linked[3]!).toMatch(/^host pub-race-/);
  });

  it("given four public rooms where the second host answers and then leaves, when a guest presses Play online, then that room does not count toward the dead rooms, so the guest tries all four before hosting", async (t) => {
    const names = ["AAAA", "BBBB", "CCCC", "DDDD"].map((c) => publicRoomName("race", c));
    const g = await guestOf(t, names);
    await g.dwell();
    const host = new NetPlay(fakeGame(), { connect: g.hub.connect, now: g.v.opts.now });
    open.push(host);
    host.host(names[1]!, "rtc");
    run(g.hub, g.v.t, 700, [host, g.client]);
    expect(g.client.status().car, "the second room's host answered").toBe(1);
    host.leave();
    await g.dwell();
    await g.dwell();
    await g.dwell();
    expect(g.linked.slice(0, 4).join(" | "), "dead, answered, dead, dead: the answering room broke the streak").toBe(names.map((n) => `client ${n}`).join(" | "));
  });

  it("given a guest whose last search gave up on two dead rooms, when the player leaves and presses Play online again, then the search starts over with the first room in the list", async (t) => {
    const [x, y] = ["AAAA", "BBBB"].map((c) => publicRoomName("race", c));
    const g = await guestOf(t, [x!, y!]);
    await g.dwell();
    await g.dwell();
    g.client.leave();
    await g.client.publicMatch("race");
    expect(g.linked.at(-1), "first in the list again").toBe(`client ${x}`);
  });

  it("given a weak host, when race mode closes before it leaves, then the player's own AI count was never changed and is the default once race mode is on again", async () => {
    const v = virtual();
    const g = fakeGame([]);
    g.fit = false;
    const np = new NetPlay(g, { connect: new Hub().connect, ...v.opts });
    open.push(np);
    vi.spyOn(globalThis, "fetch").mockImplementation(listing([]));
    await np.publicMatch("race");
    expect(g.race()!.options.aiCount).toBe(DEFAULT_RACE_OPTIONS.aiCount);
    g.raceOn = false;
    np.leave();
    g.raceOn = true;
    expect(g.race()!.options.aiCount).toBe(DEFAULT_RACE_OPTIONS.aiCount);
  });

  it("given a public host on the real WebRTC transport against a stubbed relay, when it makes its first relay poll, then that poll already carries the lobby tag", async () => {
    const polls: string[] = [];
    let polled: () => void = () => {};
    const firstPoll = new Promise<void>((resolve) => (polled = resolve));
    vi.spyOn(globalThis, "fetch").mockImplementation(async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.method !== "POST") {
        polls.push(String(input));
        polled();
      }
      return new Response(JSON.stringify({ token: "t", peers: [], signals: [] }));
    });
    // The default link: the real `RtcTransport`, whose room polls the stubbed relay.
    const np = new NetPlay(fakeGame([]), virtual().opts);
    open.push(np);
    np.publicHost("race", false);
    await firstPoll;
    expect(polls.length).toBe(1);
    expect(new URL(polls[0]!, "http://relay.test").searchParams.get("meta")).toBe("lobby.oval");
  });
});

describe("given a host waiting in the Havana lobby of a private room", () => {
  it("when it is alone and the lobby wants two players (the default), then Go does nothing; once a guest has joined, Go starts the race and the gate closes", () => {
    const s = session({ hostRace: true });
    const alone = new NetPlay(fakeGame(), { connect: new Hub().connect, now: () => 0 });
    open.push(alone);
    alone.host("A", "bc");
    expectGate(alone.status().gate, { min: 2, kind: "race", course: "", playlist: [], players: 1 }, "the host alone");
    expect(alone.canGo()).toBe(false);
    expect(alone.go(), "one human cannot start with two wanted").toBe(false);
    expectGate(s.host.status().gate, { min: 2, kind: "race", course: "oval", playlist: [], players: 2 }, "the host with a guest");
    expect(s.host.go(), "a guest has joined").toBe(true);
    expect(firstMismatch(s.hg.started, ["race"])).toBeUndefined();
    expect(s.host.status().gate, "the game runs: no gate").toBe(null);
    expect(s.host.go(), "Go works once").toBe(false);
  });

  it("when the lobby wants one player, then the host starts alone; and what it asked of the engine was the Havana lobby from the first moment", () => {
    const g = fakeGame();
    const alone = new NetPlay(g, { connect: new Hub().connect, now: () => 0 });
    open.push(alone);
    alone.host("A", "bc");
    expect(firstMismatch(g.raceEntered, [false]), "race mode on").toBeUndefined();
    expect(firstMismatch(g.lobbyEntered, [true]), "as the lobby").toBeUndefined();
    alone.setMinPlayers(1);
    expect(alone.go()).toBe(true);
    expect(firstMismatch(g.started, ["race"])).toBeUndefined();
  });

  it("when the minimum is set out of range or not a number, then it is clamped to 1..ROOM_MAX and rounded; a guest and a finished lobby cannot set it", () => {
    const s = session({ hostRace: true, raceApplied: [] });
    const min = (n: number): number | undefined => (s.host.setMinPlayers(n), s.host.status().gate?.min);
    expect(firstMismatch([min(0), min(-3), min(99), min(2.6), min(Number.NaN)], [1, 1, 8, 3, 1])).toBeUndefined();
    s.host.setMinPlayers(5);
    s.client.setMinPlayers(1);
    s.client.setLobbyKind("derby");
    s.step(10);
    expectGate(s.host.status().gate, { min: 5, kind: "race", course: "oval", playlist: [], players: 2 }, "the guest changed nothing");
    s.host.setMinPlayers(2);
    s.host.go();
    s.host.setMinPlayers(8);
    expect(s.host.status().gate).toBe(null);
    s.host.leave();
  });

  it("when the host picks Survival or a derby, then Go starts that game; a public room's game is the one its name says", () => {
    for (const [kind, started, entered] of [["survival", [], [false, true]], ["derby", ["derby"], [false]], ["race", ["race"], [false]]] as const) {
      const s = session();
      s.host.setLobbyKind(kind);
      expect(s.host.status().gate?.kind).toBe(kind);
      s.host.go();
      expect(s.hg.started.join(), kind).toBe(started.join());
      expect(s.hg.raceEntered.join(), `${kind}: Survival is a race mode entered as Survival`).toBe(entered.join());
    }
    const hub = new Hub();
    const pub = new NetPlay(fakeGame(), { connect: hub.connect, now: () => 0 });
    open.push(pub);
    pub.publicHost("derby", false);
    pub.setLobbyKind("race");
    expect(pub.status().gate?.kind, "a public room's kind is fixed").toBe("derby");
  });

  it("when the host raises the minimum, then the guest's status shows it, the players and the game, and Go waits until enough are in", () => {
    const s = session({ hostRace: true, raceApplied: [] });
    s.host.setMinPlayers(3);
    s.host.setLobbyKind("derby");
    s.step(30);
    expectGate(s.client.status().gate, { min: 3, kind: "derby", course: "", playlist: [], players: 2 }, "the guest sees 'waiting for 1 more'");
    expect(s.host.go()).toBe(false);
    s.host.setMinPlayers(2);
    s.step(30);
    expect(s.client.status().gate?.min).toBe(2);
    s.host.go();
    s.step(30);
    expect(s.client.status().gate, "the guest sees the gate close").toBe(null);
  });

  it("when the host resets the scene, then the engine resets the lobby scene once; a guest or a finished lobby cannot", () => {
    const s = session({ hostRace: true });
    s.host.resetScene();
    s.client.resetScene();
    expect(firstMismatch([s.hg.lobbySceneResets, s.cg.lobbySceneResets], [1, 0])).toBeUndefined();
    s.host.setMinPlayers(1);
    s.host.go();
    s.host.resetScene();
    expect(s.hg.lobbySceneResets, "after Go the scene is the game's").toBe(1);
  });

  it("when the host leaves the lobby, then race mode closes with it", () => {
    const s = session({ hostRace: true });
    s.host.leave();
    expect(s.hg.raceExits).toBe(1);
  });
});

describe("given a guest in the Havana lobby", () => {
  it("when it asks to reset its car (R tap or hold), then the host puts back only that guest's car, once per ask; after Go the ask is a race ask, not a lobby one", () => {
    const s = session({ hostRace: true, raceApplied: [] });
    s.step(30);
    s.hg.lobbyReset.length = 0;
    s.client.requestRespawn();
    s.step(3);
    expect(firstMismatch(s.hg.lobbyReset, [1]), "a tap: the guest's car 1 and no other").toBeUndefined();
    s.client.requestHoldReset();
    s.step(3);
    expect(firstMismatch(s.hg.lobbyReset, [1, 1]), "a hold in the lobby is the same reset").toBeUndefined();
    s.step(10);
    expect(firstMismatch(s.hg.lobbyReset, [1, 1]), "one ask is one reset, not one per input packet").toBeUndefined();
    s.host.go();
    s.step(30);
    s.hg.lobbyReset.length = 0;
    s.client.requestRespawn();
    s.step(3);
    expect(s.hg.lobbyReset, "no lobby, no lobby reset").toHaveLength(0);
  });

  it("when a seat is assigned in the lobby, then the host grows the field and puts the new car at its spawn", () => {
    const s = session({ hostRace: true });
    expect(s.hg.cars().length).toBe(2);
    expect(s.hg.lobbyReset.includes(1), "car 1 was placed when its peer was seated").toBeTruthy();
  });
});

describe("given a public room in the Havana lobby", () => {
  /** A public host and (optionally) one guest on one clock; `run(s)` frames both for `s` seconds. */
  function publicRoom(withGuest: boolean, min?: number) {
    const hub = new Hub();
    let now = 1000;
    const hg = fakeGame([]);
    const host = new NetPlay(hg, { connect: hub.connect, now: () => now });
    const client = new NetPlay(fakeGame([]), { connect: hub.connect, now: () => now });
    open.push(host, client);
    host.publicHost("race", false);
    if (min !== undefined) host.setMinPlayers(min);
    if (withGuest) client.publicJoin(host.status().room, "race");
    const run = (seconds: number): void => {
      for (let t = 0; t < seconds; t += FRAME_MS / 1000) {
        now += FRAME_MS;
        host.frame(FRAME_MS / 1000);
        client.frame(FRAME_MS / 1000);
        hub.flush();
      }
    };
    return { host, hg, run };
  }

  it("when the host is alone and the lobby wants two, then the countdown holds and no match starts however long it waits; with the guest in, the countdown runs and the match starts", () => {
    const alone = publicRoom(false);
    alone.run(60);
    expect(alone.hg.started, "one human cannot start a two-player lobby").toHaveLength(0);
    expect(alone.host.status().lobby, "the clock waits at the full 15 s").toBe(15);
    const pair = publicRoom(true);
    pair.run(10);
    expect(pair.hg.started, "10 s of 15").toHaveLength(0);
    expect(pair.host.status().lobby!).toBeLessThan(15);
    pair.run(6);
    expect(firstMismatch(pair.hg.started, ["race"])).toBeUndefined();
    expect(pair.host.status().gate).toBe(null);
  });

  it("when the host wants one player, then the countdown starts the match alone; and the Go switch starts a full-enough lobby early", () => {
    const solo = publicRoom(false, 1);
    solo.run(16);
    expect(firstMismatch(solo.hg.started, ["race"])).toBeUndefined();
    const pair = publicRoom(true);
    pair.run(3);
    expect(pair.hg.started).toHaveLength(0);
    expect(pair.host.go()).toBe(true);
    expect(firstMismatch(pair.hg.started, ["race"])).toBeUndefined();
  });

  it("when a lobby that was waiting for the second player gets one, then the countdown begins from the full 15 s, not from the time spent waiting", () => {
    const s = publicRoom(true);
    s.host.setMinPlayers(3);
    s.run(30);
    expect(s.hg.started).toHaveLength(0);
    s.host.setMinPlayers(2);
    s.run(1);
    expect(s.host.status().lobby!, `${s.host.status().lobby}`).toBeGreaterThanOrEqual(14);
    expect(s.hg.started).toHaveLength(0);
  });
});

describe("given a host and guests in a room who each have a name", () => {
  it("when the roster reaches the guest, then it reads the host's name and the others' names; a player with no name is the Host or Player N", () => {
    const s = session({ hostName: "Ann", name: "Zed" });
    s.step(40);
    const seenByGuest = s.client.voice.snapshot().peers.map((p) => [p.name, p.car]);
    expect(seenByGuest, "the guest sees one peer").toHaveLength(1);
    expect(seenByGuest[0]?.[0], "the host's name").toBe("Ann");
    expect(seenByGuest[0]?.[1], "the host's car").toBe(0);
    const seenByHost = s.host.voice.snapshot().peers.map((p) => [p.name, p.car]);
    expect(seenByHost, "the host sees one peer").toHaveLength(1);
    expect(seenByHost[0]?.[0], "the guest's name").toBe("Zed");
    expect(seenByHost[0]?.[1], "the guest's car").toBe(1);
    const bare = session();
    bare.step(40);
    expect(firstMismatch(bare.client.voice.snapshot().peers.map((p) => p.name), ["Host"])).toBeUndefined();
    expect(firstMismatch(bare.host.voice.snapshot().peers.map((p) => p.name), ["Player 1"])).toBeUndefined();
  });

  it("when a third peer's hello carries a hostile name, then the second guest's list shows it cleaned and cut", () => {
    const s = session({ name: "  Zed\u202E\u0000 the\tquick brown fox jumps  " });
    const hostile = new NetPlay(fakeGame(undefined, "Bea"), { connect: s.hub.connect, now: s.clock });
    open.push(hostile);
    hostile.join("R", "bc");
    for (let k = 0; k < 60; k++) {
      s.advance(FRAME_MS);
      s.host.drive(s.hg.cars(), FRAME_MS / 1000, -1);
      s.host.frame(FRAME_MS / 1000);
      s.client.frame(FRAME_MS / 1000);
      hostile.frame(FRAME_MS / 1000);
      s.hub.flush();
    }
    expect(hostile.status().car).toBe(2);
    const names = Object.fromEntries(hostile.voice.snapshot().peers.map((p) => [p.car, p.name]));
    expect(Object.keys(names), "peers the third guest lists").toHaveLength(2);
    expect(names[0], "the host's car").toBe("Host");
    expect(names[1], "the second guest's car").toBe("Zed the quick br");
  });
});

/** Rooms apart: a room's code decides which peers meet, as the relay does, so a peer under another password reaches nobody. */
class Rooms {
  readonly hubs = new Map<string, Hub>();
  readonly connect = (tx: NetTx, room: string, id: string, role: "host" | "client", meta?: () => string) => {
    let hub = this.hubs.get(room);
    if (!hub) this.hubs.set(room, (hub = new Hub()));
    return hub.connect(tx, room, id, role, meta);
  };
  flush(): void {
    for (const hub of this.hubs.values()) hub.flush();
  }
}

/** What the host's panel sends for a campaign: a private room under the password PW over two courses, waiting for two players. */
const CAMPAIGN_ROOM: HostRoom = { kind: "campaign", code: "PW", tx: "bc", minPlayers: 2, course: "oval", playlist: ["rally", "oval"], autoNext: true };

/** A host (through `hostRoom`) and any number of guests on one clock; `run(s)` frames them all for `s` seconds. */
function hosted(room: HostRoom, guests = 1) {
  const rooms = new Rooms();
  let now = 1000;
  const hg = fakeGame([]);
  const host = new NetPlay(hg, { connect: rooms.connect, now: () => now });
  const others = Array.from({ length: guests }, () => ({ net: new NetPlay(fakeGame([]), { connect: rooms.connect, now: () => now }) }));
  open.push(host, ...others.map((o) => o.net));
  host.hostRoom(room);
  for (const o of others) {
    if (room.code === null) o.net.publicJoin(host.status().room, room.kind);
    else o.net.join(room.code, room.tx);
  }
  const run = (seconds: number): void => {
    for (let t = 0; t < seconds; t += FRAME_MS / 1000) {
      now += FRAME_MS;
      host.frame(FRAME_MS / 1000);
      for (const o of others) o.net.frame(FRAME_MS / 1000);
      rooms.flush();
    }
  };
  return { rooms, hg, host, guests: others.map((o) => o.net), run };
}

describe("given a room hosted through the one hosting flow, whatever the game", () => {
  it("when the host waits for more players, then Go works only once that many are in, for each game, public or private", () => {
    for (const kind of codec.GAME_KINDS) {
      for (const code of ["PW", null]) {
        const label = `${kind} ${code === null ? "public" : "private"}`;
        const r = hosted({ ...CAMPAIGN_ROOM, kind, code, minPlayers: 3 });
        expect(r.host.status().gate?.min, `${label}: hostRoom set the players to wait for`).toBe(3);
        expect(r.host.go(), `${label}: alone`).toBe(false);
        r.run(2);
        expect(r.host.status().gate?.players, label).toBe(2);
        expect(r.host.canGo(), `${label}: two of the three wanted`).toBe(false);
        expect(r.host.go(), label).toBe(false);
        r.host.setMinPlayers(2);
        expect(r.host.canGo(), `${label}: the stepper lowered it`).toBe(true);
        expect(r.host.go(), label).toBe(true);
        const race = r.hg.race()!;
        if (kind === "race") expect(firstMismatch(r.hg.started, ["race"]), label).toBeUndefined();
        else if (kind === "derby") expect(firstMismatch(r.hg.started, ["derby"]), label).toBeUndefined();
        else if (kind === "survival") expect(r.hg.raceEntered.at(-1), `${label}: Survival is entered as such`).toBe(true);
        else expect(race.commands.at(-1)?.type, label).toBe("campaign");
      }
    }
  });

  it("when a private room is hosted under a password, then a guest under another password is never seated, the right one is, and the room is not tagged for the relay's list; a public room is named after its game and tagged", () => {
    const r = hosted({ ...CAMPAIGN_ROOM, kind: "race" }, 1);
    const wrong = new NetPlay(fakeGame([]), { connect: r.rooms.connect, now: () => 1000 });
    open.push(wrong);
    wrong.join("NOPE", "bc");
    r.run(HOST_WAIT_MS / 1000 + 1);
    for (let k = 0; k < 200; k++) wrong.frame(FRAME_MS / 1000);
    r.rooms.flush();
    expect(r.guests[0]!.status().car, "the right password is seated").toBe(1);
    expect(wrong.status().car, "the wrong one gets no car").toBe(-1);
    expect(wrong.status().problem, "and is told nobody hosts there").toBe("no-host");
    expect(r.host.status().peers.map((p) => p.id).join(), "the host never saw it").toBe(r.guests[0]!.status().selfId);
    expect(r.host.status().public).toBe(null);
    expect(r.rooms.hubs.get("PW")!.metas.get(r.host.status().selfId)!(), "a private room carries no relay tag").toBe("");
    const pub = hosted({ ...CAMPAIGN_ROOM, code: null });
    expect(pub.host.status().public).toBe("campaign");
    expect(pub.host.status().room).toMatch(new RegExp(`^pub-campaign-v${codec.NET_VERSION}-`));
    expect(pub.rooms.hubs.get(pub.host.status().room)!.metas.get(pub.host.status().selfId)!(), "the relay lists it as a campaign lobby over 2 courses").toBe("lobby.2");
  });

  it("when the host picks the courses of a campaign, then the host and the guest read them in play order, unknown and repeated courses drop, and only the host sets them", () => {
    const r = hosted(CAMPAIGN_ROOM);
    r.run(2);
    expect(firstMismatch(r.host.status().gate?.playlist, ["rally", "oval"])).toBeUndefined();
    expectGate(r.guests[0]!.status().gate, { min: 2, kind: "campaign", course: "", playlist: ["rally", "oval"], players: 2 }, "the guest reads the host's gate");
    r.host.setPlaylist(["city", "oval", "nowhere", "city"]);
    r.run(1);
    expect(firstMismatch(r.guests[0]!.status().gate?.playlist, ["city", "oval"])).toBeUndefined();
    r.guests[0]!.setPlaylist(["oval"]);
    r.run(1);
    expect(firstMismatch(r.host.status().gate?.playlist, ["city", "oval"]), "a guest changes nothing").toBeUndefined();
  });

  it("when Go starts a campaign, then the director gets the playlist and then the campaign; with no courses picked Go does nothing", () => {
    const empty = hosted({ ...CAMPAIGN_ROOM, playlist: [] });
    empty.run(2);
    expect(empty.host.canGo(), "no courses").toBe(false);
    expect(empty.host.go()).toBe(false);
    empty.host.setPlaylist(["oval"]);
    expect(empty.host.go()).toBe(true);
    const r = hosted(CAMPAIGN_ROOM);
    r.run(2);
    expect(r.host.go()).toBe(true);
    const sent = r.hg.race();
    if (!sent) throw new Error("race mode is off");
    expect(sent.commands, "the director's commands").toHaveLength(2);
    const [options, campaign] = sent.commands;
    if (options?.type !== "options") throw new Error(`the first command is ${options?.type}, not the options`);
    expect(firstMismatch(options.options.campaign, ["rally", "oval"]), "the playlist the director got").toBeUndefined();
    expect(Object.keys(options.options), "only the playlist is set").toHaveLength(1);
    expect(campaign?.type, "then the campaign").toBe("campaign");
    expect(r.host.status().gate, "the game runs: no gate").toBe(null);
  });

  it("when a campaign round ends, then everyone reads a countdown from one minute, the host moves the campaign on when it runs out, and the next round clears it", () => {
    const r = hosted(CAMPAIGN_ROOM);
    r.run(2);
    r.host.go();
    const race = r.hg.race()!;
    race.phase = "racing";
    r.run(30);
    expect(firstMismatch([r.host.status().nextIn, r.guests[0]!.status().nextIn, race.advanced], [null, null, 0]), "a round in progress has no clock").toBeUndefined();
    race.phase = "finished";
    r.run(10);
    // The guest's clock is the host's last race message (5 Hz): a second behind at most.
    for (const [who, net] of [["host", r.host], ["guest", r.guests[0]!]] as const) expect(net.status().nextIn! > 45 && net.status().nextIn! <= 51, `${who}: ${net.status().nextIn} s left of the minute`).toBeTruthy();
    expect(race.advanced).toBe(0);
    r.run(51);
    expect(race.advanced, "the minute is up: the host moved on once").toBe(1);
    race.phase = "racing";
    r.run(2);
    expect(firstMismatch([r.host.status().nextIn, r.guests[0]!.status().nextIn], [null, null]), "the next round is under way").toBeUndefined();
  });

  it("when the host switches auto-advance off, then the room stays on the results however long it waits and shows no clock, and switching it on again gives a fresh minute", () => {
    const r = hosted(CAMPAIGN_ROOM);
    r.run(2);
    r.host.go();
    const race = r.hg.race()!;
    r.host.setAutoNext(false);
    expect(r.host.status().autoNext).toBe(false);
    race.phase = "finished";
    r.run(150);
    expect(firstMismatch([race.advanced, r.host.status().nextIn, r.guests[0]!.status().nextIn], [0, null, null])).toBeUndefined();
    r.host.setAutoNext(true);
    r.run(2);
    expect(race.advanced, "a fresh minute, not the one that passed").toBe(0);
    expect(r.guests[0]!.status().nextIn!).toBeGreaterThanOrEqual(55);
    expect(r.guests[0]!.status().autoNext, "only the host has the switch").toBe(null);
  });

  it("when the campaign's last standings are left, then the room is back in the Havana lobby for everyone", () => {
    const r = hosted(CAMPAIGN_ROOM);
    r.run(2);
    r.host.go();
    const race = r.hg.race()!;
    race.phase = "racing";
    r.run(5);
    expect(r.host.status().gate).toBe(null);
    const lobbies = r.hg.lobbyEntered.length;
    race.phase = null;
    r.run(2);
    expect(r.hg.lobbyEntered.length, "the host reopened the lobby").toBe(lobbies + 1);
    expect(r.hg.lobbyEntered.at(-1)).toBe(true);
    expect(r.host.status().gate?.kind).toBe("campaign");
    expect(firstMismatch(r.guests[0]!.status().gate?.playlist, ["rally", "oval"]), "the guest is back at the gate with the same courses").toBeUndefined();
  });
});

describe("given a host in a race whose state moves only in the fields a race message leaves out (the clock, progress, position)", () => {
  /** One car on the grid; `laps` stands for any field the message does carry, `tick` for the ones it leaves out. */
  const snapOf = (laps: number, tick: number) =>
    ({ trackId: "oval", laps, noReset: false, phase: "racing", time: tick / FRAMES_PER_SECOND, lights: 3, winnerId: null, winBy: null, cars: [{ id: 0, name: "Ann", progress: tick, x: tick, z: 0, draft: 0, stopped: 0 }], order: [0], firstAt: [], survival: null, pack: null, campaign: null, standings: false }) as unknown as RaceSnapshot;

  it("when 3 s pass, then the guest hears the race on the host's keyframes alone, a changed field reaches it within 6 frames, and its clock runs on every frame", () => {
    const applied: number[] = [];
    const s = session({ hostRace: true, raceApplied: applied });
    let tick = 0;
    let laps = 1;
    s.hg.race()!.snapshot = () => snapOf(laps, tick);
    const run0 = s.cg.race()!.clockRun;
    for (let i = 0; i < 3 * FRAMES_PER_SECOND; i++) {
      tick++;
      s.step();
    }
    expect(applied.length >= 3 && applied.length <= 5, `${applied.length} race messages in 3 s (15 when every 6th frame sends)`).toBeTruthy();
    expect(applied.every((n) => n === 1)).toBeTruthy();
    laps = 2;
    for (let i = 0; i < 6; i++) {
      tick++;
      s.step();
    }
    expect(applied.at(-1), "the changed field is sent without waiting for the keyframe").toBe(2);
    expect(Math.abs(s.cg.race()!.clockRun - run0 - (3 * FRAMES_PER_SECOND + 6) * (FRAME_MS / 1000)), "the guest's clock ran on for every frame").toBeLessThan(1e-6);
  });
});
