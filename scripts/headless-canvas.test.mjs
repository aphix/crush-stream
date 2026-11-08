import { describe, expect, it } from "vitest";
import { makeCanvasElement } from "./headless-canvas.mjs";
import { loadHeadlessGl, NO_CONTEXT } from "./headless-gl.mjs";

const COLOUR = [200, 120, 40, 255];
/** Referenced for the file's life: @kmamal/gl aborts the process when the garbage collector frees a context. */
let context;

describe("given headless-frame's canvas stand-in painted one colour and uploaded as a texture on headless GL", () => {
  it("when the texture is read back through a framebuffer, then it holds that colour, not the zeros headless GL uploads for a canvas it takes for an ImageData", async () => {
    const createGL = await loadHeadlessGl();
    const { createCanvas } = await import("@napi-rs/canvas");
    context = createGL(4, 4, { createWebGL2Context: true, antialias: false, alpha: false });
    if (context === null) throw new Error(`headless-canvas: ${NO_CONTEXT}`);
    const gl = context;
    const canvas = makeCanvasElement(createCanvas);
    Object.assign(canvas, { width: 4, height: 4 });
    const paint = canvas.getContext("2d");
    paint.fillStyle = `rgb(${COLOUR.slice(0, 3).join(",")})`;
    paint.fillRect(0, 0, 4, 4);
    const texture = gl.createTexture();
    gl.bindTexture(gl.TEXTURE_2D, texture);
    gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, canvas);
    gl.bindFramebuffer(gl.FRAMEBUFFER, gl.createFramebuffer());
    gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, texture, 0);
    const pixel = new Uint8Array(4);
    gl.readPixels(0, 0, 1, 1, gl.RGBA, gl.UNSIGNED_BYTE, pixel);
    expect([...pixel], "the texture's first texel, RGBA").toEqual(COLOUR);
  });
});
