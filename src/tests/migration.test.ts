import { describe, it, expect, vi } from "vitest";
import { registerMigrationTool } from "../tools/migration.js";

describe("registerMigrationTool", () => {
  it("registers and handles DDL statements", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const mockResult = { rows: [], rowCount: 0, command: "CREATE", fields: [] };
    const mockPool = { query: vi.fn().mockResolvedValue(mockResult) };
    const mockConnMgr = { getPool: vi.fn().mockReturnValue(mockPool) } as any;

    const config = {
      name: "test",
      "default-permission": "yolo" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://", permission: "yolo" as const }],
    };

    registerMigrationTool(mockServer, config, mockConnMgr);

    const result = await registeredHandler({ database_name: "db1", sql: "CREATE TABLE test (id serial PRIMARY KEY)" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.statement).toBe("DDL");
    expect(parsed.command).toBe("CREATE");
  });

  it("rejects non-DDL statements", async () => {
    let registeredHandler: any;
    const mockServer = {
      registerTool: vi.fn((_name, _def, handler) => { registeredHandler = handler; }),
    } as any;

    const config = {
      name: "test",
      "default-permission": "yolo" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://" }],
    };

    registerMigrationTool(mockServer, config, {} as any);

    const result = await registeredHandler({ database_name: "db1", sql: "SELECT * FROM users" });
    expect(result.isError).toBe(true);
  });
});
