import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { classifyQuery } from "../permissions/classifier.js";
import { checkQueryPermission } from "../permissions/checker.js";

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

      // Reject non-SELECT statements
      if (classified.statementType !== "select") {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Only SELECT statements are allowed in the query tool. Got: ${classified.statementType.toUpperCase()}. Use the appropriate tool for ${classified.statementType} operations.`,
            },
          ],
        };
      }

      // Check permissions on all referenced tables
      const check = checkQueryPermission(config, database_name, classified);
      if (!check.allowed) {
        return { ...check.error };
      }

      // Execute the query
      try {
        const pool = connectionManager.getPool(database_name);
        const result = await pool.query(sql);

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  rows: result.rows,
                  rowCount: result.rowCount,
                  fields: result.fields.map((f) => ({
                    name: f.name,
                    dataTypeID: f.dataTypeID,
                  })),
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
              text: `Query execution error: ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  );
}
