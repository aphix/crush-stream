import { readdirSync, readFileSync } from "node:fs";
import { PGlite } from "@electric-sql/pglite";
import type { Sql } from "@/lib/db";

const MIGRATIONS = new URL("../../migrations/", import.meta.url);

/** An in-memory database with `migrations/*.sql` applied; `after(file, pg)` runs after each file (to write rows an older schema held). */
export async function migratedPg(after?: (file: string, pg: PGlite) => Promise<void>): Promise<PGlite> {
  const pg = new PGlite({ parsers: { 20: Number } }); // int8 as db.ts parses it
  for (const file of readdirSync(MIGRATIONS).filter((f) => f.endsWith(".sql")).sort()) {
    await pg.exec(readFileSync(new URL(file, MIGRATIONS), "utf8"));
    await after?.(file, pg);
  }
  return pg;
}

/** `pg` behind the server code's `Sql` port, as db.ts wraps it. */
export function sqlOf(pg: PGlite): Sql {
  return { query: async <T>(text: string, params: unknown[] = []) => (await pg.query<T>(text, params)).rows };
}
