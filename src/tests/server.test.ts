import { describe, it, expect, vi } from "vitest";
import { createServer, startServer } from "../server.js";
import type { DataDanConfig } from "../config/schema.js";

// Mock all tool registration modules
vi.mock("../tools/list.js", () => ({ registerListTools: vi.fn() }));
vi.mock("../tools/describe.js", () => ({ registerDescribeTool: vi.fn() }));
vi.mock("../tools/query.js", () => ({ registerQueryTool: vi.fn() }));
vi.mock("../tools/execute.js", () => ({ registerExecuteTool: vi.fn() }));
vi.mock("../tools/delete.js", () => ({ registerDeleteTool: vi.fn() }));
vi.mock("../tools/migration.js", () => ({ registerMigrationTool: vi.fn() }));
vi.mock("../tools/dbml.js", () => ({ registerDbmlTool: vi.fn() }));
vi.mock("../tools/register.js", () => ({ registerRegisterTool: vi.fn() }));
vi.mock("../db/sync.js", () => ({ syncSchema: vi.fn().mockResolvedValue({}) }));
vi.mock("../config/parser.js", () => ({ loadConfig: vi.fn() }));
vi.mock("@modelcontextprotocol/sdk/server/stdio.js", () => {
  class MockTransport { onerror: any = null; }
  return { StdioServerTransport: MockTransport };
});

import { registerListTools } from "../tools/list.js";
import { registerDescribeTool } from "../tools/describe.js";
import { registerQueryTool } from "../tools/query.js";
import { registerExecuteTool } from "../tools/execute.js";
import { registerDeleteTool } from "../tools/delete.js";
import { registerMigrationTool } from "../tools/migration.js";
import { registerDbmlTool } from "../tools/dbml.js";
import { registerRegisterTool } from "../tools/register.js";

function makeConfig(overrides: Partial<DataDanConfig> = {}): DataDanConfig {
  return {
    name: "test",
    "default-permission": "read",
    "hot-reload": false,
    databases: [],
    ...overrides,
  };
}

describe("createServer", () => {
  it("creates an MCP server and registers all tools", () => {
    const config = makeConfig();
    const mockConnMgr = {} as any;
    const server = createServer(config, mockConnMgr);

    expect(server).toBeDefined();
    expect(registerListTools).toHaveBeenCalledWith(server, config, mockConnMgr);
    expect(registerDescribeTool).toHaveBeenCalledWith(server, config, mockConnMgr);
    expect(registerQueryTool).toHaveBeenCalledWith(server, config, mockConnMgr);
    expect(registerExecuteTool).toHaveBeenCalledWith(server, config, mockConnMgr);
    expect(registerDeleteTool).toHaveBeenCalledWith(server, config, mockConnMgr);
    expect(registerMigrationTool).toHaveBeenCalledWith(server, config, mockConnMgr);
    expect(registerDbmlTool).toHaveBeenCalledWith(server, config, mockConnMgr);
  });

  it("registers the register tool when configPath is provided", () => {
    const config = makeConfig();
    const mockConnMgr = {} as any;
    createServer(config, mockConnMgr, "/path/to/config.yaml");

    expect(registerRegisterTool).toHaveBeenCalledWith(
      expect.anything(), config, mockConnMgr, "/path/to/config.yaml"
    );
  });

  it("does not register the register tool without configPath", () => {
    const config = makeConfig();
    const mockConnMgr = {} as any;
    vi.mocked(registerRegisterTool).mockClear();
    createServer(config, mockConnMgr);

    expect(registerRegisterTool).not.toHaveBeenCalled();
  });

  it("installs hot-reload when enabled and configPath provided", () => {
    const config = makeConfig({ "hot-reload": true });
    const mockConnMgr = {} as any;
    // Hot-reload wraps registerTool, so all tools still get registered
    const server = createServer(config, mockConnMgr, "/path/config.yaml");
    expect(server).toBeDefined();
    expect(registerListTools).toHaveBeenCalled();
  });

  it("does not install hot-reload when disabled", () => {
    const config = makeConfig({ "hot-reload": false });
    const mockConnMgr = {} as any;
    const server = createServer(config, mockConnMgr, "/path/config.yaml");
    expect(server).toBeDefined();
  });

  it("does not install hot-reload without configPath", () => {
    const config = makeConfig({ "hot-reload": true });
    const mockConnMgr = {} as any;
    const server = createServer(config, mockConnMgr);
    expect(server).toBeDefined();
  });
});

describe("startServer", () => {
  it("connects server to transport", async () => {
    const config = makeConfig();
    const mockConnMgr = {} as any;
    const server = createServer(config, mockConnMgr);
    // Mock server.connect
    server.connect = vi.fn().mockResolvedValue(undefined);
    await startServer(server);
    expect(server.connect).toHaveBeenCalled();
  });
});
