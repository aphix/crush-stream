# Crash Deformer Test: agent instructions

A browser car-crash game: soft-body hulls, a contact solver, a race and derby layer, WebRTC netplay. Read the docs
named below before touching the area they cover.

## Standards

`docs/CODING_STANDARDS.md` is binding: read it before writing code. The structural rules (which layer may import which)
are in `docs/ARCHITECTURE.md` and enforced by `npm run check:boundaries`.

## Environment

- Node 22.18 or newer (it runs TypeScript without a flag; `.nvmrc` picks 24 for `nvm use`), Linux, WSL2 or macOS. Packages come from pnpm through corepack: `corepack pnpm install
  --frozen-lockfile`. `docs/DEPLOY.md` states the build and deploy commands.
- Start every Vite command through the npm scripts (`npm run dev`, `npm run build`, `npm run preview`), not `vite`
  directly: the scripts run it through `scripts/with-app-env.mjs`, the `NAME=value` env-arg runner.
- The dev server listens on `0.0.0.0:8080` (`strictPort`; change neither host nor port). `npm run preview:restart`
  serves the built output on `127.0.0.1:8081` and frees that port first; `npm run preview:stop` stops it.
- Never create a `.env` file; only `VITE_`-prefixed variables reach the browser. Server variables
  (`PORT`, `HOST`, `PGLITE_DATA_DIR`) are listed in `docs/DEPLOY.md`.
- Playwright drives the repo's own browser scripts (`scripts/bench-browser.mjs`, `scripts/bake-env.mjs`,
  `scripts/check-programs.mjs`, `scripts/readme-shots.mjs`, which remakes the README's pictures at the Ultra tier from a
  served build). QA screenshots go under `screenshots/` (git-ignored).
- `scripts/headless-frame.mjs` draws the real engine in node, no browser: WebGL2 from `@kmamal/gl` (ANGLE; on WSL the
  script sets `GALLIUM_DRIVER=d3d12` itself so Mesa reaches the GPU) and the game's canvases from `@napi-rs/canvas`. pnpm
  never runs `@kmamal/gl`'s download of its native binary from GitHub (`allowBuilds` in `pnpm-workspace.yaml`: the deploy
  installs dev dependencies too), so fetch it once per `node_modules`: `node node_modules/@kmamal/gl/scripts/install.mjs`.

## Checks

| Command | What it does |
|---|---|
| `npm run test:app` | Vitest over the `src/game`, `src/lib/multiplayer`, `src/lib/submissions` and `src/lib/deploy` suites and `scripts/**/*.test.mjs`; the per-commit gate. It runs `test:parity` first and stops if it fails. A test process that writes to stderr fails the run |
| `npm run test:parity` | the WASM skin kernel against the JS skin (`deform/skin-kernel.parity.ts`), alone: every other test process skins with the kernel |
| `npx vitest run --project app <filters> [--maxWorkers=2]` | the same runner on just the files whose path contains a filter (one process per file); `--maxWorkers=` also works after `test:app`, `--shard=i/n` splits a run across machines |
| `npm run test:ai-long-run` | the long suite, `src/game/**/*.ai-long-run.ts`: AI-driven runs (whole fields watched for stuck cars, false ejections). Not in the per-commit gate; part of `test:all`. Linted, typechecked and boundary-checked like tests |
| `npm run test:all` | `test:app` and `test:ai-long-run` in one pass: what a landing on `main` must pass (`--maxWorkers=` as above) |
| `npm run test:todos` | the `todoRow` rows (open problems, listed but not run by the others) with their bodies run: each reports green, or skipped with the failed assertion; never fails the run |
| `npm run typecheck` | `tsrs --noEmit --fast`, oxc's Rust port of the TypeScript checker (`docs/TOOLCHAIN.md`) |
| `npm run check:boundaries` | the structural rules, ratcheted against `scripts/boundary-caps.json` |
| `npm run lint` | `oxlint` (`docs/TOOLCHAIN.md`) |
| `npm run build:node` | the self-hosted server build into `.output/` |
| `node scripts/check-links.mjs` | every relative link in `README.md` and `docs/*.md` resolves; run it after moving or renaming a doc |
| `node --disable-warning=ExperimentalWarning scripts/headless-frame.mjs [--tier high] [--out <png>] [--root <checkout>] [--hash <share #>] [--camera r,pitch,angle]` | a frame drawn by the real engine in node (a derby by default, or the scene a share `--hash` names, framed by `--camera`): a PNG plus one JSON line (GPU, draw calls, triangles, programs, textures, geometries, every program that failed to link, GL error); exit 1 on a link failure or a GL error. For shots, before/after diffs (`--root` another checkout) and counts; not for frame times, which the browser judges (`docs/TOOLCHAIN.md`) |

## Layout

- `src/game/`: the simulation and presentation (`world`, `contact`, `vehicle`, `deform` are sim; `present` is drawing).
- `src/lib/`: multiplayer relay and transport, submissions, deploy-time update check, database access (`db.ts`).
- `src/routes/`: TanStack Start routes (`index`, `bench`, `api/rtc`, `api/submissions`); `src/components/`: the HUD.
- `migrations/`: SQL applied in name order, once, by `src/lib/db.ts`.
- `docs/`: design, performance and deploy notes. `.extraResearch/`: the papers behind the solver, each with an analysis
  note and an index in its `README.md`.

## Rules

- New behavior gets a test that fails without the change. Never delete a test; re-pin only what a bug fix pinned.
- Permanent changes update the docs they affect; throwaway scripts and scaffolds do not stay.
- Replay-affecting simulation changes bump `REPLAY_VERSION` (`src/game/net/reel-codec.ts`) with a history entry.
