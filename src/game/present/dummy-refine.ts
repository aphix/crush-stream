/**
 * The baked bodies' shared mesh made finer where her bust is sculpted (`dummy-curves.ts` `sculptBust`): its 4.5 cm chest
 * triangles cannot hold a round dome, so the triangles over the bust are halved at their edges' midpoints (to 2.2 cm). Every
 * shape's surface stays where it was (the men's chests are the same planes, cut finer); the old vertices keep their indices.
 */

/** Her bust's centre on the baked woman (raw metres, T-pose, x mirrored): the most forward chest vertex. */
const BUST_RAW = [0.0857, 1.1915] as const;
/**
 * The region halved about it (raw metres): above and below it, toward the cleavage (past the midline, so both sides meet) and
 * out toward the armpit; front faces only. It holds the sculpt's footprint with 2 cm to spare for the blend into the chest.
 */
const REGION_ABOVE = 0.143;
const REGION_BELOW = 0.107;
const REGION_INNER = 0.147;
const REGION_OUTER = 0.085;
const FRONT_Z = 0.02;
/** Vertex indices are Uint16. */
const MAX_VERTICES = 65536;

const edgeKey = (a: number, b: number): number => (a < b ? a * MAX_VERTICES + b : b * MAX_VERTICES + a);

/** Whether triangle `t`'s centre on the woman's raw shape lies over her bust. */
function overBust(woman: Float32Array, index: Uint16Array, t: number): boolean {
  let [x, y, z] = [0, 0, 0];
  for (let k = 0; k < 3; k++) {
    const v = index[t * 3 + k]! * 3;
    [x, y, z] = [x + Math.abs(woman[v]!) / 3, y + woman[v + 1]! / 3, z + woman[v + 2]! / 3];
  }
  const across = (x - BUST_RAW[0]) / (x < BUST_RAW[0] ? REGION_INNER : REGION_OUTER);
  const up = (y - BUST_RAW[1]) / (y > BUST_RAW[1] ? REGION_ABOVE : REGION_BELOW);
  return z > FRONT_Z && across * across + up * up <= 1;
}

/**
 * `index` over `shapes` (one topology) with the triangles over her bust (found on her raw shape `woman`), and any left with two halved
 * edges, cut in four; a neighbour with one halved edge is cut in two, so no edge keeps a vertex in its middle. The midpoints
 * are appended to every shape.
 */
export function refineBust(index: Uint16Array, shapes: readonly Float32Array[], woman: Float32Array): { index: Uint16Array; shapes: Float32Array[] } {
  const triangles = index.length / 3;
  const edge = (t: number, e: number) => edgeKey(index[t * 3 + e]!, index[t * 3 + ((e + 1) % 3)]!);
  const cut = new Set<number>();
  const midpoints = new Map<number, number>();
  const quarter = (t: number) => {
    cut.add(t);
    for (let e = 0; e < 3; e++) midpoints.set(edge(t, e), -1);
  };
  for (let t = 0; t < triangles; t++) if (overBust(woman, index, t)) quarter(t);
  for (let grew = true; grew; ) {
    grew = false;
    for (let t = 0; t < triangles; t++) {
      if (cut.has(t) || [0, 1, 2].filter((e) => midpoints.has(edge(t, e))).length < 2) continue;
      quarter(t);
      grew = true;
    }
  }
  const vertices = shapes[0]!.length / 3;
  if (vertices + midpoints.size > MAX_VERTICES) throw new RangeError(`${vertices + midpoints.size} vertices do not fit a Uint16 index`);
  const grown = shapes.map((shape) => {
    const out = new Float32Array((vertices + midpoints.size) * 3);
    out.set(shape);
    return out;
  });
  let next = vertices;
  for (const key of midpoints.keys()) {
    const [a, b] = [Math.floor(key / MAX_VERTICES) * 3, (key % MAX_VERTICES) * 3];
    for (const [s, shape] of shapes.entries()) for (let k = 0; k < 3; k++) grown[s]![next * 3 + k] = (shape[a + k]! + shape[b + k]!) / 2;
    midpoints.set(key, next++);
  }
  const out: number[] = [];
  for (let t = 0; t < triangles; t++) {
    const [a, b, c] = [index[t * 3]!, index[t * 3 + 1]!, index[t * 3 + 2]!];
    const [ab, bc, ca] = [midpoints.get(edgeKey(a, b)), midpoints.get(edgeKey(b, c)), midpoints.get(edgeKey(c, a))];
    if (cut.has(t)) out.push(a, ab!, ca!, ab!, b, bc!, ca!, bc!, c, ab!, bc!, ca!);
    else if (ab !== undefined) out.push(a, ab, c, ab, b, c);
    else if (bc !== undefined) out.push(b, bc, a, bc, c, a);
    else if (ca !== undefined) out.push(c, ca, b, ca, a, b);
    else out.push(a, b, c);
  }
  return { index: Uint16Array.from(out), shapes: grown };
}
