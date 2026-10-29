import { describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { creditLines, DEFAULT_STATION, loadManifest, musicBase, stationIdOrDefault, stationOf, trackUrl, type MusicTrack } from "./music-manifest.ts";

const BASE = "/crush/music/";
const REFERENCE = JSON.parse(readFileSync(new URL("../../../public/music/manifest.json", import.meta.url), "utf8"));
const TRACK = {
  file: "aspyer-overdrive.mp3",
  artist: "Aspyer",
  title: "Overdrive",
  attribution: ["Song: Aspyer - Overdrive [NCS Release]"],
  links: [{ label: "Watch", url: "http://ncs.io/A_Overdrive" }],
};

/** `loadManifest` against a fetch that answers `body` with `status`; returns the outcome and the URL it asked for. */
async function load(body: unknown, status = 200): Promise<{ outcome: Promise<unknown>; asked: () => string }> {
  const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation(async () => new Response(typeof body === "string" ? body : JSON.stringify(body), { status }));
  const outcome = loadManifest(BASE);
  outcome.then(
    () => vi.restoreAllMocks(),
    () => vi.restoreAllMocks(),
  );
  return { outcome, asked: () => String(fetchMock.mock.calls[0]![0]) };
}

describe("given the music folder's base URL", () => {
  const testCases = [
    { name: "the app at the site root", env: { BASE_URL: "/" }, expected: "/music/" },
    { name: "the app under a sub-path", env: { BASE_URL: "/crush/" }, expected: "/crush/music/" },
    { name: "no Vite env at all", env: undefined, expected: "/music/" },
    { name: "an override with a slash", env: { BASE_URL: "/crush/", VITE_MUSIC_BASE: "https://cdn.example/m/" }, expected: "https://cdn.example/m/" },
    { name: "an override without a slash", env: { BASE_URL: "/crush/", VITE_MUSIC_BASE: "/media/music" }, expected: "/media/music/" },
    { name: "an empty override", env: { BASE_URL: "/crush/", VITE_MUSIC_BASE: "" }, expected: "/crush/music/" },
  ];
  for (const c of testCases) {
    it(`when the build has ${c.name}, then the base is ${c.expected}`, () => {
      expect(musicBase(c.env)).toBe(c.expected);
    });
  }
  it("when a track is asked for, then its URL is the base and its file", () => {
    expect(trackUrl(BASE, TRACK)).toBe("/crush/music/aspyer-overdrive.mp3");
  });
});

describe("given a manifest served by the music folder", () => {
  it("when it is valid, then every track comes back with its credit lines", async () => {
    const { outcome, asked } = await load({ tracks: [TRACK] });
    const tracks = (await outcome) as (typeof TRACK)[];
    expect(asked()).toBe("/crush/music/manifest.json");
    expect(tracks.length).toBe(1);
    expect(tracks[0]!.attribution[0]).toBe("Song: Aspyer - Overdrive [NCS Release]");
    expect(tracks[0]!.links[0]!.url).toBe("http://ncs.io/A_Overdrive");
  });
  it("when the manifest lists no track, then the list is empty", async () => {
    const { outcome } = await load({ tracks: [] });
    expect(((await outcome) as unknown[]).length).toBe(0);
  });
  it("when a track names the calm station and another names none, then the first is calm and the second is on High Energy", async () => {
    const { outcome } = await load({ tracks: [{ ...TRACK, station: "calm" }, { ...TRACK, file: "syntact-ego.mp3" }] });
    const tracks = (await outcome) as MusicTrack[];
    expect(stationOf(tracks[0]!), "named calm").toBe("calm");
    expect(stationOf(tracks[1]!), "no station: High Energy").toBe("high");
    expect(DEFAULT_STATION, "a browser that has picked none plays Calm (owner, 2026-10-26)").toBe("calm");
  });
  const stationTexts = [
    { it: "a stored calm", text: "calm", expected: "calm" },
    { it: "a stored high", text: "high", expected: "high" },
    { it: "nothing stored", text: "", expected: "calm" },
    { it: "an id this build does not know", text: "polka", expected: "calm" },
  ] as const;
  for (const c of stationTexts) {
    it(`when the saved station is ${c.it}, then the station is ${c.expected}`, () => {
      expect(stationIdOrDefault(c.text)).toBe(c.expected);
    });
  }
  const rejected = [
    { name: "is missing (404)", body: "not found", status: 404 },
    { name: "is not JSON", body: "<!doctype html>", status: 200 },
    { name: "has no tracks list", body: { songs: [] }, status: 200 },
    { name: "names a file in capitals or with spaces", body: { tracks: [{ ...TRACK, file: "Aspyer - Overdrive.mp3" }] }, status: 200 },
    { name: "names a file in a sub-folder", body: { tracks: [{ ...TRACK, file: "a/b.mp3" }] }, status: 200 },
    { name: "names a file that is not an mp3", body: { tracks: [{ ...TRACK, file: "aspyer-overdrive.wav" }] }, status: 200 },
    { name: "lists one file twice", body: { tracks: [TRACK, TRACK] }, status: 200 },
    { name: "has an empty title", body: { tracks: [{ ...TRACK, title: "" }] }, status: 200 },
    { name: "names a station that does not exist", body: { tracks: [{ ...TRACK, station: "loud" }] }, status: 200 },
    { name: "has a link that is not http(s)", body: { tracks: [{ ...TRACK, links: [{ label: "Watch", url: "javascript:alert(1)" }] }] }, status: 200 },
  ];
  for (const c of rejected) {
    it(`when the manifest ${c.name}, then loading rejects (the caller plays no music)`, async () => {
      const { outcome } = await load(c.body, c.status);
      await expect(outcome).rejects.toThrow();
    });
  }
});

describe("given the soundtrack manifest shipped with the game", () => {
  it("when it is loaded, then it validates with the four soundtrack files", async () => {
    const { outcome } = await load(REFERENCE);
    const tracks = (await outcome) as (typeof TRACK)[];
    expect(tracks.map((t) => t.file).join()).toBe("aspyer-overdrive.mp3,luke-alexander-ride-with-me.mp3,syntact-ego.mp3,manshn-code.mp3");
  });
  for (const track of REFERENCE.tracks as (typeof TRACK)[]) {
    it(`when ${track.file} is credited, then its first line names the song in the NCS format and its second line NoCopyrightSounds`, () => {
      expect(track.attribution[0]).toBe(`Song: ${track.artist} - ${track.title} [NCS Release]`);
      expect(track.attribution[1]).toBe("Music provided by NoCopyrightSounds");
    });
  }
  it("when Syntact is credited, then it has no Watch link (the source attribution's was cut off)", () => {
    const syntact = (REFERENCE.tracks as (typeof TRACK)[]).find((t) => t.file === "syntact-ego.mp3")!;
    expect(syntact.links.map((l) => l.label).join()).toBe("Free Download/Stream");
  });
});

describe("given a track's credit lines, as the attribution text gives them", () => {
  const testCases = [
    { file: "aspyer-overdrive.mp3", lines: ["Song: Aspyer - Overdrive [NCS Release]", "Music provided by NoCopyrightSounds", "Free Download/Stream: http://ncs.io/A_Overdrive", "Watch: http://ncs.lnk.to/A_OverdriveAT/youtube"] },
    { file: "luke-alexander-ride-with-me.mp3", lines: ["Song: Luke Alexander - RIDE WITH ME [NCS Release]", "Music provided by NoCopyrightSounds", "Free Download/Stream: http://ncs.io/RWM", "Watch: http://ncs.lnk.to/RWMAT/youtube"] },
    { file: "syntact-ego.mp3", lines: ["Song: Syntact - Ego [NCS Release]", "Music provided by NoCopyrightSounds", "Free Download/Stream: http://ncs.io/Ego"] },
    { file: "manshn-code.mp3", lines: ["Song: MANSHN - Code [NCS Release]", "Music provided by NoCopyrightSounds", "Free Download/Stream: http://ncs.io/Code"] },
  ];
  for (const c of testCases) {
    it(`when ${c.file} is credited, then its ${c.lines.length} lines read as the attribution (a link follows its label)`, () => {
      const track = (REFERENCE.tracks as (typeof TRACK)[]).find((t) => t.file === c.file)!;
      const read = creditLines(track).map((line) => (line.url === null ? line.text : `${line.text} ${line.url}`));
      expect(read.join("\n")).toBe(c.lines.join("\n"));
    });
  }
  it("when a track has a link, then its text line has no url and its link line carries the url", () => {
    const lines = creditLines(TRACK);
    expect(lines[0]!.url).toBe(null);
    expect(lines[1]!.url).toBe("http://ncs.io/A_Overdrive");
  });
});
