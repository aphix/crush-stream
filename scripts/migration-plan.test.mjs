import { expect, test } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isMigrationFile, migrationName, pendingMigrations, projectRoot } from "./migration-plan.mjs";

test("_migrations keys on basename, not path", () => {
  expect(migrationName("/migrations/0002_todos.sql")).toBe("0002_todos.sql");
  expect(migrationName("0002_todos.sql")).toBe("0002_todos.sql");
});

test("a file already applied from another directory does not re-apply", () => {
  expect(pendingMigrations(["/migrations/0002_a.sql"], ["0002_a.sql"])).toHaveLength(0);
});

test("pending migrations are returned in name order", () => {
  const pending = pendingMigrations(
    ["/migrations/0003_c.sql", "/migrations/0001_a.sql", "/migrations/0002_b.sql"],
    ["0001_a.sql"],
  );
  expect(pending, "pending migrations").toHaveLength(2);
  expect(pending[0].name, "first name").toBe("0002_b.sql");
  expect(pending[0].path, "first path").toBe("/migrations/0002_b.sql");
  expect(pending[1].name, "second name").toBe("0003_c.sql");
  expect(pending[1].path, "second path").toBe("/migrations/0003_c.sql");
});

test("non-.sql entries are dropped", () => {
  expect(isMigrationFile("sub")).toBe(false);
  expect(pendingMigrations(["sub", "README.md"], [])).toHaveLength(0);
});

test("the shipped migrations are numbered .sql files", () => {
  const globbed = pendingMigrations(readdirSync(join(projectRoot(), "migrations")), []);
  expect(globbed.length).toBeGreaterThan(0);
  for (const { name } of globbed) expect(name).toMatch(/^\d{4}_.+\.sql$/);
});
