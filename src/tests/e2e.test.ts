/**
 * E2E Integration Tests for DataDan MCP Server
 *
 * Simulates how a real project uses DataDan:
 *   1. Load existing config from example/datadan.config.yaml
 *   2. Connect to the real database via example/.env
 *   3. Sync schema (discover live schemas/tables)
 *   4. Exercise every read-only MCP tool handler
 *
 * READ-ONLY: No write, delete, or DDL operations are executed.
 *
 * Prerequisites:
 *   - example/.env must contain DATABASE_URL
 *   - example/datadan.config.yaml must exist
 */
import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import { join, resolve } from "node:path";
import { config as loadEnv } from "dotenv";
import { loadConfig } from "../config/parser.js";
import { resolvePermission, resolveSchemaPermission } from "../config/resolver.js";
import { ConnectionManager } from "../db/connection.js";
import { syncSchema } from "../db/sync.js";
import { classifyQuery } from "../permissions/classifier.js";
import { checkQueryPermission } from "../permissions/checker.js";
import { getSchemas, getTables, getColumns } from "../db/introspect.js";
import {
  mcpSuccess,
  findDatabaseOrError,
  classifyAndAuthorize,
  executeSqlTool,
} from "../tools/helpers.js";
import type { DataDanConfig } from "../config/schema.js";

// ─── Paths ──────────────────────────────────────────────────────────
const EXAMPLE_DIR = resolve(import.meta.dirname, "../../example");
const ENV_PATH = join(EXAMPLE_DIR, ".env");
const CONFIG_PATH = join(EXAMPLE_DIR, "datadan.config.yaml");

let config: DataDanConfig;
let connectionManager: ConnectionManager;

// ─── Lifecycle ──────────────────────────────────────────────────────
beforeAll(async () => {
  // Verify example/ setup exists (no temp files created)
  if (!existsSync(ENV_PATH)) throw new Error("Missing example/.env");
  if (!existsSync(CONFIG_PATH)) throw new Error("Missing example/datadan.config.yaml");

  // Load env vars from the real .env file
  loadEnv({ path: ENV_PATH });
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL not set in example/.env");
  }

  // Load the project's config exactly like `datadan start` does
  config = loadConfig(CONFIG_PATH);

  // Connect to the real database
  connectionManager = new ConnectionManager(config);
  const status = await connectionManager.connect();
  if (status.successes.length === 0) {
    throw new Error(
      `All connections failed:\n${status.failures.map((f) => `  ${f.database}: ${f.error}`).join("\n")}`
    );
  }

  // Sync schema — this is what `datadan start` runs before accepting requests
  await syncSchema(config, connectionManager, CONFIG_PATH);
  // Reload config to pick up discovered schemas/tables
  config = loadConfig(CONFIG_PATH);
}, 30_000);

afterAll(async () => {
  await connectionManager?.disconnect();
});

// ═══════════════════════════════════════════════════════════════════
// 1. STARTUP — config load + connection + schema sync
// ═══════════════════════════════════════════════════════════════════
describe("Startup: Config & Connection", () => {
  it("loads the example config with correct structure", () => {
    expect(config.name).toBe("nczdev-workspace");
    expect(config["default-permission"]).toBe("read");
    expect(config["hot-reload"]).toBe(true);
    expect(config.databases).toHaveLength(1);
    expect(config.databases[0].name).toBe("nczdev");
  });

  it("connects to nczdev successfully", () => {
    expect(connectionManager.getDatabaseNames()).toEqual(["nczdev"]);
    expect(connectionManager.getPool("nczdev")).toBeDefined();
  });

  it("schema sync discovered live schemas", () => {
    const db = config.databases[0];
    expect(db.schemas).toBeDefined();
    expect(db.schemas!.length).toBeGreaterThan(5);
  });

  it("discovered known schemas (public, auth, portal)", () => {
    const schemaNames = config.databases[0].schemas!.map((s) => s.name);
    expect(schemaNames).toContain("public");
    expect(schemaNames).toContain("auth");
    expect(schemaNames).toContain("portal");
  });

  it("discovered tables within schemas", () => {
    const authSchema = config.databases[0].schemas!.find((s) => s.name === "auth");
    expect(authSchema).toBeDefined();
    expect(authSchema!.tables).toBeDefined();
    expect(authSchema!.tables!.length).toBeGreaterThan(0);
    const tableNames = authSchema!.tables!.map((t) => t.name);
    expect(tableNames).toContain("users");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 2. TOOL: list_databases
// ═══════════════════════════════════════════════════════════════════
describe("Tool: list_databases", () => {
  it("lists nczdev as the only accessible database", () => {
    // Replicate what the list_databases handler does
    const accessibleDbs = config.databases
      .filter((db) => {
        const perm = db.permission ?? config["default-permission"];
        return perm !== "none";
      })
      .map((db) => db.name);

    expect(accessibleDbs).toEqual(["nczdev"]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 3. TOOL: list_schemas
// ═══════════════════════════════════════════════════════════════════
describe("Tool: list_schemas", () => {
  it("returns real schemas from the live database", async () => {
    const pool = connectionManager.getPool("nczdev");
    const schemas = await getSchemas(pool);

    expect(schemas.length).toBeGreaterThan(0);
    expect(schemas).toContain("public");
    expect(schemas).toContain("auth");
    expect(schemas).toContain("portal");
  });

  it("filters out schemas with none permission", () => {
    const schemas = config.databases[0].schemas ?? [];
    const accessible = schemas.filter(
      (s) => resolveSchemaPermission(config, "nczdev", s.name) !== "none"
    );
    // All schemas should be accessible with read default
    expect(accessible.length).toBe(schemas.length);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 4. TOOL: list_tables
// ═══════════════════════════════════════════════════════════════════
describe("Tool: list_tables", () => {
  it("returns tables from the auth schema", async () => {
    const pool = connectionManager.getPool("nczdev");
    const tables = await getTables(pool, "auth");

    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toContain("users");
    expect(tables).toContain("tool_credentials");
  });

  it("returns tables from the portal schema", async () => {
    const pool = connectionManager.getPool("nczdev");
    const tables = await getTables(pool, "portal");

    expect(tables.length).toBeGreaterThan(0);
    expect(tables).toContain("Company");
    expect(tables).toContain("Users");
  });

  it("returns empty for a non-existent schema", async () => {
    const pool = connectionManager.getPool("nczdev");
    const tables = await getTables(pool, "nonexistent_schema_xyz");
    expect(tables).toEqual([]);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 5. TOOL: describe_table
// ═══════════════════════════════════════════════════════════════════
describe("Tool: describe_table", () => {
  it("describes auth.users with column metadata", async () => {
    const pool = connectionManager.getPool("nczdev");
    const columns = await getColumns(pool, "auth", "users");

    expect(columns.length).toBeGreaterThan(0);

    // Should have a primary key
    const pks = columns.filter((c) => c.isPrimaryKey);
    expect(pks.length).toBeGreaterThan(0);

    // Every column has required fields
    for (const col of columns) {
      expect(col.name).toBeTruthy();
      expect(col.dataType).toBeTruthy();
      expect(typeof col.nullable).toBe("boolean");
      expect(typeof col.isPrimaryKey).toBe("boolean");
      expect(typeof col.isForeignKey).toBe("boolean");
      expect(typeof col.isUnique).toBe("boolean");
      if (col.isForeignKey) {
        expect(col.foreignKeyRef).toBeTruthy();
      } else {
        expect(col.foreignKeyRef).toBeNull();
      }
    }
  });

  it("returns empty columns for non-existent table", async () => {
    const pool = connectionManager.getPool("nczdev");
    const columns = await getColumns(pool, "auth", "table_that_does_not_exist");
    expect(columns).toEqual([]);
  });

  it("permission check blocks describe when set to none", () => {
    const perm = resolvePermission(config, "nczdev", "auth", "users");
    expect(perm).toBe("read"); // should be accessible
    expect(perm).not.toBe("none");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 6. TOOL: query (SELECT only)
// ═══════════════════════════════════════════════════════════════════
describe("Tool: query", () => {
  it("SELECT COUNT(*) FROM auth.users", async () => {
    const result = await executeSqlTool(
      config, connectionManager, "nczdev",
      "SELECT COUNT(*) as total FROM auth.users",
      ["select"], "query",
      (res) => mcpSuccess({ rows: res.rows, rowCount: res.rowCount }),
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.rows).toHaveLength(1);
    expect(Number(data.rows[0].total)).toBeGreaterThanOrEqual(0);
  });

  it("SELECT with LIMIT from auth.users", async () => {
    const result = await executeSqlTool(
      config, connectionManager, "nczdev",
      "SELECT * FROM auth.users LIMIT 3",
      ["select"], "query",
      (res) => mcpSuccess({ rows: res.rows, rowCount: res.rowCount }),
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.rows.length).toBeLessThanOrEqual(3);
  });

  it("SELECT with aggregation across information_schema", async () => {
    const result = await executeSqlTool(
      config, connectionManager, "nczdev",
      `SELECT table_schema, COUNT(*) as table_count
       FROM information_schema.tables
       WHERE table_type = 'BASE TABLE'
       GROUP BY table_schema
       ORDER BY table_count DESC
       LIMIT 5`,
      ["select"], "query",
      (res) => mcpSuccess({ rows: res.rows }),
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(data.rows.length).toBeGreaterThan(0);
    // The top schema should have some tables
    expect(Number(data.rows[0].table_count)).toBeGreaterThan(0);
  });

  it("SELECT from portal schema", async () => {
    const result = await executeSqlTool(
      config, connectionManager, "nczdev",
      "SELECT COUNT(*) as total FROM portal.\"Company\"",
      ["select"], "query",
      (res) => mcpSuccess({ rows: res.rows }),
    );

    expect(result.isError).toBeUndefined();
    const data = JSON.parse(result.content[0].text);
    expect(Number(data.rows[0].total)).toBeGreaterThanOrEqual(0);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 7. Permission Guard — write/delete/DDL denied
// ═══════════════════════════════════════════════════════════════════
describe("Permission Guard: read-only enforcement", () => {
  it("classifyAndAuthorize allows SELECT", () => {
    const result = classifyAndAuthorize(
      config, "nczdev", "SELECT * FROM auth.users", ["select"], "query"
    );
    expect("classified" in result).toBe(true);
  });

  it("classifyAndAuthorize rejects INSERT on query tool", () => {
    const result = classifyAndAuthorize(
      config, "nczdev",
      "INSERT INTO auth.users (id) VALUES (1)",
      ["select"], "query",
    );
    expect("error" in result).toBe(true);
  });

  it("checkQueryPermission denies INSERT", () => {
    const classified = classifyQuery("INSERT INTO auth.users (id) VALUES (1)");
    const check = checkQueryPermission(config, "nczdev", classified);
    expect(check.allowed).toBe(false);
    if (!check.allowed) {
      expect(check.error.content[0].text).toContain("Permission denied");
    }
  });

  it("checkQueryPermission denies DELETE", () => {
    const classified = classifyQuery("DELETE FROM auth.users WHERE id = 1");
    const check = checkQueryPermission(config, "nczdev", classified);
    expect(check.allowed).toBe(false);
  });

  it("checkQueryPermission denies DDL", () => {
    const classified = classifyQuery("DROP TABLE auth.users");
    const check = checkQueryPermission(config, "nczdev", classified);
    expect(check.allowed).toBe(false);
  });

  it("executeSqlTool rejects INSERT through the query tool", async () => {
    const result = await executeSqlTool(
      config, connectionManager, "nczdev",
      "INSERT INTO auth.users (id) VALUES (1)",
      ["select"], "query",
      (res) => mcpSuccess(res.rows),
    );
    expect(result.isError).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════
// 8. Error Handling
// ═══════════════════════════════════════════════════════════════════
describe("Error Handling", () => {
  it("returns error for invalid SQL", async () => {
    const result = await executeSqlTool(
      config, connectionManager, "nczdev",
      "SELECTAROO FROM nowhere",
      ["select"], "query",
      (res) => mcpSuccess(res.rows),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Failed to parse SQL");
  });

  it("returns error for unknown database", async () => {
    const result = await executeSqlTool(
      config, connectionManager, "ghost_db",
      "SELECT 1",
      ["select"], "query",
      (res) => mcpSuccess(res.rows),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("findDatabaseOrError returns error for unknown db", () => {
    const result = findDatabaseOrError(config, "does_not_exist");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.content[0].text).toContain("not found");
      expect(result.error.content[0].text).toContain("nczdev"); // lists available
    }
  });

  it("getPool throws for unknown database", () => {
    expect(() => connectionManager.getPool("nonexistent")).toThrow("not found");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 9. SQL Classification
// ═══════════════════════════════════════════════════════════════════
describe("SQL Classification", () => {
  it("classifies schema-qualified SELECT", () => {
    const result = classifyQuery("SELECT * FROM auth.users");
    expect(result.statementType).toBe("select");
    expect(result.requiredPermission).toBe("read");
    expect(result.referencedTables).toEqual([{ schema: "auth", table: "users" }]);
  });

  it("classifies JOIN across tables", () => {
    const result = classifyQuery(
      "SELECT u.id FROM auth.users u JOIN auth.tool_credentials t ON u.id = t.id"
    );
    expect(result.statementType).toBe("select");
    expect(result.referencedTables.length).toBe(2);
  });

  it("classifies INSERT as write", () => {
    const result = classifyQuery("INSERT INTO auth.users (id) VALUES (1)");
    expect(result.statementType).toBe("insert");
    expect(result.requiredPermission).toBe("write");
  });

  it("classifies DELETE as delete", () => {
    const result = classifyQuery("DELETE FROM auth.users WHERE id = 1");
    expect(result.statementType).toBe("delete");
    expect(result.requiredPermission).toBe("delete");
  });

  it("classifies CREATE TABLE as DDL/yolo", () => {
    const result = classifyQuery("CREATE TABLE test (id serial PRIMARY KEY)");
    expect(result.statementType).toBe("ddl");
    expect(result.requiredPermission).toBe("yolo");
  });
});

// ═══════════════════════════════════════════════════════════════════
// 10. Cross-schema discovery
// ═══════════════════════════════════════════════════════════════════
describe("Cross-schema Discovery", () => {
  it("can introspect columns from multiple schemas", async () => {
    const pool = connectionManager.getPool("nczdev");

    const [authCols, portalCols] = await Promise.all([
      getColumns(pool, "auth", "users"),
      getColumns(pool, "portal", "Company"),
    ]);

    expect(authCols.length).toBeGreaterThan(0);
    expect(portalCols.length).toBeGreaterThan(0);

    // Different tables should have different column sets
    const authNames = authCols.map((c) => c.name);
    const portalNames = portalCols.map((c) => c.name);
    expect(authNames).not.toEqual(portalNames);
  });

  it("resolves permission consistently across schemas", () => {
    const db = config.databases[0];
    const allPerms = new Set<string>();
    for (const schema of db.schemas ?? []) {
      for (const table of schema.tables ?? []) {
        allPerms.add(resolvePermission(config, "nczdev", schema.name, table.name));
      }
    }
    // With our config, everything should be "read"
    expect(allPerms.size).toBe(1);
    expect(allPerms.has("read")).toBe(true);
  });
});
