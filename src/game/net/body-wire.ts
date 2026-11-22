import { makeBodyFrame, readBodyFrame, writeBodyFrame } from "./body-codec.ts";
import type { Reader, Writer } from "./codec.ts";
import { BODY_EVERY } from "./net-constants.ts";
import type { CrowdLink } from "./net-ports.ts";
import type { NetTransport } from "./transport.ts";

/** Half the 16-bit sequence space: a sequence this far ahead is behind. */
const HALF_SEQUENCE = 0x8000;

/** The frame of people on the wire (`MSG.bodies`): the host's to its guests every `BODY_EVERY`th snapshot, a guest's from them. */
export class BodyWire {
  readonly out = makeBodyFrame();
  readonly in = makeBodyFrame();
  seq = 0;
  last = -1;

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

  /** The followed host is gone: the next one starts its own sequence. */
  forget(): void {
    this.last = -1;
  }
}
