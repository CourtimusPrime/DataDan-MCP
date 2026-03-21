import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { executeSqlTool, mcpSuccess } from "./helpers.js";

export function registerQueryTool(
  server: McpServer,
  config: DataDanConfig,
  connectionManager: ConnectionManager,
): void {
  server.registerTool(
    "query",
    {
      description:
        "Run a SELECT query against a database. Only SELECT statements are allowed.",
      inputSchema: {
        database_name: z.string().describe("Name of the database to query"),
        sql: z.string().describe("SQL SELECT statement to execute"),
      },
    },
    ({ database_name, sql }) =>
      executeSqlTool(config, connectionManager, database_name, sql, ["select"], "query", (result) =>
        mcpSuccess({
          rows: result.rows,
          rowCount: result.rowCount,
          fields: result.fields.map((f) => ({
            name: f.name,
            dataTypeID: f.dataTypeID,
          })),
        }),
      ),
  );
}
