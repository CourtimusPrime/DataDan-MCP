import { createRequire } from "node:module";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import type { DataDanConfig } from "./config/schema.js";
import type { ConnectionManager } from "./db/connection.js";
import { registerListTools } from "./tools/list.js";
import { registerDescribeTool } from "./tools/describe.js";
import { registerQueryTool } from "./tools/query.js";
import { registerExecuteTool } from "./tools/execute.js";
import { registerDeleteTool } from "./tools/delete.js";
import { registerMigrationTool } from "./tools/migration.js";
import { registerDbmlTool } from "./tools/dbml.js";

const require = createRequire(import.meta.url);
const pkg = require("../package.json") as { version: string };

export function createServer(
  config: DataDanConfig,
  connectionManager: ConnectionManager,
): McpServer {
  const server = new McpServer(
    { name: "datadan", version: pkg.version },
    { capabilities: { tools: {} } },
  );

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
