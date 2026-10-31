/** Headless WebGL2 (`@kmamal/gl`, ANGLE on the host's GL), as headless-frame, the tracing harness and the GL rows load it. */
import { existsSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

/** Why `createGL` answered null: ANGLE opens an X display even headless (its log says "Could not open the default X display"). */
export const NO_CONTEXT = "headless GL made no WebGL2 context: ANGLE found no X display. Set DISPLAY (e.g. DISPLAY=:0 where /tmp/.X11-unix/X0 exists, as WSLg has) or run where it has one";

/** `@kmamal/gl`'s context factory; throws the one-line fetch command while its native binary is missing (installs never run its download). */
export async function loadHeadlessGl() {
  // WSL: Mesa's d3d12 driver reaches the host GPU through /dev/dxg; without it Mesa draws on the CPU. Elsewhere Mesa has no d3d12 driver.
  if (existsSync("/dev/dxg")) process.env.GALLIUM_DRIVER ??= "d3d12";
  const glDir = dirname(fileURLToPath(import.meta.resolve("@kmamal/gl")));
  if (!existsSync(join(glDir, "dist/webgl.node"))) throw new Error(`@kmamal/gl has no native binary (installs never run its GitHub download). Fetch it once: node ${join(glDir, "scripts/install.mjs")}`);
  return (await import("@kmamal/gl")).default;
}
