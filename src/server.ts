import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { DataDanConfig } from "./config/schema.js";
import type { ConnectionManager } from "./db/connection.js";
import { loadConfig } from "./config/parser.js";
import { syncSchema } from "./db/sync.js";
import { registerListTools } from "./tools/list.js";
import { registerDescribeTool } from "./tools/describe.js";
import { registerQueryTool } from "./tools/query.js";
import { registerExecuteTool } from "./tools/execute.js";
import { registerDeleteTool } from "./tools/delete.js";
import { registerMigrationTool } from "./tools/migration.js";
import { registerDbmlTool } from "./tools/dbml.js";
import { registerRegisterTool } from "./tools/register.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/**
 * Installs hot-reload middleware by wrapping server.registerTool so that
 * every tool handler re-reads the config file and re-runs schema sync
 * before executing.
 */
function installHotReload(
  server: McpServer,
  config: DataDanConfig,
  connectionManager: ConnectionManager,
  configPath: string,
): void {
  let lastValidConfig: DataDanConfig = structuredClone(config);

  const originalRegisterTool = server.registerTool.bind(server);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, toolDef: any, handler: (...args: any[]) => any) => {
    const wrappedHandler = async (...args: any[]) => {
      try {
        const freshConfig = loadConfig(configPath);
        Object.assign(config, freshConfig);
        await syncSchema(config, connectionManager, configPath);
        lastValidConfig = structuredClone(config);
      } catch (error) {
        console.error(
          `[datadan] Hot-reload warning: ${(error as Error).message}. Using last valid config.`,
        );
        Object.assign(config, lastValidConfig);
      }
      return handler(...args);
    };
    return originalRegisterTool(name, toolDef, wrappedHandler as any);
  };
}

export function createServer(
  config: DataDanConfig,
  connectionManager: ConnectionManager,
  configPath?: string,
): McpServer {
  const server = new McpServer(
    { name: "datadan", version: pkg.version },
    { capabilities: { tools: {} } },
  );

  // When hot-reload is enabled and configPath is known, wrap every tool
  // handler so it re-reads the config before each invocation.
  if (config["hot-reload"] && configPath) {
    installHotReload(server, config, connectionManager, configPath);
  }

  registerListTools(server, config, connectionManager);
  registerDescribeTool(server, config, connectionManager);
  registerQueryTool(server, config, connectionManager);
  registerExecuteTool(server, config, connectionManager);
  registerDeleteTool(server, config, connectionManager);
  registerMigrationTool(server, config, connectionManager);
  registerDbmlTool(server, config, connectionManager);
  if (configPath) {
    registerRegisterTool(server, config, connectionManager, configPath);
  }

  return server;
}

export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();

  transport.onerror = (error: Error) => {
    console.error("[datadan] Transport error:", error.message);
  };

  await server.connect(transport);
}
