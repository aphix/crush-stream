import { makeBodyFrame, makeFootRecord, readBodyFrame, readFoot, writeBodyFrame, writeFoot } from "./body-codec.ts";
import type { Reader, Writer } from "./codec.ts";
import { BODY_EVERY, HALF_SEQUENCE } from "./net-constants.ts";
import type { CrowdLink } from "./net-ports.ts";
import type { NetTransport } from "./transport.ts";

/** A guest sends its walker with every this-many-th input packet: 15 Hz. */
const FOOT_EVERY = 2;

/** The frame of people on the wire (`MSG.bodies`): the host's to its guests every `BODY_EVERY`th snapshot, a guest's from them; and a guest's walker (`MSG.foot`) to the host. */
export class BodyWire {
  readonly out = makeBodyFrame();
  readonly in = makeBodyFrame();
  seq = 0;
  last = -1;
  readonly footOut = makeFootRecord();
  readonly footIn = makeFootRecord();
  footSeq = 0;
  footTick = 0;

  /** Host: the frame for snapshot `snapshotSeq`, when it is one that carries it; the bytes sent. */
  send(link: CrowdLink, t: NetTransport, w: Writer, snapshotSeq: number): number {
    if (snapshotSeq % BODY_EVERY !== 0) return 0;
    link.writeBodies(this.out);
    this.out.seq = this.seq = (this.seq + 1) & 0xffff;
    this.out.crowdTime = link.crowdTime();
    w.off = 0;
    writeBodyFrame(w, this.out);
    t.send(w.done());
    return w.off;
  }

  /** Guest: a `MSG.bodies` message of the host's, handed to the link unless it is malformed or not newer than the last. */
  take(data: Uint8Array, r: Reader, link: CrowdLink): void {
    if (!readBodyFrame(data, r, this.in)) return;
    const seq = this.in.seq;
    if (this.last >= 0 && (((seq - this.last) & 0xffff) >= HALF_SEQUENCE || seq === this.last)) return;
    this.last = seq;
    link.hearBodies(this.in);
  }

  /** Guest: with every second call, its walker (or that it is back in a car) to the host `to`. */
  sendFoot(link: CrowdLink, t: NetTransport, w: Writer, to: string | null): void {
    if (to === null || this.footTick++ % FOOT_EVERY !== 0 || !link.writeFoot(this.footOut)) return;
    this.footOut.seq = this.footSeq = (this.footSeq + 1) & 0xffff;
    w.off = 0;
    writeFoot(w, this.footOut);
    t.send(w.done(), to);
  }

  /** Host: a `MSG.foot` message of the guest in car `car`, handed to the link when it is well formed. */
  takeFoot(data: Uint8Array, r: Reader, link: CrowdLink, car: number): void {
    if (readFoot(data, r, this.footIn)) link.hearFoot(car, this.footIn);
  }

  /** The followed host is gone: the next one starts its own sequences. */
  forget(): void {
    this.last = -1;
    this.footSeq = 0;
    this.footTick = 0;
  }
}
