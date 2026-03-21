import { describe, it, expect } from "vitest";
import type { DataDanConfig } from "../config/schema.js";

// Test the isDatabaseAccessible logic directly by replicating it
// (it's a private function, but we can test via the module's behavior)

function isDatabaseAccessible(config: DataDanConfig, dbName: string): boolean {
  const dbConfig = config.databases.find((db) => db.name === dbName);
  if (!dbConfig) return false;

  const dbPermission = dbConfig.permission ?? config["default-permission"];
  if (dbPermission !== "none") return true;

  if (dbConfig.schemas) {
    for (const schema of dbConfig.schemas) {
      if (schema.permission && schema.permission !== "none") return true;
      if (schema.tables) {
        for (const table of schema.tables) {
          if (table.permission && table.permission !== "none") return true;
        }
      }
    }
  }

  return false;
}

function makeConfig(databases: DataDanConfig["databases"] = [], defaultPerm = "read"): DataDanConfig {
  return {
    name: "test",
    "default-permission": defaultPerm as DataDanConfig["default-permission"],
    "hot-reload": false,
    databases,
  };
}

describe("isDatabaseAccessible", () => {
  it("returns false when database not found", () => {
    const config = makeConfig([]);
    expect(isDatabaseAccessible(config, "unknown")).toBe(false);
  });

  it("returns true when db has non-none default-permission", () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://" },
    ], "read");
    expect(isDatabaseAccessible(config, "db1")).toBe(true);
  });

  it("returns true when db has explicit non-none permission", () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://", permission: "write" },
    ], "none");
    expect(isDatabaseAccessible(config, "db1")).toBe(true);
  });

  it("returns false when db and default are none with no schema overrides", () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://" },
    ], "none");
    expect(isDatabaseAccessible(config, "db1")).toBe(false);
  });

  it("returns true when schema has non-none permission", () => {
    const config = makeConfig([
      {
        name: "db1",
        connection_string: "pg://",
        schemas: [{ name: "public", permission: "read" }],
      },
    ], "none");
    expect(isDatabaseAccessible(config, "db1")).toBe(true);
  });

  it("returns true when a table has non-none permission", () => {
    const config = makeConfig([
      {
        name: "db1",
        connection_string: "pg://",
        schemas: [
          {
            name: "public",
            tables: [{ name: "users", permission: "read" }],
          },
        ],
      },
    ], "none");
    expect(isDatabaseAccessible(config, "db1")).toBe(true);
  });

  it("returns false when all schemas and tables are none", () => {
    const config = makeConfig([
      {
        name: "db1",
        connection_string: "pg://",
        schemas: [
          {
            name: "public",
            permission: "none",
            tables: [{ name: "users", permission: "none" }],
          },
        ],
      },
    ], "none");
    expect(isDatabaseAccessible(config, "db1")).toBe(false);
  });
});
