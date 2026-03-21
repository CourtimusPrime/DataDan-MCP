import { describe, it, expect, vi } from "vitest";
import { registerDbmlTool } from "../tools/dbml.js";

// Mock introspect
vi.mock("../db/introspect.js", () => ({
  getSchemas: vi.fn(),
  getTables: vi.fn(),
  getColumns: vi.fn(),
}));

// Mock fs writeFileSync
vi.mock("node:fs", () => ({
  writeFileSync: vi.fn(),
}));

import { getSchemas, getTables, getColumns } from "../db/introspect.js";

const mockedGetSchemas = vi.mocked(getSchemas);
const mockedGetTables = vi.mocked(getTables);
const mockedGetColumns = vi.mocked(getColumns);

function captureHandler(config: any, mockConnMgr: any) {
  let handler: any;
  const mockServer = {
    registerTool: vi.fn((_name, _def, h) => { handler = h; }),
  } as any;
  registerDbmlTool(mockServer, config, mockConnMgr);
  return handler;
}

const baseConfig = {
  name: "test",
  "default-permission": "read" as const,
  "hot-reload": false,
  databases: [{ name: "db1", connection_string: "pg://", permission: "read" as const }],
};

describe("registerDbmlTool", () => {
  it("exports DBML for accessible tables", async () => {
    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;

    mockedGetSchemas.mockResolvedValue(["public"]);
    mockedGetTables.mockResolvedValue(["users"]);
    mockedGetColumns.mockResolvedValue([
      { name: "id", dataType: "integer", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, isUnique: false, foreignKeyRef: null },
      { name: "name", dataType: "text", nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, isUnique: false, foreignKeyRef: null },
    ]);

    const handler = captureHandler(baseConfig, mockConnMgr);
    const result = await handler({ database_name: "db1" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tablesExported).toBe(1);
    expect(parsed.schemasExported).toBe(1);
  });

  it("includes foreign key references", async () => {
    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;

    mockedGetSchemas.mockResolvedValue(["public"]);
    mockedGetTables.mockResolvedValue(["orders"]);
    mockedGetColumns.mockResolvedValue([
      { name: "id", dataType: "integer", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, isUnique: false, foreignKeyRef: null },
      { name: "user_id", dataType: "integer", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: true, isUnique: false, foreignKeyRef: "public.users.id" },
    ]);

    const handler = captureHandler(baseConfig, mockConnMgr);
    const result = await handler({ database_name: "db1" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.referencesExported).toBe(1);
  });

  it("returns error for unknown database", async () => {
    const handler = captureHandler({ ...baseConfig, databases: [] }, {} as any);
    const result = await handler({ database_name: "missing" });
    expect(result.isError).toBe(true);
  });

  it("handles introspection errors", async () => {
    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;
    mockedGetSchemas.mockRejectedValue(new Error("timeout"));

    const handler = captureHandler(baseConfig, mockConnMgr);
    const result = await handler({ database_name: "db1" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("timeout");
  });

  it("skips tables with no columns", async () => {
    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;

    mockedGetSchemas.mockResolvedValue(["public"]);
    mockedGetTables.mockResolvedValue(["empty_table"]);
    mockedGetColumns.mockResolvedValue([]);

    const handler = captureHandler(baseConfig, mockConnMgr);
    const result = await handler({ database_name: "db1" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tablesExported).toBe(0);
  });
});
