import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { executeSqlTool, mcpSuccess } from "./helpers.js";

export function registerExecuteTool(
  server: McpServer,
  config: DataDanConfig,
  connectionManager: ConnectionManager,
): void {
  server.registerTool(
    "execute",
    {
      description:
        "Run an INSERT or UPDATE statement against a database. Only INSERT and UPDATE statements are allowed.",
      inputSchema: {
        database_name: z.string().describe("Name of the database to execute against"),
        sql: z.string().describe("SQL INSERT or UPDATE statement to execute"),
      },
    },
    ({ database_name, sql }) =>
      executeSqlTool(config, connectionManager, database_name, sql, ["insert", "update"], "execute", (result, classified) =>
        mcpSuccess({
          statement: classified.statementType.toUpperCase(),
          rowCount: result.rowCount,
        }),
      ),
  );
}
