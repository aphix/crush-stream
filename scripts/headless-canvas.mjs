/** The page's `document.createElement("canvas")` in node: a Skia canvas (`createCanvas` of `@napi-rs/canvas`) with the DOM's bits three and the engine touch. */
export function makeCanvasElement(createCanvas) {
  // `data: undefined`: Skia's canvas has a `data()` method, so headless GL takes the canvas for an ImageData and uploads zeros (black).
  return Object.assign(createCanvas(1, 1), { data: undefined, style: {}, addEventListener() {}, removeEventListener() {}, setAttribute() {} });
}
