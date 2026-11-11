import { RUN_STRIDES_PER_SECOND, STRIDE_RADIANS_PER_METRE } from "../ai/civilians/civilian-crowd-constants.ts";
import { neuroticismOf } from "../ai/civilians/civilian-temperament.ts";
import { CHANNELS } from "./civilian-anim-channels.ts";
import type { ActivityPose } from "./civilian-anim.ts";

/** A snap in her pose (a clip begun or cut off, a stop or a start) is paid back over this long: the share of it left falls by 1/e every `SNAP_SECONDS`. */
const SNAP_SECONDS = 0.18;
/** A frame this long (s) or longer is taken as this long: after a stall the snap does not vanish at once. */
const LONGEST_FRAME_SECONDS = 0.1;
/** The drawn spot closes on the brain's with this time constant (s), the drawn facing on its yaw with the other: the walk is the brain's seen through a short low-pass, so a 10 Hz brain does not step her. */
const POS_TAU = 0.18;
const YAW_TAU = 0.12;
/** The drawn spot is never further than this (m) behind the brain's; a gap past `TELEPORT` (m) is a jump, not a walk, and is taken at once. */
export const MAX_LAG = 0.3;
export const TELEPORT = 2;
/** The drawn facing turns at most this fast (rad/s). */
export const MAX_TURN_RATE = 10;
/** A whole turn (rad): the angle gap is wrapped inline (`wrapPi`'s floor form), as a double returned from a call that is not inlined is boxed on the heap. */
const TWO_PI = Math.PI * 2;
/** A runner's stride phase gains this much a second (rad) at most. */
const RUN_RADIANS_PER_SECOND = 2 * Math.PI * RUN_STRIDES_PER_SECOND;
/** Added to a divisor that may be 0 (the pace, a gap): no branch on a double is wanted here, as a ternary that picks a double boxes it on the heap every call. */
const STILL_SPEED = 1e-9;
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
  private readonly drawnX: Float64Array;
  private readonly drawnZ: Float64Array;
  private readonly drawnYaw: Float64Array;
  private readonly drawnSpeed: Float64Array;
  private readonly drawnPhase: Float64Array;
  private stamp = 0;
  private decay = 1;
  private frameSeconds = 0;
  private posShare = 0;
  private yawShare = 0;

  constructor(capacity: number) {
    this.lastDrawn = new Float64Array(capacity * CHANNELS);
    this.leftOver = new Float64Array(capacity * CHANNELS);
    this.lastActivity = new Uint8Array(capacity);
    this.lastMoving = new Uint8Array(capacity);
    this.lastStamp = new Int32Array(capacity).fill(NEVER_POSED);
    this.nerve = new Float64Array(capacity);
    this.nerveLook = new Uint32Array(capacity);
    this.drawnX = new Float64Array(capacity);
    this.drawnZ = new Float64Array(capacity);
    this.drawnYaw = new Float64Array(capacity);
    this.drawnSpeed = new Float64Array(capacity);
    this.drawnPhase = new Float64Array(capacity);
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
    const seconds = Math.min(frameSeconds, LONGEST_FRAME_SECONDS);
    this.decay = Math.exp(-seconds / SNAP_SECONDS);
    this.frameSeconds = seconds;
    this.posShare = 1 - Math.exp(-seconds / POS_TAU);
    this.yawShare = 1 - Math.exp(-seconds / YAW_TAU);
  }

  /**
   * Civilian `civilian`'s brain pose (`pose`'s x, z, yaw, speed and stride) becomes what is drawn: her spot a low-pass of the brain's (never over `MAX_LAG` behind), her speed the metres that
   * drawn spot moved a second, her stride phase on by those metres (at the stride length that pace takes, as the foot cops'), her facing turned at a limited rate. The first drawn frame, or a jump past `TELEPORT`, copies the brain's.
   */
  walk(civilian: number, pose: ActivityPose): void {
    const dx = pose.x - this.drawnX[civilian]!;
    const dz = pose.z - this.drawnZ[civilian]!;
    const gap = Math.sqrt(dx * dx + dz * dz);
    if (((this.stamp - this.lastStamp[civilian]!) | 0) !== 1 || gap > TELEPORT) {
      this.drawnX[civilian] = pose.x;
      this.drawnZ[civilian] = pose.z;
      this.drawnYaw[civilian] = pose.yaw;
      this.drawnSpeed[civilian] = pose.speed;
      this.drawnPhase[civilian] = pose.stride;
      return;
    }
    const left = gap * (1 - this.posShare);
    const behind = Math.min(left, MAX_LAG);
    const share = 1 - behind / (gap + STILL_SPEED);
    const stepX = dx * share;
    const stepZ = dz * share;
    this.drawnX[civilian]! += stepX;
    this.drawnZ[civilian]! += stepZ;
    const metres = Math.sqrt(stepX * stepX + stepZ * stepZ);
    if (this.frameSeconds > 0) this.drawnSpeed[civilian]! += (metres / this.frameSeconds - this.drawnSpeed[civilian]!) * this.posShare;
    const speed = this.drawnSpeed[civilian]!;
    this.drawnPhase[civilian]! += metres * Math.min(STRIDE_RADIANS_PER_METRE, RUN_RADIANS_PER_SECOND / (speed + STILL_SPEED));
    const reach = MAX_TURN_RATE * this.frameSeconds;
    const off = pose.yaw - this.drawnYaw[civilian]!;
    const turn = (off - TWO_PI * Math.floor((off + Math.PI) / TWO_PI)) * this.yawShare;
    this.drawnYaw[civilian]! += Math.max(-reach, Math.min(reach, turn));
    pose.x = this.drawnX[civilian]!;
    pose.z = this.drawnZ[civilian]!;
    pose.yaw = this.drawnYaw[civilian]!;
    pose.speed = speed;
    pose.stride = this.drawnPhase[civilian]!;
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
