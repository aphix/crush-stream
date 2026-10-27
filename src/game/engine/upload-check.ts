import * as THREE from "three";

/** `?debug=uploads` on the page's query: the upload check runs for the session (nothing is wrapped without it). */
export function uploadCheckAsked(search: string): boolean {
  return new URLSearchParams(search).get("debug") === "uploads";
}

/** What a report names besides the call: the scene the uploaded array belongs to and the FX tier at the time. */
type UploadScene = () => { scene: THREE.Object3D; tier: string };

type UploadSource = AllowSharedBufferSource | ArrayBufferView;

/** A view's element size; a `DataView` counts bytes. */
function elementBytes(view: ArrayBufferView): number {
  const size: unknown = Reflect.get(view, "BYTES_PER_ELEMENT");
  return typeof size === "number" ? size : 1;
}

function bufferDataBytes(data: GLsizeiptr | UploadSource | null, srcOffset: number, length: number): number {
  if (typeof data === "number") return data;
  if (data === null) return 0;
  if (!ArrayBuffer.isView(data)) return data.byteLength;
  const bytes = elementBytes(data);
  return length > 0 ? length * bytes : data.byteLength - srcOffset * bytes;
}

/** Why a `bufferSubData` would be refused (the browser's "Invalid sub-length" and its kin), or null; `size` is unknown for a buffer filled before the check. */
function bufferSubFault(size: number | undefined, dstOffset: number, data: UploadSource, srcOffset: number, length: number): string | null {
  let bytes = data.byteLength;
  if (ArrayBuffer.isView(data)) {
    const count = data.byteLength / elementBytes(data);
    const n = length === 0 ? count - srcOffset : length;
    if (srcOffset > count || srcOffset + n > count) return `srcOffset ${srcOffset} + length ${n} past the view's ${count} elements`;
    bytes = n * elementBytes(data);
  }
  if (dstOffset < 0) return `offset ${dstOffset} below 0`;
  if (size !== undefined && dstOffset + bytes > size) return `${bytes} bytes at offset ${dstOffset} past the buffer's ${size}`;
  return null;
}

interface Unpack {
  rowLength: number;
  skipPixels: number;
  skipRows: number;
  alignment: number;
}

/** Bytes a pixel takes for a format and type pair (null for a pair this check does not size), the tables built once per context. */
function pixelBytesOf(gl: WebGL2RenderingContext): (format: GLenum, type: GLenum) => number | null {
  const packed = new Map<GLenum, number>([
    [gl.UNSIGNED_SHORT_5_6_5, 2],
    [gl.UNSIGNED_SHORT_4_4_4_4, 2],
    [gl.UNSIGNED_SHORT_5_5_5_1, 2],
    [gl.UNSIGNED_INT_2_10_10_10_REV, 4],
    [gl.UNSIGNED_INT_10F_11F_11F_REV, 4],
    [gl.UNSIGNED_INT_5_9_9_9_REV, 4],
    [gl.UNSIGNED_INT_24_8, 4],
  ]);
  const channels = new Map<GLenum, number>([
    [gl.RGBA, 4],
    [gl.RGBA_INTEGER, 4],
    [gl.RGB, 3],
    [gl.RGB_INTEGER, 3],
    [gl.RG, 2],
    [gl.RG_INTEGER, 2],
    [gl.LUMINANCE_ALPHA, 2],
    [gl.RED, 1],
    [gl.RED_INTEGER, 1],
    [gl.ALPHA, 1],
    [gl.LUMINANCE, 1],
    [gl.DEPTH_COMPONENT, 1],
  ]);
  const typeBytes = new Map<GLenum, number>([
    [gl.UNSIGNED_BYTE, 1],
    [gl.BYTE, 1],
    [gl.UNSIGNED_SHORT, 2],
    [gl.SHORT, 2],
    [gl.HALF_FLOAT, 2],
    [gl.UNSIGNED_INT, 4],
    [gl.INT, 4],
    [gl.FLOAT, 4],
  ]);
  return (format, type) => {
    const whole = packed.get(type);
    if (whole !== undefined) return whole;
    const n = channels.get(format);
    const bytes = typeBytes.get(type);
    return n === undefined || bytes === undefined ? null : n * bytes;
  };
}

/** Why a `texSubImage2D` from a view would read past it, or null; the rows are laid out as the unpack state says (row length, skips, alignment). */
function texSubFault(pixel: number | null, width: number, height: number, data: ArrayBufferView, srcOffset: number, unpack: Unpack): string | null {
  if (pixel === null || width === 0 || height === 0) return null;
  const rowBytes = Math.ceil(((unpack.rowLength || width) * pixel) / unpack.alignment) * unpack.alignment;
  const need = srcOffset * elementBytes(data) + (unpack.skipRows + height - 1) * rowBytes + (unpack.skipPixels + width) * pixel;
  return need > data.byteLength ? `${width}x${height} at srcOffset ${srcOffset} needs ${need} bytes of the view's ${data.byteLength}` : null;
}

function objectLabel(o: THREE.Object3D): string {
  const data = Object.keys(o.userData).length > 0 ? ` ${JSON.stringify(o.userData)}` : "";
  return `${o.type} "${o.name}"${data}${o.parent ? ` in ${o.parent.type} "${o.parent.name}"` : ""}`;
}

function attributeOwner(o: THREE.Object3D, geometry: THREE.BufferGeometry, data: unknown): string | null {
  const named: [string, THREE.BufferAttribute | THREE.InterleavedBufferAttribute | null][] = [...Object.entries(geometry.attributes), ["index", geometry.index]];
  for (const [name, attr] of named) {
    const array = attr instanceof THREE.InterleavedBufferAttribute ? attr.data.array : attr?.array;
    if (attr && array === data) return `attribute "${name}" (${attr.count} x ${attr.itemSize}) of geometry "${geometry.name}" ${geometry.uuid} on ${objectLabel(o)}`;
  }
  return null;
}

function textureOwner(o: THREE.Object3D, material: THREE.Material, data: unknown): string | null {
  const values: unknown[] = Object.values(material);
  if (material instanceof THREE.ShaderMaterial) for (const u of Object.values(material.uniforms)) values.push(u.value);
  for (const t of values) {
    if (t instanceof THREE.Texture && t.image?.data === data) return `texture "${t.name}" ${t.uuid} of material "${material.name}" (${material.type}) on ${objectLabel(o)}`;
  }
  return null;
}

/** The three.js object an uploaded array belongs to, found by walking the scene: a report's cost, never a call's. */
function ownerOf(scene: THREE.Object3D, data: unknown): string {
  let owner: string | null = null;
  scene.traverse((o) => {
    if (owner !== null || !("geometry" in o) || !(o.geometry instanceof THREE.BufferGeometry)) return;
    owner = attributeOwner(o, o.geometry, data);
    const materials: unknown[] = "material" in o ? [o.material].flat() : [];
    for (const m of materials) if (owner === null && m instanceof THREE.Material) owner = textureOwner(o, m, data);
  });
  return owner ?? "no owner in the scene (a post pass or a target, not a scene object)";
}

/**
 * Wraps `gl`'s buffer and texture sub-uploads with a range check and logs the first refused one once (`console.error`): its owner, the
 * sizes, the range, the FX tier and the stack. The owner's Firefox warned "Invalid sub-length" in live play where no other run showed it.
 */
export function checkUploads(gl: WebGL2RenderingContext, at: UploadScene): void {
  const sizes = new WeakMap<WebGLBuffer, number>();
  const bound = new Map<GLenum, WebGLBuffer | null>();
  const unpack: Unpack = { rowLength: 0, skipPixels: 0, skipRows: 0, alignment: 4 };
  let reported = false;
  const report = (call: string, fault: string, data: unknown, range: Record<string, number>): void => {
    if (reported) return;
    reported = true;
    const { scene, tier } = at();
    console.error(`Crush upload check: ${call} refused: ${fault}`, { owner: ownerOf(scene, data), ...range, tier, stack: new Error(call).stack });
  };
  wrapBuffers(gl, sizes, bound, report);
  wrapTextures(gl, unpack, report);
}

type Report = (call: string, fault: string, data: unknown, range: Record<string, number>) => void;

function wrapBuffers(gl: WebGL2RenderingContext, sizes: WeakMap<WebGLBuffer, number>, bound: Map<GLenum, WebGLBuffer | null>, report: Report): void {
  const { bindBuffer, bindVertexArray, bufferData, bufferSubData } = gl;
  gl.bindBuffer = (...args: Parameters<typeof bindBuffer>) => {
    bound.set(args[0], args[1]);
    Reflect.apply(bindBuffer, gl, args);
  };
  // A vertex array carries its own element buffer: the one bound before it says nothing about the one bound now.
  gl.bindVertexArray = (...args: Parameters<typeof bindVertexArray>) => {
    bound.delete(gl.ELEMENT_ARRAY_BUFFER);
    Reflect.apply(bindVertexArray, gl, args);
  };
  gl.bufferData = (target: GLenum, data: GLsizeiptr | UploadSource | null, usage: GLenum, srcOffset: number = 0, length: number = 0) => {
    const buffer = bound.get(target);
    if (buffer) sizes.set(buffer, bufferDataBytes(data, srcOffset, length));
    Reflect.apply(bufferData, gl, [target, data, usage, srcOffset, length].slice(0, ArrayBuffer.isView(data) ? 5 : 3));
  };
  gl.bufferSubData = (target: GLenum, dstOffset: GLintptr, data: UploadSource, srcOffset: number = 0, length: number = 0) => {
    const buffer = bound.get(target);
    const size = buffer ? sizes.get(buffer) : undefined;
    const fault = bufferSubFault(size, dstOffset, data, srcOffset, length);
    if (fault !== null) report("bufferSubData", fault, data, { bufferBytes: size ?? -1, dstOffset, srcOffset, length, viewBytes: data.byteLength });
    Reflect.apply(bufferSubData, gl, ArrayBuffer.isView(data) ? [target, dstOffset, data, srcOffset, length] : [target, dstOffset, data]);
  };
}

function wrapTextures(gl: WebGL2RenderingContext, unpack: Unpack, report: Report): void {
  const { pixelStorei, texSubImage2D } = gl;
  const pixelBytes = pixelBytesOf(gl);
  const unpackKey = new Map<GLenum, keyof Unpack>([
    [gl.UNPACK_ROW_LENGTH, "rowLength"],
    [gl.UNPACK_SKIP_PIXELS, "skipPixels"],
    [gl.UNPACK_SKIP_ROWS, "skipRows"],
    [gl.UNPACK_ALIGNMENT, "alignment"],
  ]);
  gl.pixelStorei = (...args: Parameters<typeof pixelStorei>) => {
    const key = unpackKey.get(args[0]);
    if (key !== undefined && typeof args[1] === "number") unpack[key] = args[1];
    Reflect.apply(pixelStorei, gl, args);
  };
  gl.texSubImage2D = (...args: unknown[]) => {
    const [, level, x, y, width, height, format, type, data, srcOffset = 0] = args;
    if (ArrayBuffer.isView(data) && typeof width === "number" && typeof height === "number" && typeof format === "number" && typeof type === "number" && typeof srcOffset === "number") {
      const fault = texSubFault(pixelBytes(format, type), width, height, data, srcOffset, unpack);
      if (fault !== null) report("texSubImage2D", fault, data, { level: Number(level), x: Number(x), y: Number(y), width, height, srcOffset, viewBytes: data.byteLength, ...unpack });
    }
    Reflect.apply(texSubImage2D, gl, args);
  };
}
