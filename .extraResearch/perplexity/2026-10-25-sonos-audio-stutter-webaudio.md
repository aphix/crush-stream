> Question: Windows: audio stutters on a Sonos/network output while a browser tab runs a WebGL game with Web Audio, even with music from VLC; Bluetooth headphones are fine. Causes, and how should a web game configure its AudioContext (latencyHint, sampleRate) so it doesn't cause stutter?

The most likely cause is **real-time audio starvation in the shared Windows/browser audio path**, often made worse by a Web Audio context configured for low latency—not that the WebGL game directly “controls” VLC or Sonos. Network speakers expose these timing problems more readily because audio must be rendered, mixed, resampled if necessary, packetized, buffered, and delivered over the network.

## What is probably happening

- **CPU/GPU contention:** A WebGL game can briefly monopolize CPU time, GPU time, or browser audio-service scheduling. If the audio thread misses its deadline, the output buffer underruns, producing crackles, skips, or dropouts.
- **Too-small Web Audio buffers:** The default Web Audio latency is commonly oriented toward responsiveness. A game that creates an `AudioContext` with `"interactive"` latency—or uses a very small numeric latency—has less scheduling margin. The browser may not honor the requested value exactly; `baseLatency` reports the resulting processing latency.[1][4]
- **Sample-rate conversion:** Windows devices commonly run at either 44.1 or 48 kHz. If the Web Audio context uses a rate different from the output device, the browser must resample the context output; the Web Audio specification notes that this can significantly affect latency.[6] This adds work and another buffer boundary, but a mismatch alone normally causes extra processing rather than periodic stuttering.
- **Windows shared/exclusive-mode interaction:** In shared mode, Windows Audio Engine mixes applications and normally handles conversion. Exclusive mode lets one application use the device format directly and can interfere with other applications or force format changes. It should generally be disabled for a game that must coexist with VLC, browser audio, and a network speaker.
- **Browser audio-service scheduling:** Chrome/Edge run audio processing through browser audio infrastructure separate from the page’s JavaScript thread. Heavy rendering, garbage collection, driver problems, power-saving transitions, or an overloaded audio service can still cause missed deadlines. The fact that Bluetooth headphones work does not rule this out: Bluetooth and Sonos/network outputs use different buffering and driver paths.

Thus, if VLC continues playing while the Sonos stream crackles, the game is probably not replacing VLC’s audio. It is more likely increasing contention or causing the shared output/network path to miss timing deadlines.

## Recommended Web Audio configuration

For a game whose audio should remain smooth rather than achieve minimum latency:

```js
const audioContext = new AudioContext({
  latencyHint: "playback",
  sampleRate: 48000
});

console.log({
  sampleRate: audioContext.sampleRate,
  baseLatency: audioContext.baseLatency,
  outputLatency: audioContext.outputLatency
});
```

However, **do not blindly hard-code 48 kHz**. `sampleRate` should match the actual Windows output device where possible. The Web Audio specification says that omitting it uses the preferred rate of the output device; if the requested rate differs, the browser must resample.[3][6]

A practical approach is:

```js
const audioContext = new AudioContext({
  latencyHint: "playback"
  // Omit sampleRate unless the application knows the device rate.
});
```

If the application has reliable device information and the Windows/Sonos path is configured at 48 kHz:

```js
const audioContext = new AudioContext({
  latencyHint: "playback",
  sampleRate: 48000
});
```

For a device configured at 44.1 kHz, use 44100 instead. The important rule is **one consistent rate throughout the path**, not that 44.1 kHz or 48 kHz is universally better. The default context rate is normally the output device’s preferred rate.[1][3]

`"playback"` favors sustained playback and power efficiency over minimum latency, giving the browser more scheduling margin.[1] It is a better default for background music, sound effects that do not require ultra-low latency, and games where smoothness matters more than instantaneous response. For tightly timed interactive effects, `"balanced"` may be a compromise, but `"interactive"` or very small numeric latency values increase underrun risk.

## Windows-side checks

- Set the Sonos/network output and Windows default format consistently, preferably 48 kHz if that is the device’s native path.
- Disable **Allow applications to take exclusive control** for the affected playback device.
- Disable audio enhancements/spatial effects temporarily for testing.
- Update audio, chipset, GPU, and network drivers.
- Test with the game’s frame rate capped; an uncapped WebGL loop can starve audio scheduling.
- Avoid allocating objects, decoding large assets, or performing heavy JavaScript work during gameplay.
- Keep the `AudioContext` alive rather than repeatedly creating and closing contexts.
- Resume the context only after a user gesture, but do not repeatedly suspend/resume it during play.
- Compare behavior with the game’s Web Audio graph disabled, then with WebGL disabled. This distinguishes audio-graph load from graphics/scheduling load.
- Inspect `audioContext.sampleRate` and `baseLatency`; if the context rate differs from the Windows device rate, test a matching configuration.

The key fix is usually **not merely changing 44.1 to 48 kHz**. The robust combination is: use the device’s native sample rate, avoid exclusive mode, select `latencyHint: "playback"` for noncritical game audio, and reduce CPU/GPU spikes so the browser can continuously fill its audio buffers.

[1] AudioContext() constructor - Web APIs | MDN (https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/AudioContext)
[2] Context (https://tonejs.github.io/docs/14.5.3/Context)
[3] Web Audio API 1.1 - W3C (https://www.w3.org/TR/webaudio-1.1/)
[4] AudioContext: baseLatency property - Web APIs | MDN (https://developer.mozilla.org/en-US/docs/Web/API/AudioContext/baseLatency)
[5] View WebAudio API metrics | Chrome DevTools (https://developer.chrome.com/docs/devtools/webaudio)
[6] Web Audio API (https://www.w3.org/TR/2021/REC-webaudio-20210617/)
[7] Web Audio API - W3C (https://www.w3.org/TR/2018/WD-webaudio-20180619/)
[8] AudioContext | ircam-ismm/node-web-audio-api | DeepWiki (https://deepwiki.com/ircam-ismm/node-web-audio-api/3.1-audiocontext)
[9] dev.classmethod.jp · en · articlesI measured the differences in latency and CPU usage due to ... (https://dev.classmethod.jp/en/articles/chrome-153-webaudio-render-size-hint-latency/)
[10] Web Audio API - World Wide Web Consortium (W3C) (https://www.w3.org/TR/webaudio-1.0/)
