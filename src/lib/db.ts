import { pendingMigrations } from "../../scripts/migration-plan.mjs";

/**
 * Minimal SQL surface over PGLite: `.query()` resolves to an array of row objects.
 *
 *   const sql = await getSql();
 *   const rows = await sql.query("select * from todos where id = $1", [id]);
 */
export interface Sql {
  query<T = Record<string, unknown>>(
    text: string,
    params?: unknown[],
  ): Promise<T[]>;
}

/**
 * Init state lives on globalThis as promises: dev HMR creates new instances of
 * this module, and two instances racing module-level state would open a second
 * database or run two concurrent PGLite migration passes (whose duplicate
 * `_migrations` insert rejects — and would get memoized, poisoning every later
 * `getSql()`). A failed init clears its slot so the next call retries.
 */
const globalRef = globalThis as typeof globalThis & {
  __pgliteInstance__?: Promise<import("@electric-sql/pglite").PGlite>;
  __pgliteMigrateChain__?: Promise<void>;
};

/**
 * Result types: PGLite parses int8 as BigInt (which JSON.stringify rejects) and
 * date as a UTC Date. Normalize to JSON-safe shapes:
 *   int8/bigint (incl. count(*)) -> number (past 2^53 loses precision — cast
 *                                   `::text` if you ever need huge integers)
 *   date                         -> 'YYYY-MM-DD' string
 *   interval                     -> Postgres interval text
 * numeric already comes back as a string (arbitrary precision).
 */
const OID_INT8 = 20;
const OID_DATE = 1082;
const OID_INTERVAL = 1186;
const identity = (v: string) => v;

async function createPgliteSql(): Promise<Sql> {
  // Embedded Postgres, imported on demand.
  // One instance per process, shared across HMR module instances, so data
  // survives source edits. In memory (reset on restart) unless PGLITE_DATA_DIR
  // names a directory, as the self-hosted node server does (docs/DEPLOY.md).
  // A data dir must belong to ONE process: PGLite has no cross-process locking.
  globalRef.__pgliteInstance__ ??= (async () => {
    const { PGlite } = await import("@electric-sql/pglite");
    const dataDir = process.env.PGLITE_DATA_DIR?.trim() || undefined;
    const pg = new PGlite({
      dataDir,
      parsers: {
        [OID_INT8]: Number,
        [OID_DATE]: identity,
        [OID_INTERVAL]: identity,
      },
    });
    await pg.waitReady;
    if (dataDir) {
      // Shut a data dir down cleanly on stop. Left unclean, the next open crash-recovers it, and
      // that instance keeps a timer armed forever, so its server never exits on SIGTERM
      // (measured: a 90 s stop timeout and a SIGKILL on every deploy; docs/DEPLOY.md).
      // The server's own handler (srvx) closes the HTTP server and the process then ends by itself,
      // but srvx skips that when CI or TEST is set. A signal listener also cancels Node's default
      // exit, so with nobody else listening this one must end the process (measured: alive 20 s
      // after SIGTERM under CI=true without it).
      for (const signal of ["SIGTERM", "SIGINT"] as const) {
        process.once(signal, () => {
          pg.close()
            .catch((err) => console.error("[db] PGLite close failed:", err))
            .finally(() => {
              if (process.listenerCount(signal) === 0) process.exit(0);
            });
        });
      }
    }
    await pg.exec(
      "create table if not exists _migrations (name text primary key, applied_at timestamptz not null default now())",
    );
    return pg;
  })().catch((err) => {
    globalRef.__pgliteInstance__ = undefined;
    throw err;
  });
  const pg = await globalRef.__pgliteInstance__;

  // Apply migrations/ (the single schema source) so preview matches production.
  // SQL is inlined by the bundler via import.meta.glob (no runtime fs); applied
  // files are tracked in _migrations. Runs once per module instance — so an HMR
  // reload after adding a migration file applies it live — with passes
  // serialized on a global chain so concurrent callers never double-apply.
  const migrate = async (): Promise<void> => {
    const migrations = import.meta.glob("/migrations/*.sql", {
      query: "?raw",
      import: "default",
      eager: true,
    }) as Record<string, string>;
    const doneRows = await pg.query<{ name: string }>(
      "select name from _migrations",
    );
    const done = doneRows.rows.map((r) => r.name);
    for (const { name, path } of pendingMigrations(Object.keys(migrations), done)) {
      // Apply + record atomically so a failed
      // statement can't leave a file half-applied but untracked.
      await pg.transaction(async (tx) => {
        await tx.exec(migrations[path]);
        await tx.query("insert into _migrations (name) values ($1)", [name]);
      });
    }
  };
  const pass = (globalRef.__pgliteMigrateChain__ ?? Promise.resolve())
    .catch(() => undefined) // an earlier failed pass must not wedge the chain
    .then(migrate);
  globalRef.__pgliteMigrateChain__ = pass;
  await pass;

  return { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
}

let sqlPromise: Promise<Sql> | null = null;

async function createSql(): Promise<Sql> {
  if (typeof window !== "undefined") {
    throw new Error(
      "@/lib/db is server-only — call getSql() from a createServerFn handler " +
        "or a server route loader, never from client code.",
    );
  }
  return createPgliteSql();
}

/**
 * Get the shared, **server-only** SQL client: the embedded PGLite database. Memoized — safe to call per request.
 *
 * Schema comes from `migrations/*.sql`, auto-applied before the first query — define tables there, never inline in
 * server functions.
 */
export function getSql(): Promise<Sql> {
  sqlPromise ??= createSql().catch((err) => {
    sqlPromise = null; // don't memoize failures — let the next call retry
    throw err;
  });
  return sqlPromise;
}

// Server-only eager start: kick PGLite bootstrap as soon as this module loads in
// Node, so the first request does not pay for it. Client bundles never hit this
// path (`getSql` throws in the browser).
const globalBoot = globalThis as typeof globalThis & {
  __pgBootstrapPromise__?: Promise<Sql>;
};
if (typeof window === "undefined") {
  globalBoot.__pgBootstrapPromise__ ??= getSql().catch((err) => {
    globalBoot.__pgBootstrapPromise__ = undefined;
    console.error("[db] PGLite bootstrap failed:", err);
    throw err;
  });
}
