import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { GlErrors } from "./gl-errors.ts";

const INVALID_OPERATION = 0x0502;
const INVALID_VALUE = 0x0501;

/** A context whose error flags are `pending` (each read once, then NO_ERROR, or `stuck` forever); `reads` counts the `getError` calls. */
function context(stuck = false) {
  const gl = { NO_ERROR: 0 as const, pending: [] as number[], reads: 0, getError: () => (gl.reads++, stuck ? INVALID_OPERATION : (gl.pending.shift() ?? 0)) };
  return gl;
}

describe("given the WebGL error count a submission carries", () => {
  it("when two flags were set before a read, then both are counted and the newest is kept, and the next read finds none", () => {
    const gl = context();
    const errors = new GlErrors();
    gl.pending.push(INVALID_VALUE, INVALID_OPERATION);
    errors.read(gl);
    assert.equal(errors.count, 2);
    assert.equal(errors.last, INVALID_OPERATION);
    errors.read(gl);
    assert.equal(errors.count, 2);
  });

  it("when a context answers an error on every call, then a read stops at the six WebGL error kinds instead of looping", () => {
    const gl = context(true);
    new GlErrors().read(gl);
    assert.equal(gl.reads, 6);
  });
});
