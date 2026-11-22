> Question: What has been measured about running small neural language or tool-calling models (roughly 20 to 500 million parameters) inside mobile phone browsers through WebAssembly or WebGPU: load time, memory, tokens per second or latency per call, battery or thermal effects, and impact on a concurrently running 3D WebGL page? Cite benchmarks and sources.

Published, reproducible measurements for **20–500M-parameter models on actual phones** are still sparse. The strongest evidence is a mixture of browser benchmarks, framework papers, and engineering reports; battery, thermal behavior, and interference with a concurrently running WebGL scene are especially under-measured.

## What has been measured

| Metric | Measured result | Evidence and caveats |
|---|---:|---|
| **Decode speed: WebGPU** | **SmolLM2 360M: 62.9 tokens/s median** | A browser test reported 62.9 tokens/s for SmolLM2 360M using WebGPU, versus 1.6 tokens/s with WebAssembly.[1] The result is useful as an order-of-magnitude comparison, but the cited test is not a controlled cross-phone study and is dated in the search record after the current date, so it should not be treated as an independently validated mobile benchmark. |
| **Decode speed: WASM** | **SmolLM2 360M: 1.6 tokens/s** | Same benchmark as above.[1] This illustrates the usual large gap between GPU-backed WebGPU inference and CPU/WASM inference, but actual results depend heavily on SIMD, threads, quantization, browser, and device. |
| **General WebGPU browser throughput** | Roughly **25–60 tokens/s** is reported for some browser deployments | An engineering case study gives this range for WebLLM-style inference, but it does not provide a sufficiently controlled phone-by-phone benchmark table.[6] |
| **Mobile WebGPU example** | **18 tokens/s** for a quantized 8B model on an iPhone 15 Pro | This is far above the requested parameter range and therefore mainly indicates the scale of possible mobile performance; the source reports 350 ms first-token latency and 4.8 GB of VRAM for that configuration.[7] It should not be extrapolated directly to 20–500M models. |
| **Memory efficiency** | LlamaWeb reports **29–33% lower memory** than comparison browser runtimes | The LlamaWeb paper compares browser inference frameworks across multiple devices and reports 29–33% lower memory usage, with 45–69% higher decode throughput in its tested configurations.[2] Its headline experiments are not specifically a mobile-phone study of 20–500M models, but they are relevant to runtime design and peak-memory behavior. |
| **Smaller-model memory** | A 360M model’s quantized weights are typically only hundreds of MB, but runtime memory is larger | The available results do not provide a reliable, standardized peak-RAM table for 20–500M models on iOS and Android. Weight size, intermediate buffers, WebGPU allocations, shader compilation, tokenizer state, and browser copies can all contribute. |
| **Load time** | No dependable cross-device benchmark located | The sources describe downloading weights, shader compilation, and caching in Cache API or IndexedDB, but do not provide a controlled table of model-download, compilation, and first-token times for 20–500M models on phones.[6] Load time is therefore dominated by model size, network speed, cache state, and browser pipeline. |
| **First-token latency** | **350 ms** for an 8B model on an iPhone 15 Pro in one report | The cited number is for a much larger model and should not be used as a 20–500M estimate.[7] Smaller models may still incur substantial fixed costs from graph setup, shader compilation, command submission, and tokenization. |
| **Battery and thermals** | No robust published phone measurements found | The located sources do not report standardized energy per token, battery drain per minute, skin temperature, package temperature, sustained-clock throttling, or duration-to-throttle for the requested model range. |
| **Concurrent WebGL impact** | No quantitative benchmark found | The sources do not measure frame rate, frame-time variance, GPU utilization, dropped frames, or WebGL context loss while WebGPU inference runs concurrently. |

## What can reasonably be concluded

- **WebGPU is likely essential for interactive generation on phones.** The 360M comparison of 62.9 tokens/s versus 1.6 tokens/s is a roughly 39-fold difference, although the experimental conditions are not sufficiently documented to generalize across devices.[1]
- **The main mobile constraint is often memory pressure rather than raw arithmetic.** Browser runtimes may need model weights, staging buffers, intermediate tensors, compiled shader/pipeline resources, and WebGL resources simultaneously. Reports specifically warn that WebGPU runs can raise memory usage enough to crash tabs on smaller devices, particularly iPhones.[4]
- **A concurrently rendered 3D scene is an unfavorable workload combination.** WebGPU and WebGL may share the same physical GPU, memory bandwidth, thermal budget, and browser process resources. However, the available sources provide no measured FPS degradation, so claims such as “20% slower WebGL” would be unsupported.
- **WASM can remain useful for fallback or very small models.** It avoids requiring WebGPU, but the reported 360M comparison shows that CPU/WASM generation can be too slow for conversational interaction unless the model is much smaller or heavily optimized.[1]
- **Tool-calling models add relatively little generation cost, but can add orchestration latency.** The model’s tool-call tokens are generated normally; total call latency additionally includes JSON validation, application-side dispatch, permission checks, and the tool itself. No cited benchmark isolates this overhead on mobile browsers.

## Evidence gaps

For the requested range, a useful benchmark would report, separately for iOS Safari/WebKit and Android Chrome:

- Model name, parameter count, quantization, and weight size
- Cold download time, cached load time, shader-compilation time, and time to first token
- Peak JS heap, WASM linear memory, GPU memory if available, and total process memory
- Prefill latency, decode tokens/s, and latency distributions rather than only averages
- Energy per generated token, battery percentage per hour, device temperature, and throttling over 10–30 minutes
- WebGL frame-time and FPS with inference off, WASM inference on, and WebGPU inference on
- Behavior under backgrounding, screen locking, tab suspension, and memory pressure

The current evidence supports **“small WebGPU models can be interactive on some phones”**, but not a dependable universal figure for load time, battery cost, thermals, or WebGL degradation.

[1] Run an LLM in the browser: WebGPU did 63 tokens/s, WASM did 1.6 (https://dev.to/mattbusel/run-an-llm-in-the-browser-webgpu-did-63-tokenss-wasm-did-16-24ob)
[2] Llamas on the Web: Memory-Efficient, Performance-Portable, and Multi-Precision LLM Inference with WebGPU (https://arxiv.org/html/2605.20706)
[3] The Limits of WebGPU & WebAssembly in the Browser (November 2026) | TTSLab | TTSLab (https://ttslab.dev/limits)
[4] Llamas on the Web - Reese Levine (https://reeselevine.github.io/llamas-on-the-web/)
[5] Zero-Server AI: Running LLMs and Vector Search Inside the Browser with WebGPU (https://dev.to/ahmadazimi/zero-server-ai-running-llms-and-vector-search-inside-the-browser-with-webgpu-15i5)
[6] WebAssembly Client-Side LLM & ONNX Inference with WebGPU (https://www.cosmiclearn.com/wasm/case-study-ai-inference-webgpu.php)
[7] WebGPU AI Inference: The Architecture of Browser-Native LLMs (https://www.initnode.dev/signal/webgpu-ai-inference-browser-native-llms)
[8] Run AI Models in the Browser with WebGPU & WASM (https://maddevs.io/writeups/running-ai-models-locally-in-the-browser/)
[9] llama.cpp Comes to the Browser — The Ceiling a WebGPU Backend ... (https://ttlab.hopto.org/blog/2026-07-16-llama-cpp-webgpu-browser-inference?lang=en)
[10] GitHub - abhijitramesh/webgpu-bench: WebGPU benchmarking for ... (https://github.com/abhijitramesh/webgpu-bench)
