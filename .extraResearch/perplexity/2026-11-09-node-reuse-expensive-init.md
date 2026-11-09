> Question: In Node.js 24, what mechanisms exist for reusing the results of expensive initialization work, such as building large in-memory data structures or compiling WebAssembly modules, across separate worker threads or processes? What are their documented limits? Cite the Node.js documentation.

Node.js 24 provides several distinct mechanisms, but they differ substantially between **worker threads** and **separate processes**:

| Mechanism | What can be reused | Scope and documented limits |
|---|---|---|
| **`worker_threads` structured cloning** | Objects sent through `worker.postMessage()` | Values are cloned, not shared. Large data structures are therefore copied into the worker, so this avoids recomputation but not memory duplication. `ArrayBuffer`s can instead be transferred, which moves ownership and makes the original buffer unusable; `SharedArrayBuffer`s can be shared without copying, but the data must be represented in shared memory and synchronized explicitly. |
| **`SharedArrayBuffer`** | Large binary datasets, typed arrays, indexes, and other explicitly shared data | Sharing is limited to memory backed by `SharedArrayBuffer`; ordinary JavaScript objects, `Map`s, class instances, and object graphs are not jointly shared. Each worker still has its own V8 isolate and JavaScript heap. Node reports `ArrayBuffer` and `SharedArrayBuffer` memory separately as `arrayBuffers`, which is also included in `external` memory accounting.[2] |
| **Worker startup snapshots** | Preinitialized JavaScript heap state | A V8 startup snapshot can serialize initialized state for workers created from a worker script. This can substantially reduce repeated initialization, but snapshot-compatible values are required: external resources, native handles, and other non-serializable runtime state cannot simply be captured. The snapshot is an initialization image, not a live heap shared between workers. |
| **V8 code cache / Node compile cache** | Compiled JavaScript code | Code caching can reduce parsing and compilation work, but it does not preserve the resulting mutable objects or application data structures. It is therefore useful for startup cost, not as a general-purpose object cache. |
| **WebAssembly module transfer** | A compiled `WebAssembly.Module` | A compiled WebAssembly module can be sent between workers using structured cloning. Workers receive a reusable compiled module rather than recompiling the original bytes, subject to the module being cloneable and supported by the relevant runtime. This shares the compiled artifact conceptually, but each worker still instantiates its own `WebAssembly.Instance` and linear memory unless memory is deliberately shared. |
| **Filesystem or external cache** | Serialized data, Wasm bytes, or application-specific artifacts | Separate processes cannot share ordinary JavaScript heap objects. They must reload or deserialize data, use an IPC/shared-memory mechanism, or rely on an external store. Node’s startup-snapshot support can package initialized state into a single executable, but that snapshot is created at build time and deserialized independently by each launched process.[1] |

## Separate processes

A normal `child_process`, `cluster` worker, or independently launched Node process has a separate V8 isolate and heap. Consequently, a large in-memory object graph created by one process cannot be directly reused by another. IPC transfers data by serialization or transfer mechanisms; operating-system shared memory, memory-mapped files, databases, or an external cache are needed for genuinely shared data.

Node’s **single-executable startup snapshot** is the closest built-in mechanism for avoiding repeated initialization across process launches. With `useSnapshot`, Node runs the main script while preparing the executable, captures the initialized heap, and deserializes that snapshot when the executable starts.[1] The documented constraint is that the application must register a deserialization main function with `v8.startupSnapshot.setDeserializeMainFunction()`, because the normal `main` script is not executed in the launched executable; initialization occurs during preparation instead.[1]

The snapshot does **not** make process heaps shared: every process gets its own deserialized copy, and runtime resources that cannot be serialized must be recreated after deserialization. It is therefore best for immutable or mostly immutable startup state, not for a live cross-process cache.

## Practical choice

- For **workers**, use `SharedArrayBuffer` for large shared binary state, transfer `WebAssembly.Module` objects where supported, and use a startup snapshot when the initialization state is snapshot-compatible.
- For **processes**, use a memory-mapped file, OS shared memory, or an external cache for truly shared data.
- Use **startup snapshots or code caches** when the goal is faster startup, understanding that they provide independent per-process/per-isolate state rather than a shared mutable heap.
- Do not expect Node’s module cache, V8 code cache, or a startup snapshot to share ordinary live JavaScript objects across independently running processes.

[1] Single executable applications | Node.js v24.21.0 Documentation (https://r2.nodejs.org/docs/latest-v24.x/api/single-executable-applications.html)
[2] Process | Node.js v24.22.0 Documentation (https://r2.nodejs.org/docs/latest-v24.x/api/process.html)
[3] r2.nodejs.org · docs · latest-v24About this documentation | Node.js v24.18.0 Documentation (https://r2.nodejs.org/docs/latest-v24.x/api/documentation.html)
[4] Node.js v24.22.2 documentation (https://r2.nodejs.org/docs/latest-v24.x/api/perf_hooks.html)
[5] Index | Node.js v24.18.0 Documentation - r2.nodejs.org (https://r2.nodejs.org/docs/latest-v24.x/api/index.html)
[6] File system | Node.js v24.22.0 Documentation (https://r2.nodejs.org/docs/latest-v24.x/api/fs.html)
[7] Modules: TypeScript | Node.js v24.22.1 Documentation (https://r2.nodejs.org/docs/latest-v24.x/api/typescript.html)
