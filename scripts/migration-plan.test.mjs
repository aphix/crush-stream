import { describe, expect, it } from "vitest";
import { readdirSync } from "node:fs";
import { join } from "node:path";
import { isMigrationFile, migrationName, pendingMigrations, projectRoot } from "./migration-plan.mjs";

describe("given migration files in the migrations folder", () => {
  it("when one is recorded, then it is named by its file name, not its path", () => {
    expect(migrationName("/migrations/0002_todos.sql")).toBe("0002_todos.sql");
    expect(migrationName("0002_todos.sql")).toBe("0002_todos.sql");
  });

  it("when a file was already applied from another directory, then it is not applied again", () => {
    expect(pendingMigrations(["/migrations/0002_a.sql"], ["0002_a.sql"])).toHaveLength(0);
  });

  it("when some are pending, then they come back in name order", () => {
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

  it("when an entry is not a .sql file, then it is dropped", () => {
    expect(isMigrationFile("sub")).toBe(false);
    expect(pendingMigrations(["sub", "README.md"], [])).toHaveLength(0);
  });

  it("when the shipped migrations folder is listed, then every entry is a numbered .sql file", () => {
    const globbed = pendingMigrations(readdirSync(join(projectRoot(), "migrations")), []);
    expect(globbed.length).toBeGreaterThan(0);
    for (const { name } of globbed) expect(name).toMatch(/^\d{4}_.+\.sql$/);
  });
});
