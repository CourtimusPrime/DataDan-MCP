import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { executeSqlTool, mcpSuccess } from "./helpers.js";

export function registerMigrationTool(
  server: McpServer,
  config: DataDanConfig,
  connectionManager: ConnectionManager,
): void {
  server.registerTool(
    "run_migration",
    {
      description:
        "Run a DDL statement (CREATE, ALTER, DROP, TRUNCATE) against a database. Requires 'yolo' permission on referenced targets.",
      inputSchema: {
        database_name: z.string().describe("Name of the database to run the migration against"),
        sql: z.string().describe("SQL DDL statement to execute (CREATE, ALTER, DROP, TRUNCATE)"),
      },
    },
    ({ database_name, sql }) =>
      executeSqlTool(config, connectionManager, database_name, sql, ["ddl"], "run_migration", (result) =>
        mcpSuccess({
          statement: "DDL",
          command: result.command,
          rowCount: result.rowCount,
        }),
      ),
  );
}
