import { statSync } from "node:fs";
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

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

/**
 * Installs hot-reload middleware by wrapping server.registerTool so that
 * every tool handler checks whether the config file has changed (by mtime)
 * and only re-reads + re-syncs when needed. Schema sync is also rate-limited
 * to avoid hammering remote databases on every call.
 */
function installHotReload(
  server: McpServer,
  config: DataDanConfig,
  connectionManager: ConnectionManager,
  configPath: string,
): void {
  let lastValidConfig: DataDanConfig = structuredClone(config);
  let lastConfigMtimeMs = 0;
  let lastSyncTime = Date.now(); // Startup already ran sync
  const SYNC_INTERVAL_MS = 30_000; // Only re-sync schema every 30s

  // Get initial mtime
  try {
    lastConfigMtimeMs = statSync(configPath).mtimeMs;
  } catch { /* ignore */ }

  const originalRegisterTool = server.registerTool.bind(server);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (server as any).registerTool = (name: string, toolDef: any, handler: (...args: any[]) => any) => {
    const wrappedHandler = async (...args: any[]) => {
      try {
        // Check if config file has actually changed
        let currentMtimeMs = lastConfigMtimeMs;
        try {
          currentMtimeMs = statSync(configPath).mtimeMs;
        } catch { /* ignore */ }

        const configChanged = currentMtimeMs !== lastConfigMtimeMs;
        const now = Date.now();
        const syncDue = (now - lastSyncTime) > SYNC_INTERVAL_MS;

        if (configChanged) {
          const freshConfig = loadConfig(configPath);
          Object.assign(config, freshConfig);
          lastConfigMtimeMs = currentMtimeMs;
        }

        if (configChanged || syncDue) {
          await syncSchema(config, connectionManager, configPath);
          lastSyncTime = now;
        }

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

  return server;
}

export async function startServer(server: McpServer): Promise<void> {
  const transport = new StdioServerTransport();

  transport.onerror = (error: Error) => {
    console.error("[datadan] Transport error:", error.message);
  };

  await server.connect(transport);
}
