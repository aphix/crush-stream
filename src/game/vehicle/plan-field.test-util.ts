import { hypot2 } from "../kernel/physics-core.js";

/** Covered-node masks for a cage of `nu` by `nv` nodes: the degenerate ones, car-like outlines and random ones, seeded. */
export function masksOf(nu: number, nv: number, step: number): { text: string; covered: Uint8Array }[] {
  const n = nu * nv;
  const masks: { text: string; covered: Uint8Array }[] = [
    { text: "empty", covered: new Uint8Array(n) },
    { text: "full", covered: new Uint8Array(n).fill(1) },
  ];
  const single = new Uint8Array(n);
  single[Math.floor(nv / 2) * nu + Math.floor(nu / 2)] = 1;
  masks.push({ text: "one node", covered: single });
  const hole = new Uint8Array(n).fill(1);
  hole[Math.floor(nv / 2) * nu + Math.floor(nu / 2)] = 0;
  masks.push({ text: "one hole", covered: hole });
  const corner = new Uint8Array(n);
  corner[n - 1] = 1;
  masks.push({ text: "last node", covered: corner });
  const column = new Uint8Array(n);
  for (let j = 0; j < nv; j++) column[j * nu + 3] = 1;
  masks.push({ text: "one column", covered: column });
  const rows = new Uint8Array(n);
  for (let j = 0; j < nv; j += 7) for (let i = 0; i < nu; i++) rows[j * nu + i] = 1;
  masks.push({ text: "every seventh row", covered: rows });
  const ends = new Uint8Array(n);
  for (let i = 0; i < nu; i++) {
    ends[i] = 1;
    ends[(nv - 1) * nu + i] = 1;
  }
  masks.push({ text: "first and last row", covered: ends });
  for (let seed = 1; seed <= 60; seed++) {
    let r = seed;
    const rnd = (): number => (r = (r * 1103515245 + 12345) >>> 0) / 4294967296;
    const covered = new Uint8Array(n);
    const hx = 0.7 + 0.25 * rnd();
    const hz = 1.8 + 0.35 * rnd();
    const cr = 0.1 + 0.3 * rnd();
    const notch = 0.6 * rnd() * 0.5;
    const notchWidth = 0.2 * rnd();
    for (let j = 0; j < nv; j++) {
      for (let i = 0; i < nu; i++) {
        const x = (i - (nu - 1) / 2) * step;
        const zz = (j - (nv - 1) / 2) * step;
        const qx = Math.max(0, Math.abs(x) - (hx - cr));
        const qz = Math.max(0, Math.abs(zz) - (hz - cr));
        if (hypot2(qx, qz) <= cr && !(zz > hz - notch && Math.abs(x) < notchWidth)) covered[j * nu + i] = 1;
      }
    }
    masks.push({ text: `car-like ${seed}`, covered });
  }
  for (let seed = 1; seed <= 40; seed++) {
    let r = seed * 7919;
    const p = (seed % 10) / 10;
    const covered = new Uint8Array(n);
    for (let k = 0; k < n; k++) covered[k] = (r = (r * 1103515245 + 12345) >>> 0) / 4294967296 < p ? 1 : 0;
    masks.push({ text: `random ${seed} at ${p}`, covered });
  }
  return masks;
}
