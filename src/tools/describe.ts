import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { resolvePermission } from "../config/resolver.js";
import { getColumns } from "../db/introspect.js";
import { buildPermissionError } from "../permissions/errors.js";

export function registerDescribeTool(
  server: McpServer,
  config: DataDanConfig,
  connectionManager: ConnectionManager,
): void {
  server.registerTool(
    "describe_table",
    {
      description: "Describe the columns, types, and constraints of a table",
      inputSchema: {
        database_name: z.string().describe("Name of the database"),
        schema_name: z.string().describe("Name of the schema"),
        table_name: z.string().describe("Name of the table"),
      },
    },
    async ({ database_name, schema_name, table_name }) => {
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

      // Check permission >= read
      const permission = resolvePermission(config, database_name, schema_name, table_name);
      if (permission === "none") {
        const error = buildPermissionError(
          "describe_table",
          `${schema_name}.${table_name}`,
          "read",
          "none",
        );
        return { ...error };
      }

      try {
        const pool = connectionManager.getPool(database_name);
        const columns = await getColumns(pool, schema_name, table_name);

        if (columns.length === 0) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Table '${schema_name}.${table_name}' not found in database '${database_name}'.`,
              },
            ],
          };
        }

        const result = {
          database: database_name,
          schema: schema_name,
          table: table_name,
          columns: columns.map((col) => {
            const constraints: string[] = [];
            if (col.isPrimaryKey) constraints.push("PRIMARY KEY");
            if (col.isForeignKey) constraints.push(`FOREIGN KEY -> ${col.foreignKeyRef}`);
            if (col.isUnique) constraints.push("UNIQUE");

            return {
              name: col.name,
              type: col.dataType,
              nullable: col.nullable,
              default: col.defaultValue,
              constraints,
            };
          }),
        };

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(result, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Error describing table '${schema_name}.${table_name}' in database '${database_name}': ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  );
}
