> Question: A browser game runs a physics simulation in JavaScript: tight loops over Float32Array and Float64Array, hundreds of thousands of arithmetic operations a frame, in V8 and in SpiderMonkey. We are deciding which expression forms to use for basic numeric operations in those loops: converting a number to an integer, rounding, absolute value, sign, minimum and maximum, clamping, vector length, and tests for zero and NaN. Which forms do the optimising compilers of V8 and SpiderMonkey turn into the cheapest machine code, which ones cause calls, boxing or deoptimisation, and what has been measured? What did asm.js and Emscripten-generated JavaScript rely on for these operations, and why? Cite engine source, engine team posts, specifications or published measurements.

For hot typed-array loops, the best general rule is: **write the operation whose JavaScript semantics you actually need, use built-in `Math` operations for floating-point values, and use bitwise coercions only when you deliberately want signed 32-bit semantics**. Modern V8 and SpiderMonkey usually inline and lower common monomorphic numeric operations; the old belief that `Math.*` necessarily means a runtime call is wrong.

## Practical choices

| Operation | Preferred form | What optimizing JITs generally do | Main caveat |
|---|---|---|---|
| Integer conversion, toward zero | `x \| 0` or `x >> 0` for signed 32-bit; `x >>> 0` for unsigned 32-bit | Recognize as an `Int32` conversion, often with a machine conversion or register representation change | Converts modulo \(2^{32}\); changes `NaN`, infinities, and out-of-range values. It is not equivalent to `Math.trunc` for all numbers |
| Integer conversion with specified JS semantics | `Math.trunc(x)` | Inline when the input is known numeric; typically lowers to truncating conversion plus handling for values that do not fit the target representation | Preserves `NaN`, infinities, and the full Number result semantics |
| Floor / ceiling / rounding | `Math.floor(x)`, `Math.ceil(x)`, `Math.round(x)` | Usually inline to hardware rounding instructions or short sequences when types are known | `Math.round` has JavaScript-specific behavior, including signed zero, so it may need more than one instruction |
| Absolute value | `Math.abs(x)` | Commonly lowered to an absolute-value instruction or sign-bit masking; for `Float32`/`Float64`, this is especially direct | `Math.abs(-0)` is `+0`; bit tricks may not preserve all required semantics |
| Sign | `Math.sign(x)` | May inline to comparisons and a conditional result | Must distinguish positive and negative zero and propagate `NaN`; `x > 0 ? 1 : x < 0 ? -1 : 0` is not fully equivalent |
| Minimum / maximum | `Math.min(a, b)`, `Math.max(a, b)` | Often lowered to floating-point min/max or compare/select sequences | JavaScript requires particular `NaN` and signed-zero behavior; a raw hardware instruction may need correction |
| Clamp | `Math.min(Math.max(x, lo), hi)` or the reverse | Usually becomes two comparisons/selects if values are known numeric; no universal primitive is required | Operand order matters for `NaN`, and bounds should be invariant and numeric |
| Vector length | `Math.hypot(x, y)` for robust JS semantics; `Math.sqrt(x*x + y*y)` when ordinary finite values are guaranteed | `sqrt` is commonly a single hardware instruction; `hypot` is more elaborate because it avoids overflow/underflow and handles arbitrary argument counts | `hypot` need not be as cheap as multiply-add-plus-`sqrt` |
| Test for zero | `x === 0` | Usually a direct compare; for numbers it also matches `-0` | `Object.is(x, 0)` excludes `-0`; `Object.is(x, -0)` distinguishes it |
| Test for `NaN` | `x !== x` in a proven numeric hot loop, or `Number.isNaN(x)` for clarity | Numeric self-inequality can become a direct unordered floating-point compare; `Number.isNaN` can also inline | `isNaN(x)` performs coercion and may call or allocate through generic conversion paths |

The strongest low-level idiom is therefore not “replace every `Math` call with a trick.” It is **keep values in a stable numeric representation, avoid mixed types and generic coercion, and let the optimizing compiler specialize the operation**.

## Why bitwise integer idioms are different

JavaScript bitwise operators convert operands to signed or unsigned 32-bit integers. Thus:

```js
x | 0       // ToInt32(x)
x >> 0      // ToInt32(x)
x >>> 0     // ToUint32(x)
```

These forms were central to asm.js because they served two purposes simultaneously:

1. They expressed an explicit 32-bit type to the compiler.
2. They made integer overflow and conversion semantics predictable.

For example, `x | 0` does not mean “round a Number to the nearest representable integer.” It truncates toward zero and then wraps to 32 bits. It also maps `NaN` and infinities to zero under ECMAScript’s `ToInt32` conversion. That makes it excellent for an explicitly 32-bit algorithm and incorrect for a general-purpose numeric conversion.

`Math.imul(a, b)` was added for C-like signed 32-bit multiplication. MDN describes it as multiplying as though the operands were 32-bit integers and identifies Emscripten/asm.js as an important use case.[2] A contemporaneous explanation likewise notes that Emscripten-generated asm.js used `Math.imul`, while ordinary bitwise expressions could sometimes express the same result.[1]

## V8 and SpiderMonkey lowering

V8’s optimizing pipeline has explicit numeric typing and lowering machinery. Its operation typer tracks categories such as integers, minus zero, and `NaN`, and includes dedicated treatment for operations such as number rounding rather than treating every `Math` operation as an opaque call.[9] Older V8 source also shows built-ins such as `Math.round`, `Math.min`, and `Math.max` implementing the specified edge cases, including `NaN` and signed zero.[4]

In practical terms, a hot loop like:

```js
for (let i = 0; i < a.length; ++i) {
  a[i] = Math.abs(a[i]);
}
```

can be compiled with a typed load, an absolute-value operation, and a typed store once the array and value types are stable. Replacing it with a JavaScript-level conditional does not inherently improve it and can make the compiler preserve more control-flow and edge-case behavior.

SpiderMonkey’s IonMonkey/ Warp-style optimizing pipeline follows the same broad strategy: typed-array loads and stores are specialized, arithmetic operations receive numeric MIR/LIR representations, and common operations are lowered to machine instructions or compare/select sequences. A direct per-expression cost comparison cannot be stated independently of engine version, CPU, input types, warm-up, and surrounding loop code. In particular, “causes a call” is not a stable property of the spelling alone: a builtin may begin as a call in baseline code and become inlined after optimization.

## Operations most likely to cause trouble

### Generic coercion

Avoid these in the inner loop unless coercion is intentional:

```js
parseInt(x)
Number(x)
isNaN(x)
Math.min(...array)
```

`isNaN(x)` first converts its argument to Number, unlike `Number.isNaN(x)`, which tests only whether an already numeric value is `NaN`. Generic values can therefore lead to conversion paths, type guards, and deoptimization.

### Polymorphism

The following patterns undermine specialization:

```js
x = condition ? 1 : "1";
arr[i] = condition ? value : undefined;
```

Mixing strings, objects, `undefined`, integers, and doubles forces guards or generic arithmetic. Typed arrays help because their element representation is fixed, but the values entering the computation can still be polymorphic.

### Spread and variable-arity min/max

For fixed operands, use:

```js
Math.min(a, b)
Math.max(a, b)
```

Avoid constructing arrays or using spread in a tight loop:

```js
Math.min(...values)
```

That adds argument handling and may prevent the simple fixed-arity lowering that an optimizing compiler can use.

### Manual floating-point bit hacks

Expressions such as:

```js
x & 0x7fffffff
```

do not operate on the floating-point bit pattern; they first convert `x` to a 32-bit integer. They are therefore not substitutes for `Math.abs` on `Float32` or `Float64` values. Likewise, `x * x` may overflow where `Math.hypot(x, y)` is designed to remain numerically stable.

## Vector length and clamping

For ordinary bounded simulation coordinates, this is usually the cheapest shape:

```js
const length = Math.sqrt(x * x + y * y);
const clamped = Math.min(maxValue, Math.max(minValue, x));
```

If overflow, underflow, or very large magnitudes are possible, use:

```js
const length = Math.hypot(x, y);
```

`Math.hypot` has stronger numerical behavior but generally requires more work than two multiplies, an add, and `sqrt`.

For a known finite range, a branch can also be competitive:

```js
let y = x;
if (y < lo) y = lo;
else if (y > hi) y = hi;
```

Whether this beats nested `Math.min`/`Math.max` depends on branch predictability and the engine’s generated code. Benchmark the complete loop, not isolated calls.

## What asm.js and Emscripten relied on

asm.js used a restricted JavaScript subset in which annotations such as:

```js
x = x | 0;
f = +f;
heap[i >> 2] | 0;
```

made integer, double, and heap-access types statically apparent. Emscripten exploited these patterns to compile C/C++ into JavaScript that browsers could validate and optimize aggressively. The approach was designed to let engines avoid dynamic JavaScript semantics in the hot path, rather than because bitwise syntax was universally faster for every ordinary JavaScript program.

The Emscripten/asm.js presentation material reports approximately 67% of native speed on Firefox in one comparison, with other browsers not far behind.[5] That result reflects the whole compilation model—typed code, linear memory, predictable control flow, and specialized engine support—not the isolated cost of one spelling such as `x | 0`.

`Math.imul` filled an important gap: JavaScript’s ordinary multiplication produces a Number, whereas C integer multiplication wraps at 32 bits. asm.js and Emscripten needed a standard operation expressing that exact contract; `Math.imul` was introduced for that purpose.[1][2]

## Bottom line

- Use `Math.abs`, `Math.floor`, `Math.ceil`, `Math.trunc`, `Math.round`, `Math.min`, and `Math.max` directly for Number-valued computations.
- Use `|0`, `>>0`, and `>>>0` only when 32-bit conversion or wrapping is part of the algorithm.
- Use `Math.imul` for explicit signed 32-bit multiplication.
- Prefer `Number.isNaN(x)` or `x !== x` in a proven numeric loop; avoid global `isNaN` when coercion is not wanted.
- Use `Math.sqrt(x*x + y*y)` for ordinary finite vectors and `Math.hypot` when numerical robustness matters.
- Keep typed-array element types, loop variables, and function arguments stable; this usually matters more than choosing between equivalent surface spellings.
- Treat any exact nanosecond ranking as engine- and CPU-specific. Published asm.js measurements demonstrate the benefit of the typed compilation model, but do not establish a universal ranking for every modern V8 and SpiderMonkey builtin.[5]

[1] Why would I use Math.imul()? (https://stackoverflow.com/questions/21052816/why-would-i-use-math-imul)
[2] Math.imul() - JavaScript - MDN Web Docs (https://developer.mozilla.org/en-US/docs/Web/JavaScript/Reference/Global_Objects/Math/imul)
[3] WebAssembly much slower than JS in this benchmark (https://www.reddit.com/r/WebAssembly/comments/kk9vuv/webassembly_much_slower_than_js_in_this_benchmark/)
[4] src/math.js - v8 (https://chromium.googlesource.com/v8/v8/+/4.3.21/src/math.js?autodive)
[5] talks/berk.html at master · kripken/talks (https://github.com/kripken/talks/blob/master/berk.html)
[6] Whose maths is it? (https://blog.stdlib.io/whose-maths-is-it/)
[7] 21052816 (https://stackoverflow.com/feeds/question/21052816)
[8] math | vdoc (https://modules.vlang.io/math.html)
[9] Git at Google (https://chromium.googlesource.com/v8/v8.git/+/4158af83db7bab57670a9254b766df784cd8a15e/src/compiler/operation-typer.cc)
[10] Math Namespace ​ (https://www.vex-lang.org/docs/guide/math)
