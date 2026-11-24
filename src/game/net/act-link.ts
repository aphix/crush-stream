import { Act, NAMED, type Named, packAct, readAct } from "./act-codec.ts";

/** A sequence number is newer than `last` when it is ahead of it by less than half the u16 range (wrapping). */
const HALF_SEQ = 0x8000;

/** The guest's end of `MSG.act`: numbers each act it sends, so the host can drop one it has already carried out. */
export class ActOutbox {
  private seq = 0;
  private readonly act = new Act();

  /** The next `MSG.act` for `kind` from `eye` along `dir` (unit), a shot's or a hook fire's with `name`, what its own ray first met (null: nothing); null when a value is not finite or out of range (nothing is sent, the number is not spent). */
  pack(kind: number, arg: number, eye: { x: number; y: number; z: number }, dir: { x: number; y: number; z: number }, name: Named | null = null): Uint8Array<ArrayBuffer> | null {
    const act = this.act;
    act.seq = this.seq;
    act.kind = kind;
    act.arg = arg;
    act.eyeX = eye.x;
    act.eyeY = eye.y;
    act.eyeZ = eye.z;
    act.dirX = dir.x;
    act.dirY = dir.y;
    act.dirZ = dir.z;
    const named = act.named;
    named.kind = name === null ? NAMED.nothing : name.kind;
    named.id = name === null ? 0 : name.id;
    named.x = name === null ? 0 : name.x;
    named.y = name === null ? 0 : name.y;
    named.z = name === null ? 0 : name.z;
    const data = packAct(act);
    if (data !== null) this.seq = (this.seq + 1) & 0xffff;
    return data;
  }
}

/** The host's end of `MSG.act`: reads an act, drops one whose number is not newer than the last from that peer (a replay), and hands the rest to the engine as its car's act. */
export class ActInbox {
  private readonly lastSeq = new Map<string, number>();
  private readonly act = new Act();

  /** `data` from `peer`, whose car is `car`: true when it was a new, well-formed act and was handed on. */
  take(peer: string, car: number, data: Uint8Array, hear: (actor: number, act: Act) => void): boolean {
    const act = this.act;
    if (!readAct(data, act)) return false;
    const last = this.lastSeq.get(peer);
    const ahead = last === undefined ? 1 : (act.seq - last) & 0xffff;
    if (ahead === 0 || ahead >= HALF_SEQ) return false;
    this.lastSeq.set(peer, act.seq);
    hear(car, act);
    return true;
  }

  /** Forget every peer's numbers (the room closed). */
  clear(): void {
    this.lastSeq.clear();
  }
}
