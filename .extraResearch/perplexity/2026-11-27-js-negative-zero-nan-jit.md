> Question: How do the optimising compilers of V8 and SpiderMonkey handle negative zero and NaN in floating-point and integer-specialised JavaScript code? Which operations need extra checks, lose an integer representation or deoptimise because of them, and what do the engine teams document about it? Cite engine source, engine team posts or published measurements.

V8 and SpiderMonkey both preserve JavaScript’s IEEE-754 semantics, but their integer-specialised paths must treat **\(-0\)** and **NaN** as values that ordinary machine-integer representations cannot faithfully encode.

## V8

V8 commonly represents small signed integers as **Smis**—historically 31-bit tagged integers—while other numeric values use heap-allocated or unboxed doubles. The distinction matters because a Smi can represent \(0\), but not \(-0\), NaN, infinities, or fractional values.[6]

- **Integer arithmetic:** TurboFan may keep a value in an integer representation when its range and semantics permit it. If an operation can produce \(-0\), the compiler must either retain a floating-point representation, insert a negative-zero check, or deoptimise when the speculative integer assumption fails. V8’s deoptimization-reason list explicitly includes `MinusZero`.[9]
- **Division and reciprocal-like operations:** These need particular care because IEEE-754 distinguishes \(+0\) and \(-0\). For example, \(-1 * 0\) must produce \(-0\), which cannot be represented by a two’s-complement integer.[6]
- **Multiplication and subtraction:** Integer-specialised code can generally use machine-integer operations only if the compiler proves that the result cannot be \(-0\). Otherwise, it needs a check or must “float” the operation.
- **Conversions back to tagged values:** Converting a speculative floating result to an integer/Smi representation is unsafe if the result might be \(-0\), because that conversion would collapse \(-0\) into \(+0\). V8’s own discussion of a `Math.expm1` optimisation illustrates this: an untagged floating result can lose the sign of zero, whereas returning a tagged number preserves it.[10]
- **NaN:** NaN cannot be a Smi. If an integer-specialised path encounters NaN, it must abandon the integer representation and produce a floating-point/HeapNumber value, or deoptimise. V8’s deoptimization reasons include both `NaN` and `LostPrecisionOrNaN`.[3]
- **Floating-point optimisation:** NaN payloads are not generally treated as significant JavaScript-visible distinctions by ordinary arithmetic optimisation; V8’s deoptimizer documentation says that tagged `DOUBLE_LITERAL` materialisation canonicalises NaNs to a quiet NaN, while raw double-array materialisation can preserve the underlying bits.[2]

Thus, in V8, **\(-0\)** mainly creates a semantic hazard when an operation or conversion is being represented as an integer, while **NaN** is both a non-integer value and a possible reason for leaving speculative numeric code.

## SpiderMonkey

SpiderMonkey’s JITs use specialised numeric representations and NaN-boxed/tagged values, but the same semantic constraint applies: an integer representation cannot encode either \(-0\) or NaN. SpiderMonkey therefore has to preserve a double representation, add guards, or recover through bailout when an integer assumption is violated.[4]

The practical consequences are:

- **Integer-specialised arithmetic** can remain integer-only when the compiler proves that inputs and results stay within the permitted integer range and cannot require floating-point semantics.
- **Operations whose result may be \(-0\)**—especially multiplication, division, negation, and conversions involving zero—cannot blindly use an integer result. They require a negative-zero test, a floating-point path, or a bailout.
- **Operations that may produce NaN**—notably division by zero, invalid floating operations, and conversions from nonnumeric values—must retain a double/boxed-number path or trigger a bailout from integer-specialised code.
- **Integer overflow and loss of exactness** create a related representation boundary: even when the result is not NaN or \(-0\), the JIT must stop using its integer representation once JavaScript-number semantics require a double.

The available SpiderMonkey-oriented material confirms the representation-level issue—SpiderMonkey uses NaN-boxing, in which NaN-space encodes non-double values, rather than treating all numbers as machine integers.[4] However, the search results do not expose a sufficiently specific current SpiderMonkey source file or Mozilla engineering post that enumerates each individual bailout/check in the way V8’s published deoptimization-reason list does. That makes precise one-to-one attribution of particular SpiderMonkey operations—such as whether a given IonMonkey/MegaJIT instruction emits a dedicated negative-zero guard versus selecting a floating instruction—version-dependent.

## Main difference

The important distinction is not that one engine “handles” \(-0\) or NaN and the other does not:

| Case | V8 | SpiderMonkey |
|---|---|---|
| Integer value remains in proven range | Smi/int-specialised path | Int32/int-specialised path |
| Possible \(-0\) | Negative-zero check, floating representation, or `MinusZero` deopt[9] | Guard/bailout or floating representation |
| NaN enters integer-specialised code | Lose integer representation or deopt; reasons include `NaN` and `LostPrecisionOrNaN`[3] | Lose integer representation or bail out to a double/boxed-number path |
| Conversion of floating result to integer | Must avoid collapsing \(-0\) into \(+0\)[6][10] | Same JavaScript semantic requirement |
| NaN representation | HeapNumber/double; NaNs may be canonicalised when materialised in tagged form[2] | NaN-boxing uses NaN bit patterns to distinguish values[4] |

The V8 team has documented the issue most explicitly: integer operations are attractive for performance, but JavaScript’s signed zero and NaN semantics force checks or deoptimisation at representation boundaries.[6] The published cross-engine performance study also measured optimisation effects in both V8 and SpiderMonkey, although the supplied search material does not provide a specific \(-0\)/NaN microbenchmark result.[5]

[1] P0lip/v8-deoptimize-reasons - GitHub (https://github.com/P0lip/v8-deoptimize-reasons)
[2] V8 Deoptimization Architecture (https://chromium.googlesource.com/v8/v8/+/ceffe67de847700af9377eca6ab1da2e966f4173/docs/runtime/deoptimization.md)
[3] Git at Google (https://chromium.googlesource.com/v8/v8/+/346c5c56a657a35d8c0e11c9463aeea7d83b857b/src/deoptimizer/deoptimize-reason.h)
[4] Tagged Values, Smis & Heap Numbers (https://completefrontend.com/javascript/value-representation)
[5] Performance Issues and Optimizations in JavaScript (https://software-lab.org/publications/icse2016-perf.pdf)
[6] The story of a V8 performance cliff in React (https://v8.dev/blog/react-cliff)
[7] v8-deoptimize-reasons/README.md at master (https://github.com/P0lip/v8-deoptimize-reasons/blob/master/README.md)
[8] 1.0.3 • skills • simon • Registry (https://tessl.io/registry/simon/skills/files/skills/nodejs-core/rules/v8-jit-compilation.md)
[9] Git at Google (https://chromium.googlesource.com/v8/v8/+/0a1fae9e77c6d8e85d8197b4f4396815ec9194b9/src/deoptimizer/deoptimize-reason.h)
[10] Exploiting the Math.expm1 typing bug in V8 - 0x41414141 in ?? () (https://abiondo.me/2019/01/02/exploiting-math-expm1-v8/)
