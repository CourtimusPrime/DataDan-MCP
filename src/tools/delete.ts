import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { executeSqlTool, mcpSuccess } from "./helpers.js";

export function registerDeleteTool(
  server: McpServer,
  config: DataDanConfig,
  connectionManager: ConnectionManager,
): void {
  server.registerTool(
    "delete",
    {
      description:
        "Run a DELETE statement against a database. Only DELETE statements are allowed.",
      inputSchema: {
        database_name: z.string().describe("Name of the database to delete from"),
        sql: z.string().describe("SQL DELETE statement to execute"),
      },
    },
    ({ database_name, sql }) =>
      executeSqlTool(config, connectionManager, database_name, sql, ["delete"], "delete", (result) =>
        mcpSuccess({
          statement: "DELETE",
          rowCount: result.rowCount,
        }),
      ),
  );
}
