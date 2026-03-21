import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { classifyQuery } from "../permissions/classifier.js";
import { checkQueryPermission } from "../permissions/checker.js";

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

      // Reject non-INSERT/UPDATE statements
      if (classified.statementType !== "insert" && classified.statementType !== "update") {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Only INSERT and UPDATE statements are allowed in the execute tool. Got: ${classified.statementType.toUpperCase()}. Use the appropriate tool for ${classified.statementType} operations.`,
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
                  statement: classified.statementType.toUpperCase(),
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
