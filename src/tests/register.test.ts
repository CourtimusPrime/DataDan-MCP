import { describe, it, expect, vi, beforeEach } from "vitest";
import { registerRegisterTool } from "../tools/register.js";

// Mock pg with a Pool class whose instances have mockable connect/end
const mockClient = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
vi.mock("pg", () => {
  class MockPool {
    connect = vi.fn().mockResolvedValue({ query: vi.fn().mockResolvedValue({}), release: vi.fn() });
    end = vi.fn().mockResolvedValue(undefined);
    query = vi.fn();
  }
  return { default: { Pool: MockPool } };
});

// Mock introspect
vi.mock("../db/introspect.js", () => ({
  getSchemas: vi.fn(),
  getTables: vi.fn(),
}));

// Mock parser
vi.mock("../config/parser.js", () => ({
  writeConfig: vi.fn(),
}));

import { getSchemas, getTables } from "../db/introspect.js";
import { writeConfig } from "../config/parser.js";

const mockedGetSchemas = vi.mocked(getSchemas);
const mockedGetTables = vi.mocked(getTables);
const mockedWriteConfig = vi.mocked(writeConfig);

function captureHandler(config: any, mockConnMgr: any, configPath: string) {
  let handler: any;
  const mockServer = {
    registerTool: vi.fn((_name, _def, h) => { handler = h; }),
  } as any;
  registerRegisterTool(mockServer, config, mockConnMgr, configPath);
  return handler;
}

describe("registerRegisterTool", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("rejects duplicate database names", async () => {
    const config = {
      name: "test",
      "default-permission": "read" as const,
      "hot-reload": false,
      databases: [{ name: "db1", connection_string: "pg://" }],
    };

    const handler = captureHandler(config, {} as any, "/tmp/config.yaml");
    const result = await handler({ database_name: "db1", connection_string: "pg://new" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("already registered");
  });

  it("registers a new database successfully", async () => {
    const config = {
      name: "test",
      "default-permission": "read" as const,
      "hot-reload": false,
      databases: [] as any[],
    };

    const mockConnMgr = { addPool: vi.fn() } as any;

    mockedGetSchemas.mockResolvedValue(["public"]);
    mockedGetTables.mockResolvedValue(["users", "orders"]);

    const handler = captureHandler(config, mockConnMgr, "/tmp/config.yaml");
    const result = await handler({ database_name: "newdb", connection_string: "pg://host/newdb" });

    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.status).toBe("success");
    expect(parsed.totalTables).toBe(2);
    expect(mockConnMgr.addPool).toHaveBeenCalledWith("newdb", "pg://host/newdb");
    expect(mockedWriteConfig).toHaveBeenCalled();
  });

  it("handles config persistence failure gracefully", async () => {
    const config = {
      name: "test",
      "default-permission": "read" as const,
      "hot-reload": false,
      databases: [] as any[],
    };

    const mockConnMgr = { addPool: vi.fn() } as any;

    mockedGetSchemas.mockResolvedValue([]);
    mockedGetTables.mockResolvedValue([]);
    mockedWriteConfig.mockImplementation(() => { throw new Error("disk full"); });

    const handler = captureHandler(config, mockConnMgr, "/tmp/config.yaml");
    const result = await handler({ database_name: "newdb", connection_string: "pg://host/newdb" });

    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("disk full");
  });
});
