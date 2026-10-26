import * as THREE from "three";

/** Every buffer attribute `root` draws from: geometry attributes, its index, an instanced mesh's matrices and colours. */
export function attributesOf(root: THREE.Object3D): { name: string; attr: THREE.BufferAttribute }[] {
  const out: { name: string; attr: THREE.BufferAttribute }[] = [];
  root.traverse((o) => {
    const geo = "geometry" in o && o.geometry instanceof THREE.BufferGeometry ? o.geometry : null;
    if (geo) {
      for (const [name, attr] of Object.entries(geo.attributes)) if (attr instanceof THREE.BufferAttribute) out.push({ name: `${o.type}.${name}`, attr });
      if (geo.index) out.push({ name: `${o.type}.index`, attr: geo.index });
    }
    if (o instanceof THREE.InstancedMesh) {
      out.push({ name: "instanceMatrix", attr: o.instanceMatrix });
      if (o.instanceColor) out.push({ name: "instanceColor", attr: o.instanceColor });
    }
  });
  return out;
}

/** What three does with a drawn frame's queued uploads: sends them, then clears them. */
export function drawQueued(root: THREE.Object3D): void {
  for (const { attr } of attributesOf(root)) attr.clearUpdateRanges();
}
