import { describe, it, expect, vi, beforeEach } from "vitest";
import { syncSchema } from "../db/sync.js";
import type { DataDanConfig } from "../config/schema.js";

// Mock the introspect module
vi.mock("../db/introspect.js", () => ({
  getSchemas: vi.fn(),
  getTables: vi.fn(),
}));

// Mock writeConfig
vi.mock("../config/parser.js", () => ({
  writeConfig: vi.fn(),
}));

import { getSchemas, getTables } from "../db/introspect.js";
import { writeConfig } from "../config/parser.js";

const mockedGetSchemas = vi.mocked(getSchemas);
const mockedGetTables = vi.mocked(getTables);
const mockedWriteConfig = vi.mocked(writeConfig);

function makeConfig(databases: DataDanConfig["databases"] = []): DataDanConfig {
  return {
    name: "test",
    "default-permission": "read",
    "hot-reload": false,
    databases,
  };
}

describe("syncSchema", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("adds new schemas and tables from live database", async () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://", schemas: [] },
    ]);

    const mockPool = {};
    const mockConnMgr = { getPool: vi.fn().mockReturnValue(mockPool) } as any;

    mockedGetSchemas.mockResolvedValue(["public", "analytics"]);
    mockedGetTables.mockImplementation(async (_pool, schema) => {
      if (schema === "public") return ["users", "orders"];
      if (schema === "analytics") return ["events"];
      return [];
    });

    const summary = await syncSchema(config, mockConnMgr, "/tmp/config.yaml");
    expect(summary.added.schemas).toBe(2);
    expect(summary.added.tables).toBe(3);
    expect(summary.removed.schemas).toBe(0);
    expect(summary.removed.tables).toBe(0);
    expect(mockedWriteConfig).toHaveBeenCalled();
  });

  it("removes schemas that no longer exist", async () => {
    const config = makeConfig([
      {
        name: "db1",
        connection_string: "pg://",
        schemas: [
          { name: "old_schema", tables: [{ name: "old_table" }] },
          { name: "public", tables: [{ name: "users" }] },
        ],
      },
    ]);

    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;

    mockedGetSchemas.mockResolvedValue(["public"]);
    mockedGetTables.mockResolvedValue(["users"]);

    const summary = await syncSchema(config, mockConnMgr, "/tmp/config.yaml");
    expect(summary.removed.schemas).toBe(1);
    expect(summary.removed.tables).toBe(1); // old_table is removed with schema
  });

  it("removes tables that no longer exist", async () => {
    const config = makeConfig([
      {
        name: "db1",
        connection_string: "pg://",
        schemas: [
          {
            name: "public",
            tables: [{ name: "users" }, { name: "deleted_table" }],
          },
        ],
      },
    ]);

    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;

    mockedGetSchemas.mockResolvedValue(["public"]);
    mockedGetTables.mockResolvedValue(["users"]);

    const summary = await syncSchema(config, mockConnMgr, "/tmp/config.yaml");
    expect(summary.removed.tables).toBe(1);
    expect(config.databases[0].schemas![0].tables).toHaveLength(1);
    expect(config.databases[0].schemas![0].tables![0].name).toBe("users");
  });

  it("adds new tables to existing schemas", async () => {
    const config = makeConfig([
      {
        name: "db1",
        connection_string: "pg://",
        schemas: [
          { name: "public", tables: [{ name: "users" }] },
        ],
      },
    ]);

    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;

    mockedGetSchemas.mockResolvedValue(["public"]);
    mockedGetTables.mockResolvedValue(["users", "new_table"]);

    const summary = await syncSchema(config, mockConnMgr, "/tmp/config.yaml");
    expect(summary.added.tables).toBe(1);
  });

  it("does not write config when nothing changed", async () => {
    const config = makeConfig([
      {
        name: "db1",
        connection_string: "pg://",
        schemas: [{ name: "public", tables: [{ name: "users" }] }],
      },
    ]);

    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;

    mockedGetSchemas.mockResolvedValue(["public"]);
    mockedGetTables.mockResolvedValue(["users"]);

    const summary = await syncSchema(config, mockConnMgr, "/tmp/config.yaml");
    expect(summary.added.schemas).toBe(0);
    expect(summary.added.tables).toBe(0);
    expect(summary.removed.schemas).toBe(0);
    expect(summary.removed.tables).toBe(0);
    expect(mockedWriteConfig).not.toHaveBeenCalled();
  });

  it("skips databases that fail to connect", async () => {
    const config = makeConfig([
      { name: "bad_db", connection_string: "pg://", schemas: [] },
    ]);

    const mockConnMgr = {
      getPool: vi.fn().mockImplementation(() => {
        throw new Error("connection refused");
      }),
    } as any;

    const summary = await syncSchema(config, mockConnMgr, "/tmp/config.yaml");
    expect(summary.added.schemas).toBe(0);
    expect(mockedWriteConfig).not.toHaveBeenCalled();
  });

  it("skips databases where introspection fails", async () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://", schemas: [] },
    ]);

    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;
    mockedGetSchemas.mockRejectedValue(new Error("introspection error"));

    const summary = await syncSchema(config, mockConnMgr, "/tmp/config.yaml");
    expect(summary.added.schemas).toBe(0);
    expect(mockedWriteConfig).not.toHaveBeenCalled();
  });

  it("initializes schemas array when not present", async () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://" },
    ]);

    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;
    mockedGetSchemas.mockResolvedValue(["public"]);
    mockedGetTables.mockResolvedValue(["users"]);

    await syncSchema(config, mockConnMgr, "/tmp/config.yaml");
    expect(config.databases[0].schemas).toBeDefined();
    expect(config.databases[0].schemas!.length).toBeGreaterThan(0);
  });
});
