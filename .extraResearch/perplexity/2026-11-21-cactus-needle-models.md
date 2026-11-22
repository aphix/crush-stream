> Question: Cactus Compute publishes small 'Needle' models. What are Needle 2 and Needle 3 (parameter counts, file sizes, quantisation, licences, what tasks they are trained for, published accuracy), and which runtimes exist to run them inside a web browser or Web Worker (WebAssembly, WebGPU, npm packages)? Cite the official repositories, model cards and package pages.

Cactus’s official pages identify **Needle 2** as a 45M-parameter tool-calling model and **Needle 3** as a newer 121M-parameter model. Both accept a natural-language request plus tool schemas and emit structured JSON function calls; Needle 2 is also described for device use and structured extraction.[10][8]

## Model comparison

| | Needle 2 | Needle 3 |
|---|---:|---:|
| Parameters | 45M[10] | 121M[8] |
| Published model file | `needle2.cact`[10] | `needle3.cact`[8] |
| File size | 13.7 MB in the browser/WASM runtime’s model listing[5] | 35.3 MB in the browser/WASM runtime’s model listing[5] |
| Quantisation/container | Cactus’s single-file `.cact` deployment format; the official Hugging Face page exposes the `.cact` model and source checkpoints[10] | Same `.cact` deployment format; the official page exposes `needle3.cact` and full SafeTensors checkpoints[8] |
| Licence | The available official-page extract does not state the licence; verify the `LICENSE`/model-card metadata in the corresponding Cactus repository before redistribution | Same qualification: the available official-page extract does not state the licence |
| Training/use task | Tool calling, device use and structured extraction[10] | Tool calling; the published description focuses on mapping a query and tool list to a JSON function call[3] |
| Published accuracy | No numerical accuracy result appears in the retrieved official model-page extract | No numerical accuracy result appears in the retrieved official model-page extract |

The `.cact` files are deployment artifacts rather than ordinary raw checkpoints: the browser runtime describes each as carrying the model geometry and tokenizer in one file.[5] The official Needle 3 page separately lists SafeTensors checkpoints, which are useful for conversion or inspection but are not the compact browser artifact.[8]

## Browser and Web Worker runtimes

- **Official Cactus runtime:** The official `cactus-compute/needle` repository advertises a WebAssembly build for browser and Node.js use, with `needle.js` and `needle.wasm` for the browser/Node target.[2][10]
- **`cactus-needle` npm package:** A community JavaScript package runs Needle in browsers and Node.js using CPU WebAssembly workers; the documented browser import is `cactus-needle/browser`.[6][7]
- **`needle-rs` npm/WASM package:** A community Rust/WebAssembly runtime supports both generations through `NeedleV2Wasm` and `NeedleV3Wasm`; its package documentation specifies `npm install needle-rs`, browser/Node.js execution, and Cloudflare Workers support.[3][5]
- **WebGPU:** A community ONNX conversion/demo runs Needle 3 in-browser with `onnxruntime-web` on WebGPU, with a WebAssembly CPU fallback. This is not presented as Cactus’s official runtime or model artifact; it uses a separate ONNX repository.[4]

In practical terms, the directly documented options are **CPU WebAssembly in a Web Worker** (`cactus-needle`, or `needle-rs`) and a **community WebGPU ONNX port** for Needle 3. The retrieved official material does not establish an official Cactus WebGPU runtime.

[1] needle-rs/docs/hf-model-card.md at main · Geekgineer/needle ... (https://github.com/Geekgineer/needle-rs/blob/main/docs/hf-model-card.md)
[2] github.com · cactus-compute · needleGitHub - cactus-compute/needle at runtimewire (https://github.com/cactus-compute/needle?ref=runtimewire)
[3] Geekgineer/needle-rs: 600 KB WASM runtime for Cactus Compute's ... (https://github.com/geekgineer/needle-rs)
[4] README.md · mrfakename/needle3-webgpu at main (https://huggingface.co/spaces/mrfakename/needle3-webgpu/blob/main/README.md)
[5] needle-rs/crates/needle-wasm/README.md at main - GitHub (https://github.com/Geekgineer/needle-rs/blob/main/crates/needle-wasm/README.md)
[6] cactus-needle/docs/usage.md at main (https://github.com/afshinm/cactus-needle/blob/main/docs/usage.md)
[7] afshinm/cactus-needle: Run Needle 3 locally in a browser or Node.js for tool ... (https://github.com/afshinm/cactus-needle)
[8] Cactus-Compute/needle3 · Hugging Face (https://huggingface.co/Cactus-Compute/needle3)
[9] Needle: A Tiny Tool-Calling Model for Home Assistant, Measured - Big Iron (https://www.bigiron.cc/guides/needle-2-a-tiny-tool-calling-model-for-home-assistant-measured)
[10] Cactus-Compute/needle2 · Hugging Face (https://huggingface.co/Cactus-Compute/needle2)
