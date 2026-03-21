import { describe, it, expect, vi } from "vitest";
import { registerExecuteTool } from "../tools/execute.js";

describe("registerExecuteTool", () => {
  it("registers the execute tool and handles INSERT", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const mockResult = { rows: [], rowCount: 1, command: "INSERT", fields: [] };
    const mockPool = { query: vi.fn().mockResolvedValue(mockResult) };
    const mockConnMgr = { getPool: vi.fn().mockReturnValue(mockPool) } as any;

    const config = {
      name: "test",
      "default-permission": "write" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://", permission: "write" as const }],
    };

    registerExecuteTool(mockServer, config, mockConnMgr);
    expect(mockServer.registerTool).toHaveBeenCalledWith("execute", expect.any(Object), expect.any(Function));

    const result = await registeredHandler({ database_name: "db1", sql: "INSERT INTO users (name) VALUES ('x')" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.statement).toBe("INSERT");
    expect(parsed.rowCount).toBe(1);
  });

  it("rejects SELECT statements", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const config = {
      name: "test",
      "default-permission": "read" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://" }],
    };

    registerExecuteTool(mockServer, config, {} as any);

    const result = await registeredHandler({ database_name: "db1", sql: "SELECT * FROM users" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("INSERT/UPDATE");
  });
});
