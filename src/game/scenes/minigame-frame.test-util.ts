import type { HighJumpFrame, MinigameGround } from "./minigame-ground.ts";

/** The floats one box takes in the frame's mesh: 8 corners of 3. */
export const FRAME_BOX_FLOATS = 24;

/** How many boxes the frame's mesh holds: the two posts and one slat per board. */
export function frameBoxCount(frame: HighJumpFrame): number {
  return 2 + frame.boards.length;
}

/** The High jump's frame as `ground` holds it (`MinigameGround.addHighJumpFrame`): one mesh of the posts, then the slats, a box each. */
export function frameMeshOf(ground: MinigameGround, frame: HighJumpFrame): { vertices: Float32Array; indices: Uint32Array } {
  const mesh = ground.meshes.find((candidate) => candidate.vertices.length === frameBoxCount(frame) * FRAME_BOX_FLOATS);
  if (!mesh) throw new Error("the frame's mesh is not among the ground's");
  return mesh;
}

/** `ground` with the frame taken out: the control a row about the posts and slats must make a difference against. */
export function withoutFrame(ground: MinigameGround, frame: HighJumpFrame): MinigameGround {
  ground.meshes.splice(ground.meshes.indexOf(frameMeshOf(ground, frame)), 1);
  return ground;
}
