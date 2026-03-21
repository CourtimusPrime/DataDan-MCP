import { describe, it, expect, vi } from "vitest";
import { registerQueryTool } from "../tools/query.js";

describe("registerQueryTool", () => {
  it("registers the query tool and executes SELECT", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const mockResult = {
      rows: [{ id: 1, name: "Alice" }],
      rowCount: 1,
      command: "SELECT",
      fields: [{ name: "id", dataTypeID: 23 }, { name: "name", dataTypeID: 25 }],
    };
    const mockPool = { query: vi.fn().mockResolvedValue(mockResult) };
    const mockConnMgr = { getPool: vi.fn().mockReturnValue(mockPool) } as any;

    const config = {
      name: "test",
      "default-permission": "read" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://", permission: "read" as const }],
    };

    registerQueryTool(mockServer, config, mockConnMgr);
    expect(mockServer.registerTool).toHaveBeenCalledWith("query", expect.any(Object), expect.any(Function));

    const result = await registeredHandler({ database_name: "db1", sql: "SELECT * FROM users" });
    expect(result.isError).toBeUndefined();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.rows).toEqual([{ id: 1, name: "Alice" }]);
    expect(parsed.fields).toHaveLength(2);
  });

  it("rejects non-SELECT statements", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const config = {
      name: "test",
      "default-permission": "write" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://", permission: "write" as const }],
    };

    registerQueryTool(mockServer, config, {} as any);

    const result = await registeredHandler({ database_name: "db1", sql: "INSERT INTO users (name) VALUES ('x')" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("SELECT");
  });
});
