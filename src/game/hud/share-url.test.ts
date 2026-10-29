import { describe, expect, it } from "vitest";
import { decodeShare, encodeShare, isShareableRoom, joinsRoom, roomLink, shareFragment, type ShareState } from "./share-url.ts";
import { INITIAL_HUD, KNOB_RANGES } from "./hud-store.ts";
import { DRIVER_CARS } from "../match/types.ts";
import { firstMismatch } from "../kernel/compare-arrays.test-util.ts";

const DEFAULTS = decodeShare("");
const json = (s: ShareState): string => JSON.stringify(s);

describe("given the default share settings", () => {
  it("when the defaults are encoded and an empty fragment is decoded, then the defaults write an empty fragment and an empty fragment reads back as the defaults", () => {
    expect(encodeShare(DEFAULTS)).toBe("");
    expect(DEFAULTS.scene).toBe("fleet");
    expect(DEFAULTS.cars).toBe(INITIAL_HUD.carCount);
    expect(DEFAULTS.smax).toBe(INITIAL_HUD.speedMax);
    expect(DEFAULTS.seed).toBe(null);
    expect(DEFAULTS.fx).toBe(null);
  });

  it("when cars, minimum speed, ramps and a seed differ from the defaults, then only those are written, in a readable order, and a value equal to its default is dropped even when set explicitly", () => {
    const s: ShareState = { ...DEFAULTS, cars: 7, smin: 12, ramps: true, seed: 0x3fa2c1 };
    expect(encodeShare(s)).toBe("cars=7&smin=12&ramps=1&seed=3fa2c1");
    // A value equal to its default is dropped even when it was set explicitly.
    expect(encodeShare({ ...DEFAULTS, cars: INITIAL_HUD.carCount, night: false })).toBe("");
  });

  it("when the sky is pinned off or on, then the fragment carries it and reads it back, and auto (the default) writes nothing", () => {
    expect(encodeShare({ ...DEFAULTS, sky: "off" })).toBe("sky=off");
    expect(decodeShare("sky=on").sky).toBe("on");
    expect(decodeShare("sky=bogus").sky).toBe("auto");
    expect(encodeShare({ ...DEFAULTS, sky: "auto" })).toBe("");
  });
});

describe("given a share state with every kind of field set", () => {
  it("when it is encoded and decoded again, then it comes back as the same state", () => {
    const s: ShareState = {
      ...DEFAULTS,
      scene: "race",
      cars: 9,
      smin: 3.5,
      smax: 40,
      night: true,
      wet: true,
      real: 0.8,
      rumble: false,
      fx: "low",
      fxd: 1.1,
      cel: 0.65,
      psky: 0.35,
      dots: 0.5,
      hatch: 0.4,
      rim: 0.6,
      squash: KNOB_RANGES.squash.min,
      buckle: 0.9,
      loop: false,
      slomo: false,
      mvol: 0.2,
      evol: 0.8,
      ts: 0.25,
      deform: "lattice",
      car: "monster",
      pkph: 90,
      pkg: 2500,
      phard: 0.5,
      phold: true,
      phop: 3,
      dkph: 30,
      dkg: 800,
      dside: "left",
      dlid: 2,
      track: "figure8",
      camp: ["rally", "oval", "city"],
      mode: "campaign",
      laps: 5,
      ai: 11,
      aggr: 0.9,
      diff: "easy",
      police: true,
      noreset: true,
      spectate: true,
      "cam.pos.lat": 3.25,
      "cam.zeta.up": 0.5,
      "cam.landing.hold": 1.2,
      seed: 0xffffffff,
    };
    expect(json(decodeShare(`#${encodeShare(s)}`))).toBe(json({ ...s, squash: Math.round(s.squash * 1e4) / 1e4 }));
  });
});

describe("given the campaign's picked courses in a share link", () => {
  it("when it is the default list, then nothing is written, and a changed order or subset writes in order and reads back", () => {
    expect(encodeShare(DEFAULTS)).toBe("");
    const s: ShareState = { ...DEFAULTS, camp: ["city", "oval"] };
    expect(encodeShare(s)).toBe("camp=city,oval");
    expect(firstMismatch(decodeShare(`#${encodeShare(s)}`).camp, ["city", "oval"])).toBeUndefined();
    const reversed: ShareState = { ...DEFAULTS, camp: [...DEFAULTS.camp].reverse() };
    expect(decodeShare(`#${encodeShare(reversed)}`).camp.join()).toBe(reversed.camp.join());
  });

  it("when none is ticked, then it writes an empty list and reads back as none, not as the default", () => {
    const s: ShareState = { ...DEFAULTS, camp: [] };
    expect(encodeShare(s)).toBe("camp=");
    expect(decodeShare("#camp=").camp).toHaveLength(0);
  });

  it("when the list has repeats and malformed ids, then repeats and malformed ids drop and the rest keep their order", () => {
    expect(firstMismatch(decodeShare("#camp=rally,oval,rally,..%2Fx,city").camp, ["rally", "oval", "city"])).toBeUndefined();
  });

  it("when the setup menu's Mode is Campaign, then the link writes mode=campaign and reads it back, Single race writes nothing, and an unknown mode reads as Single race", () => {
    const s: ShareState = { ...DEFAULTS, mode: "campaign" };
    expect(encodeShare(s)).toBe("mode=campaign");
    expect(decodeShare(`#${encodeShare(s)}`).mode).toBe("campaign");
    expect(encodeShare({ ...DEFAULTS, mode: "single" })).toBe("");
    expect(decodeShare("#mode=tournament").mode).toBe("single");
  });
});

describe("given the race's time of day in a share link", () => {
  it("when it is Daytime, then nothing is written; Sunset and Nighttime write tod= and read back; an unknown one reads as Daytime", () => {
    expect(encodeShare({ ...DEFAULTS, tod: "daytime" })).toBe("");
    for (const tod of ["sunset", "nighttime"] as const) {
      expect(encodeShare({ ...DEFAULTS, tod })).toBe(`tod=${tod}`);
      expect(decodeShare(`#tod=${tod}`).tod).toBe(tod);
    }
    expect(decodeShare("#tod=dawn").tod).toBe("daytime");
  });
});

describe("given the player's car type, any of the shared list's", () => {
  for (const car of DRIVER_CARS) {
    const written = car.id === INITIAL_HUD.playerCar ? "" : `car=${car.id}`;
    it(`when the ${car.label} is picked, then the link writes ${written === "" ? "nothing, it being the default" : `"${written}"`} and reads back as the ${car.label}`, () => {
      const s: ShareState = { ...DEFAULTS, car: car.id };
      expect(encodeShare(s)).toBe(written);
      expect(decodeShare(`#${encodeShare(s)}`).car).toBe(car.id);
    });
  }
});

describe("given the Ultra effects tier pinned in a link", () => {
  it("when the link is written and read, then it carries fx=ultra and reads back as the Ultra tier", () => {
    const s: ShareState = { ...DEFAULTS, fx: "ultra" };
    expect(encodeShare(s)).toBe("fx=ultra");
    expect(decodeShare(`#${encodeShare(s)}`).fx).toBe("ultra");
  });
});

describe("given a link with malformed values and unknown keys", () => {
  it("when it is decoded, then every field falls back to its default and nothing throws", () => {
    const d = decodeShare("#scene=nope&cars=abc&night=yes&seed=zz&fx=turbo&car=tank&dside=up&dlid=x&track=../x&foo=1&smin=&ts=1e3&%=%%&");
    expect(json(d)).toBe(json(DEFAULTS));
  });
});

describe("given a link with out-of-range numbers", () => {
  it("when it is decoded, then each number clamps to the HUD's own range for that setting", () => {
    const d = decodeShare("cars=999&smin=-5&smax=500&real=2&fxd=9&buckle=-1&ts=0&ai=0&laps=77&aggr=3&squash=9&dlid=9");
    expect(d.cars).toBe(32);
    expect(d.smin).toBe(KNOB_RANGES.speed.min);
    expect(d.smax).toBe(KNOB_RANGES.speed.max);
    expect(d.real).toBe(KNOB_RANGES.realism.max);
    expect(d.fxd).toBe(KNOB_RANGES.fxDensity.max);
    expect(d.buckle).toBe(KNOB_RANGES.buckle.min);
    expect(d.ts).toBe(KNOB_RANGES.timeScale.min);
    expect(d.ai).toBe(1);
    expect(d.laps).toBe(9);
    expect(d.aggr).toBe(1);
    expect(d.squash).toBe(KNOB_RANGES.squash.max);
    expect(d.dlid).toBe(2);
  });
});

describe("given the music and engine volumes in a share link (mvol, evol)", () => {
  it("when mvol is above the music cap, then it decodes to the cap of 0.6", () => {
    expect(decodeShare("mvol=0.9").mvol).toBe(0.6);
  });

  it("when evol is written and read back, then it round-trips", () => {
    const s: ShareState = { ...DEFAULTS, evol: 0.8 };
    expect(encodeShare(s)).toBe("evol=0.8");
    expect(decodeShare(`#${encodeShare(s)}`).evol).toBe(0.8);
  });

  it("when both volumes are at their defaults, then neither is written, even when set explicitly", () => {
    expect(encodeShare({ ...DEFAULTS, mvol: INITIAL_HUD.musicVolume, evol: INITIAL_HUD.engineVolume })).toBe("");
  });
});

describe("given the pad rumble setting in a share link (rumble)", () => {
  it("when rumble is on, the default, then nothing is written; when it is off, then rumble=0 is, and it reads back off, while a junk value reads as on", () => {
    expect(INITIAL_HUD.rumble).toBe(true);
    expect(encodeShare({ ...DEFAULTS, rumble: true })).toBe("");
    const s: ShareState = { ...DEFAULTS, rumble: false };
    expect(encodeShare(s)).toBe("rumble=0");
    expect(decodeShare(`#${encodeShare(s)}`).rumble).toBe(false);
    expect(decodeShare("rumble=maybe").rumble).toBe(true);
  });
});

describe("given the boost zoom setting in a share link (bzoom)", () => {
  it("when boost zoom is on, the default, then nothing is written; when it is off, then bzoom=0 is, and it reads back off, while a junk value reads as on", () => {
    expect(INITIAL_HUD.boostZoom).toBe(true);
    expect(encodeShare({ ...DEFAULTS, bzoom: true })).toBe("");
    const s: ShareState = { ...DEFAULTS, bzoom: false };
    expect(encodeShare(s)).toBe("bzoom=0");
    expect(decodeShare(`#${encodeShare(s)}`).bzoom).toBe(false);
    expect(decodeShare("bzoom=maybe").bzoom).toBe(true);
  });
});

describe("given a camera slider in a share link, keyed cam.<chase path>", () => {
  it("when one slider is off its default, then only its key is written, one at its default is dropped even when set explicitly, and the fragment reads back", () => {
    expect(encodeShare({ ...DEFAULTS, "cam.pos.lon": 9.5 })).toBe("cam.pos.lon=9.5");
    expect(encodeShare({ ...DEFAULTS, "cam.pos.lon": INITIAL_HUD["cam.pos.lon"] })).toBe("");
    expect(encodeShare({ ...DEFAULTS, "cam.landing.wobbleHz": 12, "cam.driftLean": 0.25 })).toBe("cam.driftLean=0.25&cam.landing.wobbleHz=12");
    expect(decodeShare("#cam.pos.lon=9.5&cam.landing.wobbleHz=12")["cam.pos.lon"]).toBe(9.5);
    expect(decodeShare("#cam.pos.lon=9.5&cam.landing.wobbleHz=12")["cam.landing.wobbleHz"]).toBe(12);
    expect(decodeShare("cam.landing.wobbleHz=30")["cam.landing.wobbleHz"], "an old link's 30 Hz clamps to the new range").toBe(15);
  });

  it("when a slider is out of range or unreadable, then it clamps to the slider's range or is the default", () => {
    const d = decodeShare("cam.pos.lon=99&cam.zeta.lat=0&cam.pos.up=abc");
    expect(d["cam.pos.lon"]).toBe(14);
    expect(d["cam.zeta.lat"]).toBe(0.3);
    expect(d["cam.pos.up"]).toBe(INITIAL_HUD["cam.pos.up"]);
  });
});

describe("given the cel (cartoon shading) strength, which is Auto until a manual strength is set", () => {
  it("when it is left Auto, set manually, or decoded from an out-of-range or unreadable value, then Auto is never written, a manual strength is written, 0 is a real value, and out-of-range values clamp", () => {
    expect(DEFAULTS.cel).toBe(null);
    expect(encodeShare({ ...DEFAULTS, cel: null })).toBe("");
    expect(encodeShare({ ...DEFAULTS, cel: 0.5 })).toBe("cel=0.5");
    expect(decodeShare("cel=0").cel).toBe(0);
    expect(decodeShare("cel=7").cel).toBe(KNOB_RANGES.cel.max);
    expect(decodeShare("cel=-1").cel).toBe(KNOB_RANGES.cel.min);
    expect(decodeShare("cel=abc").cel).toBe(null);
  });
});

describe("given the procedural sky's cloud cover (psky), drawn by default at the HUD's cover, with the picture as the opt-out", () => {
  it("when the default is encoded, a cover is set or the picture is picked, then the default writes nothing, a cover is written after the cel key, the picture is written as the word picture and reads back, 0 is a real cover, out-of-range values clamp and an unreadable one is the default", () => {
    expect(DEFAULTS.psky).toBe(INITIAL_HUD.proceduralSky);
    expect(DEFAULTS.psky, "the procedural sky is the default").not.toBe(null);
    expect(encodeShare(DEFAULTS)).toBe("");
    expect(encodeShare({ ...DEFAULTS, psky: 0.5 })).toBe("psky=0.5");
    expect(encodeShare({ ...DEFAULTS, cel: 0.53, psky: 0.5 })).toBe("cel=0.53&psky=0.5");
    expect(encodeShare({ ...DEFAULTS, psky: null })).toBe("psky=picture");
    expect(decodeShare("psky=picture").psky).toBe(null);
    expect(decodeShare("psky=0").psky).toBe(0);
    expect(decodeShare("psky=7").psky).toBe(KNOB_RANGES.psky.max);
    expect(decodeShare("psky=-1").psky).toBe(KNOB_RANGES.psky.min);
    expect(decodeShare("psky=abc").psky).toBe(INITIAL_HUD.proceduralSky);
  });

  it("when a link written before the default is opened, then its cover still reads, and one without the key gets the default", () => {
    expect(decodeShare("#night=1&psky=0.35").psky).toBe(0.35);
    expect(decodeShare("#night=1").psky).toBe(INITIAL_HUD.proceduralSky);
  });
});

const LOOK_KEYS = [
  { it: "the halftone dots' strength", key: "dots", range: KNOB_RANGES.dots },
  { it: "the pencil hatching's strength", key: "hatch", range: KNOB_RANGES.hatch },
  { it: "the people's rim light strength", key: "rim", range: KNOB_RANGES.rim },
] as const;

for (const c of LOOK_KEYS) {
  describe(`given ${c.it} (${c.key}), which is off until a strength is set`, () => {
    it("when it is left off, set, or decoded from an out-of-range or unreadable value, then off is never written, a strength is written after the cel key, 0 is a real value, and out-of-range values clamp", () => {
      expect(DEFAULTS[c.key]).toBe(null);
      expect(encodeShare({ ...DEFAULTS, [c.key]: null })).toBe("");
      expect(encodeShare({ ...DEFAULTS, [c.key]: 0.5 })).toBe(`${c.key}=0.5`);
      expect(encodeShare({ ...DEFAULTS, cel: 0.53, [c.key]: 0.5 })).toBe(`cel=0.53&${c.key}=0.5`);
      expect(decodeShare(`${c.key}=0`)[c.key]).toBe(0);
      expect(decodeShare(`${c.key}=7`)[c.key]).toBe(c.range.max);
      expect(decodeShare(`${c.key}=-1`)[c.key]).toBe(c.range.min);
      expect(decodeShare(`${c.key}=abc`)[c.key]).toBe(null);
    });
  });
}

const STRENGTH_KEYS = [
  { it: "the material strength", key: "mat", range: KNOB_RANGES.material, fallback: INITIAL_HUD.materialStrength },
  { it: "the car contour strength", key: "cont", range: KNOB_RANGES.contour, fallback: INITIAL_HUD.contourStrength },
] as const;

for (const c of STRENGTH_KEYS) {
  describe(`given ${c.it} (${c.key}), which is full strength by default`, () => {
    it("when it is at its default, moved, or decoded from an out-of-range or unreadable value, then the default writes nothing, a strength is written after the rim key, 0 is a real value, and out-of-range values clamp", () => {
      expect(DEFAULTS[c.key]).toBe(c.fallback);
      expect(c.fallback, "the default is the current look").toBe(1);
      expect(encodeShare(DEFAULTS)).toBe("");
      expect(encodeShare({ ...DEFAULTS, [c.key]: 0.5 })).toBe(`${c.key}=0.5`);
      expect(encodeShare({ ...DEFAULTS, rim: 0.4, [c.key]: 1.5 })).toBe(`rim=0.4&${c.key}=1.5`);
      expect(decodeShare(`${c.key}=0`)[c.key]).toBe(0);
      expect(decodeShare(`${c.key}=7`)[c.key]).toBe(c.range.max);
      expect(decodeShare(`${c.key}=-1`)[c.key]).toBe(c.range.min);
      expect(decodeShare(`${c.key}=abc`)[c.key]).toBe(c.fallback);
    });
  });
}

describe("given a random seed in a share link", () => {
  it("when it is written and read, then it is written in hex, read in either case, holds 32 bits and no more", () => {
    expect(encodeShare({ ...DEFAULTS, seed: 0xab })).toBe("seed=ab");
    expect(decodeShare("seed=AB").seed).toBe(0xab);
    expect(decodeShare("seed=ffffffff").seed).toBe(0xffffffff);
    expect(decodeShare("seed=1ffffffff").seed).toBe(null);
  });
});

describe("given a share link that may carry a netplay room", () => {
  it("when a room is written to a link and read back, then it round-trips with its transport and its link, is uppercased as the Room field does, and only an all-uppercase code counts as shareable", () => {
    expect(encodeShare({ ...DEFAULTS, room: "K7M2QX9P" })).toBe("room=K7M2QX9P");
    expect(encodeShare({ ...DEFAULTS, room: "K7M2QX9P", tx: "bc" })).toBe("room=K7M2QX9P&tx=bc");
    const s: ShareState = { ...DEFAULTS, room: "K7M2QX9P", tx: "bc", scene: "race", laps: 4, seed: 0xabc };
    expect(json(decodeShare(`#${encodeShare(s)}`))).toBe(json(s));
    expect(decodeShare("room=k7m2qx9p").room).toBe("K7M2QX9P");
    expect(isShareableRoom("K7M2QX9P")).toBe(true);
    expect(isShareableRoom("k7m2"), "written uppercase only").toBe(false);
  });

  it("when a link made before rooms existed is decoded, then it has no room and the same settings, and writes back to the same state", () => {
    const old = "#scene=race&track=figure8&laps=5&ai=11&night=1&seed=3fa2c1";
    const d = decodeShare(old);
    expect(d.room).toBe("");
    expect(d.tx).toBe("rtc");
    expect(d.scene).toBe("race");
    expect(d.track).toBe("figure8");
    expect(d.laps).toBe(5);
    expect(d.seed).toBe(0x3fa2c1);
    expect(json(decodeShare(encodeShare(d))), "and writes back to the same state").toBe(json(d));
  });

  it("when the room is malformed or is a public room's name, then it is no room (a crafted link cannot join a public match), and an unknown transport falls back to the default", () => {
    for (const raw of ["", "a b", "ABCDEFGHJKLMN", "../x", "pub-x", "pub-race-v5-QWERTY", "<script>"]) {
      expect(decodeShare(`room=${encodeURIComponent(raw)}`).room, JSON.stringify(raw)).toBe("");
    }
    expect(decodeShare("tx=udp").tx).toBe("rtc");
  });

  it("when scene=survival is written, then it round-trips in the # alone and with a room (a hosted run is a team's), while a link that names a room never opens a single-player scene, the Lab", () => {
    const alone: ShareState = { ...DEFAULTS, scene: "survival" };
    expect(encodeShare(alone)).toBe("scene=survival");
    expect(decodeShare("#scene=survival").scene).toBe("survival");
    expect(json(decodeShare(`#${encodeShare(alone)}`))).toBe(json(alone));
    expect(decodeShare("#room=K7M2QX9P&scene=survival").scene, "Survival is a room's to carry").toBe("survival");
    expect(decodeShare("#room=K7M2QX9P&scene=lab").scene, "a room's link with the Lab in it joins the host's scene").toBe("fleet");
    expect(decodeShare("#room=K7M2QX9P&scene=lab").room).toBe("K7M2QX9P");
    // The other scenes are still a room's to carry.
    expect(decodeShare("#room=K7M2QX9P&scene=range").scene).toBe("range");
  });

  it("when scene=survival names a track, then it decodes to that course and writes back as scene=survival&track=<id>, in the order a link is read", () => {
    const mall: ShareState = { ...DEFAULTS, scene: "survival", track: "national-mall" };
    expect(encodeShare(mall)).toBe("scene=survival&track=national-mall");
    const read = decodeShare("#scene=survival&track=national-mall");
    expect(read.scene).toBe("survival");
    expect(read.track).toBe("national-mall");
    expect(json(decodeShare(`#${encodeShare(mall)}`))).toBe(json(mall));
    expect(decodeShare("#scene=survival").track, "a link without track= names no course: the engine keeps the one picked").toBe(DEFAULTS.track);
  });

  it("when the # is written for a host, a guest and someone who left, then a host's carries its settings and room, a guest's only the room, and leaving drops the room", () => {
    const hosting: ShareState = { ...DEFAULTS, room: "ABCD2345", cars: 7 };
    expect(shareFragment(hosting, false)).toBe("room=ABCD2345&cars=7");
    expect(shareFragment(hosting, true), "a guest's scene is the host's").toBe("room=ABCD2345");
    expect(shareFragment({ ...hosting, room: "" }, false), "left: the room is gone from the #").toBe("cars=7");
    expect(shareFragment({ ...DEFAULTS, cars: 7, room: "" }, true), "a guest that left writes nothing").toBe("");
  });

  it("when a room link is built from a page URL, then it is the page URL plus the room alone, and the transport only when it is not the default", () => {
    expect(roomLink("https://x.test/crush/", "ABCD2345", "rtc")).toBe("https://x.test/crush/#room=ABCD2345");
    expect(roomLink("https://x.test/", "ABCD2345", "bc")).toBe("https://x.test/#room=ABCD2345&tx=bc");
    expect(decodeShare(roomLink("https://x.test/", "ABCD2345", "bc").split("#")[1]!).room).toBe("ABCD2345");
  });

  it("when a # is checked against the room this browser is in, then it joins only a room this browser is not already in (another room, or the same code over another link), and one without a room joins nothing", () => {
    const off = { room: "", tx: "rtc" } as const;
    expect(joinsRoom(decodeShare("room=ABCD2345"), off)).toBe(true);
    expect(joinsRoom(decodeShare("room=ABCD2345"), { room: "ABCD2345", tx: "rtc" }), "already there").toBe(false);
    expect(joinsRoom(decodeShare("room=ABCD2345"), { room: "ZZZZ2345", tx: "rtc" }), "another room").toBe(true);
    expect(joinsRoom(decodeShare("room=ABCD2345&tx=bc"), { room: "ABCD2345", tx: "rtc" }), "same code, other link").toBe(true);
    expect(joinsRoom(decodeShare("night=1"), { room: "ABCD2345", tx: "rtc" }), "a # without a room never leaves one").toBe(false);
    expect(joinsRoom(decodeShare(""), off)).toBe(false);
  });
});

/**
 * Boot precedence: the `#` alone decides what a page load starts as (engine-share.ts `arrive`: `decodeShare`, then
 * `joinsRoom`). The app stores only preferences (driver name and car, HUD layout, saved highlights), so no previous-run
 * session state exists for a hash to lose against.
 */
describe("given a page load, where the # alone decides what it starts as", () => {
  const off = { room: "", tx: "rtc" } as const;

  it("when the hash names a room, then it joins that room with the hash's own settings", () => {
    const t = decodeShare("#room=ABCD2345&night=1&scene=race");
    expect(joinsRoom(t, off)).toBe(true);
    expect(t.room).toBe("ABCD2345");
    expect(t.night).toBe(true);
    expect(t.scene).toBe("race");
  });

  it("when the hash names no room, then it keeps its settings, has no room and does not join", () => {
    const t = decodeShare("#night=1&cars=5");
    expect(joinsRoom(t, off)).toBe(false);
    expect(t.room).toBe("");
    expect(t.night).toBe(true);
    expect(t.cars).toBe(5);
  });

  it("when there is no hash (empty or a bare #), then it is the defaults with no room and no join", () => {
    for (const none of ["", "#"]) {
      const t = decodeShare(none);
      expect(json(t)).toBe(json(DEFAULTS));
      expect(joinsRoom(t, off)).toBe(false);
    }
  });
});

describe("given the showcase eye's pose (cam=)", () => {
  it("when it is unset, set, or decoded from a short, long, unreadable or out-of-range value, then unset writes nothing, a pose is written to 3 decimals before the seed, a wrong shape is dropped and numbers clamp to the ranges", () => {
    expect(DEFAULTS.cam).toBe(null);
    expect(encodeShare({ ...DEFAULTS, scene: "showcase", cam: [1, -0.2, 2.5, 10.12345, 3, 20], seed: 0xab })).toBe("scene=showcase&cam=1,-0.2,2.5,10.123,3,20&seed=ab");
    expect(firstMismatch(decodeShare("cam=1,-0.2,2.5,10,3,20").cam, [1, -0.2, 2.5, 10, 3, 20])).toBeUndefined();
    for (const bad of ["1,2,3,4,5", "1,2,3,4,5,6,7", "1,2,3,4,5,x", "", "1,2,3,4,5,"]) expect(decodeShare(`cam=${bad}`).cam, `"${bad}"`).toBe(null);
    expect(firstMismatch(decodeShare("cam=500,9,99,9999,-9999,0").cam, [100, 1.5, 7, 500, -500, 0])).toBeUndefined();
  });
});
