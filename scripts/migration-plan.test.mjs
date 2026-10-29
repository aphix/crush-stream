import { test } from "vitest";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isMigrationFile, migrationName, pendingMigrations, projectRoot } from "./migration-plan.mjs";

test("_migrations keys on basename, not path", () => {
  assert.equal(migrationName("/migrations/0002_todos.sql"), "0002_todos.sql");
  assert.equal(migrationName("0002_todos.sql"), "0002_todos.sql");
});

test("a file already applied from another directory does not re-apply", () => {
  assert.deepEqual(pendingMigrations(["/migrations/0002_a.sql"], ["0002_a.sql"]), []);
});

test("pending migrations are returned in name order", () => {
  assert.deepEqual(
    pendingMigrations(
      ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
      ["0001_a.sql"],
    ),
    [
      { name: "0002_b.sql", path: "/migrations/0002_b.sql" },
      { name: "0003_c.sql", path: "/migrations/0003_c.sql" },
    ],
  );
});

test("non-.sql entries are dropped", () => {
  assert.equal(isMigrationFile("sub"), false);
  assert.deepEqual(pendingMigrations(["sub", "README.md"], []), []);
});

test("the shipped migrations are numbered .sql files", () => {
  const globbed = pendingMigrations(readdirSync(join(projectRoot(), "migrations")), []);
  assert.ok(globbed.length > 0);
  for (const { name } of globbed) assert.match(name, /^\d{4}_.+\.sql$/);
});
