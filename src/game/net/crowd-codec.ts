import { MSG } from "./codec.ts";
import { CROWD_EVENT_LOG_MAX } from "./net-constants.ts";

/** Numbers per event in the in-memory form: kind, subject, time. */
export const CROWD_EVENT_FIELDS = 3;

/** What a `MSG.crowd` carries: the crowd's seed, the host's wall clock when it sent and its crowd clock then, and its event log. */
interface CrowdState {
  seed: number;
  hostTime: number;
  crowdTime: number;
  events: Float64Array;
}

/** Type byte, seed (u32), host time (f64), crowd time (f64), event count (u16). */
const HEADER_BYTES = 1 + 4 + 8 + 8 + 2;
/** Kind (u8), subject (u16), time (f64). */
const EVENT_BYTES = 1 + 2 + 8;
/** Byte offsets of each field: in the header, then in one event. */
const SEED_AT = 1;
const HOST_TIME_AT = 5;
const CROWD_TIME_AT = 13;
const COUNT_AT = 21;
const EVENT_SUBJECT_AT = 1;
const EVENT_TIME_AT = 3;

/** The newest `CROWD_EVENT_LOG_MAX` events of `events` (kind, subject, time triples), after the clocks. */
export function packCrowd(seed: number, hostTime: number, crowdTime: number, events: Float64Array): Uint8Array<ArrayBuffer> {
  const count = Math.min(Math.floor(events.length / CROWD_EVENT_FIELDS), CROWD_EVENT_LOG_MAX);
  const out = new Uint8Array(HEADER_BYTES + count * EVENT_BYTES);
  const view = new DataView(out.buffer);
  out[0] = MSG.crowd;
  view.setUint32(SEED_AT, seed >>> 0, true);
  view.setFloat64(HOST_TIME_AT, hostTime, true);
  view.setFloat64(CROWD_TIME_AT, crowdTime, true);
  view.setUint16(COUNT_AT, count, true);
  let offset = HEADER_BYTES;
  for (let from = events.length - count * CROWD_EVENT_FIELDS; from < events.length; from += CROWD_EVENT_FIELDS) {
    view.setUint8(offset, events[from]!);
    view.setUint16(offset + EVENT_SUBJECT_AT, events[from + 1]!, true);
    view.setFloat64(offset + EVENT_TIME_AT, events[from + 2]!, true);
    offset += EVENT_BYTES;
  }
  return out;
}

/** A `MSG.crowd` message; null when it is not one this build reads (untrusted: a peer's), so a bad length, count or clock is dropped whole. */
export function readCrowd(data: Uint8Array): CrowdState | null {
  if (data.length < HEADER_BYTES || data[0] !== MSG.crowd) return null;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const count = view.getUint16(COUNT_AT, true);
  if (count > CROWD_EVENT_LOG_MAX || data.length !== HEADER_BYTES + count * EVENT_BYTES) return null;
  const hostTime = view.getFloat64(HOST_TIME_AT, true);
  const crowdTime = view.getFloat64(CROWD_TIME_AT, true);
  if (!Number.isFinite(hostTime) || !Number.isFinite(crowdTime)) return null;
  const events = new Float64Array(count * CROWD_EVENT_FIELDS);
  let offset = HEADER_BYTES;
  for (let to = 0; to < events.length; to += CROWD_EVENT_FIELDS) {
    const time = view.getFloat64(offset + EVENT_TIME_AT, true);
    if (!Number.isFinite(time)) return null;
    events[to] = view.getUint8(offset);
    events[to + 1] = view.getUint16(offset + EVENT_SUBJECT_AT, true);
    events[to + 2] = time;
    offset += EVENT_BYTES;
  }
  return { seed: view.getUint32(SEED_AT, true), hostTime, crowdTime, events };
}
