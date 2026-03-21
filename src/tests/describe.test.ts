import { describe, it, expect, vi } from "vitest";
import { registerDescribeTool } from "../tools/describe.js";

// Mock introspect
vi.mock("../db/introspect.js", () => ({
  getColumns: vi.fn(),
}));

import { getColumns } from "../db/introspect.js";
const mockedGetColumns = vi.mocked(getColumns);

describe("registerDescribeTool", () => {
  it("registers and describes a table with columns", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const mockPool = {};
    const mockConnMgr = { getPool: vi.fn().mockReturnValue(mockPool) } as any;

    const config = {
      name: "test",
      "default-permission": "read" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://", permission: "read" as const }],
    };

    mockedGetColumns.mockResolvedValue([
      { name: "id", dataType: "integer", nullable: false, defaultValue: null, isPrimaryKey: true, isForeignKey: false, isUnique: false, foreignKeyRef: null },
      { name: "name", dataType: "text", nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: false, isUnique: false, foreignKeyRef: null },
      { name: "org_id", dataType: "integer", nullable: true, defaultValue: null, isPrimaryKey: false, isForeignKey: true, isUnique: false, foreignKeyRef: "public.orgs.id" },
      { name: "email", dataType: "text", nullable: false, defaultValue: null, isPrimaryKey: false, isForeignKey: false, isUnique: true, foreignKeyRef: null },
    ]);

    registerDescribeTool(mockServer, config, mockConnMgr);

    const result = await registeredHandler({ database_name: "db1", schema_name: "public", table_name: "users" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.columns).toHaveLength(4);
    expect(parsed.columns[0].constraints).toContain("PRIMARY KEY");
    expect(parsed.columns[2].constraints).toContain("FOREIGN KEY -> public.orgs.id");
    expect(parsed.columns[3].constraints).toContain("UNIQUE");
  });

  it("returns error when table not found (no columns)", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;

    const config = {
      name: "test",
      "default-permission": "read" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://", permission: "read" as const }],
    };

    mockedGetColumns.mockResolvedValue([]);

    registerDescribeTool(mockServer, config, mockConnMgr);

    const result = await registeredHandler({ database_name: "db1", schema_name: "public", table_name: "nonexistent" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("returns permission error when permission is none", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const config = {
      name: "test",
      "default-permission": "none" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://", permission: "none" as const }],
    };

    registerDescribeTool(mockServer, config, {} as any);

    const result = await registeredHandler({ database_name: "db1", schema_name: "public", table_name: "users" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("Permission denied");
  });

  it("returns error when database not found", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const config = {
      name: "test",
      "default-permission": "read" as const,
      "hot-reload": false,
      databases: [],
    };

    registerDescribeTool(mockServer, config, {} as any);

    const result = await registeredHandler({ database_name: "missing", schema_name: "public", table_name: "users" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("handles introspection errors gracefully", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const mockConnMgr = { getPool: vi.fn().mockReturnValue({}) } as any;

    const config = {
      name: "test",
      "default-permission": "read" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://", permission: "read" as const }],
    };

    mockedGetColumns.mockRejectedValue(new Error("connection lost"));

    registerDescribeTool(mockServer, config, mockConnMgr);

    const result = await registeredHandler({ database_name: "db1", schema_name: "public", table_name: "users" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("connection lost");
  });
});
