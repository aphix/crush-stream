import { neuroticismOf } from "../ai/civilians/civilian-temperament.ts";
import { CHANNELS } from "./civilian-anim-channels.ts";

/** A snap in her pose (a clip begun or cut off, a stop or a start) is paid back over this long: the share of it left falls by 1/e every `SNAP_SECONDS`. */
const SNAP_SECONDS = 0.18;
/** A frame this long (s) or longer is taken as this long: after a stall the snap does not vanish at once. */
const LONGEST_FRAME_SECONDS = 0.1;
/** The frame a civilian is taken to have last been posed in before she was ever: no frame is one before the next. */
const NEVER_POSED = -(2 ** 30);

/**
 * What keeps a drawn civilian's pose from snapping: her last drawn channels, and what is left of the jump the last change of her activity or of her walk made. A change gives her the
 * old pose at once (her drawn pose is where it was) and the new one grows back over `SNAP_SECONDS`, so a clip cut off by its owner, a walk that starts or a stop crossfades, while a pose that
 * only moves on (a stride, a clip's own keys) is not touched: it is not delayed or flattened. Typed arrays sized at construction; nothing allocates after.
 */
export class PoseSmoothing {
  private readonly lastDrawn: Float64Array;
  private readonly leftOver: Float64Array;
  private readonly lastActivity: Uint8Array;
  private readonly lastMoving: Uint8Array;
  private readonly lastStamp: Int32Array;
  /** Each civilian's jumpiness (`neuroticismOf` the look word she was last read with), kept so the hash is made again only when her look changes. */
  readonly nerve: Float64Array;
  private readonly nerveLook: Uint32Array;
  private stamp = 0;
  private decay = 1;

  constructor(capacity: number) {
    this.lastDrawn = new Float64Array(capacity * CHANNELS);
    this.leftOver = new Float64Array(capacity * CHANNELS);
    this.lastActivity = new Uint8Array(capacity);
    this.lastMoving = new Uint8Array(capacity);
    this.lastStamp = new Int32Array(capacity).fill(NEVER_POSED);
    this.nerve = new Float64Array(capacity);
    this.nerveLook = new Uint32Array(capacity);
    for (let civilian = 0; civilian < capacity; civilian++) this.nerve[civilian] = neuroticismOf(0);
  }

  /** `nerve[civilian]` is the jumpiness of her look word `looks[civilian]`. */
  refreshNerve(looks: Uint32Array, civilian: number): void {
    if (this.nerveLook[civilian] === looks[civilian]) return;
    this.nerveLook[civilian] = looks[civilian]!;
    this.nerve[civilian] = neuroticismOf(looks[civilian]!);
  }

  /** Once a frame before the civilians are posed: this frame's number (one more than the last's, so a civilian posed in both is continuous) and the seconds since the last. */
  begin(stamp: number, frameSeconds: number): void {
    this.stamp = stamp;
    this.decay = Math.exp(-Math.min(frameSeconds, LONGEST_FRAME_SECONDS) / SNAP_SECONDS);
  }

  /** Civilian `civilian`'s channels (target pose, in place) become what is drawn: the target plus what is left of the last snap. `moving`: 1 when she walks. */
  apply(civilian: number, activity: number, moving: number, channels: Float64Array): void {
    const base = civilian * CHANNELS;
    const continuous = ((this.stamp - this.lastStamp[civilian]!) | 0) === 1;
    const snapped = continuous && (activity !== this.lastActivity[civilian] || moving !== this.lastMoving[civilian]);
    for (let channel = 0; channel < CHANNELS; channel++) {
      const left = !continuous ? 0 : snapped ? this.lastDrawn[base + channel]! - channels[channel]! : this.leftOver[base + channel]! * this.decay;
      this.leftOver[base + channel] = left;
      const drawn = channels[channel]! + left;
      this.lastDrawn[base + channel] = drawn;
      channels[channel] = drawn;
    }
    this.lastActivity[civilian] = activity;
    this.lastMoving[civilian] = moving;
    this.lastStamp[civilian] = this.stamp;
  }
}
