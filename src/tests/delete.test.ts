import { describe, it, expect, vi } from "vitest";
import { registerDeleteTool } from "../tools/delete.js";

describe("registerDeleteTool", () => {
  it("registers and handles DELETE statements", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const mockResult = { rows: [], rowCount: 3, command: "DELETE", fields: [] };
    const mockPool = { query: vi.fn().mockResolvedValue(mockResult) };
    const mockConnMgr = { getPool: vi.fn().mockReturnValue(mockPool) } as any;

    const config = {
      name: "test",
      "default-permission": "delete" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://", permission: "delete" as const }],
    };

    registerDeleteTool(mockServer, config, mockConnMgr);

    const result = await registeredHandler({ database_name: "db1", sql: "DELETE FROM users WHERE id = 1" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.statement).toBe("DELETE");
    expect(parsed.rowCount).toBe(3);
  });

  it("rejects non-DELETE statements", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const config = {
      name: "test",
      "default-permission": "delete" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://" }],
    };

    registerDeleteTool(mockServer, config, {} as any);

    const result = await registeredHandler({ database_name: "db1", sql: "SELECT * FROM users" });
    expect(result.isError).toBe(true);
  });
});
