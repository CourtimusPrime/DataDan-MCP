import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { classifyQuery } from "../permissions/classifier.js";
import { checkQueryPermission } from "../permissions/checker.js";

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
    async ({ database_name, sql }) => {
      // Check database exists in config
      const dbConfig = config.databases.find((db) => db.name === database_name);
      if (!dbConfig) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Database '${database_name}' not found. Available databases: ${config.databases.map((db) => db.name).join(", ")}`,
            },
          ],
        };
      }

      // Classify the SQL
      let classified;
      try {
        classified = classifyQuery(sql);
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Failed to parse SQL: ${(error as Error).message}`,
            },
          ],
        };
      }

      // Reject non-DDL statements
      if (classified.statementType !== "ddl") {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Only DDL statements (CREATE, ALTER, DROP, TRUNCATE) are allowed in the run_migration tool. Got: ${classified.statementType.toUpperCase()}. Use the appropriate tool for ${classified.statementType} operations.`,
            },
          ],
        };
      }

      // Check permissions on all referenced tables
      const check = checkQueryPermission(config, database_name, classified);
      if (!check.allowed) {
        return { ...check.error };
      }

      // Execute the statement
      try {
        const pool = connectionManager.getPool(database_name);
        const result = await pool.query(sql);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  statement: "DDL",
                  command: result.command,
                  rowCount: result.rowCount,
                },
                null,
                2,
              ),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Execution error: ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  );
}
