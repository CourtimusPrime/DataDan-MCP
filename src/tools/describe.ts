import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { resolvePermission } from "../config/resolver.js";
import { getColumns } from "../db/introspect.js";
import { buildPermissionError } from "../permissions/errors.js";
import { findDatabaseOrError, mcpError, mcpSuccess } from "./helpers.js";

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
      const dbLookup = findDatabaseOrError(config, database_name);
      if ("error" in dbLookup) return dbLookup.error;

      const permission = resolvePermission(config, database_name, schema_name, table_name);
      if (permission === "none") {
        return buildPermissionError("describe_table", `${schema_name}.${table_name}`, "read", "none");
      }

      try {
        const pool = connectionManager.getPool(database_name);
        const columns = await getColumns(pool, schema_name, table_name);

        if (columns.length === 0) {
          return mcpError(`Table '${schema_name}.${table_name}' not found in database '${database_name}'.`);
        }

        return mcpSuccess({
          database: database_name,
          schema: schema_name,
          table: table_name,
          columns: columns.map((col) => {
            const constraints: string[] = [];
            if (col.isPrimaryKey) constraints.push("PRIMARY KEY");
            if (col.isForeignKey) constraints.push(`FOREIGN KEY -> ${col.foreignKeyRef}`);
            if (col.isUnique) constraints.push("UNIQUE");
            return { name: col.name, type: col.dataType, nullable: col.nullable, default: col.defaultValue, constraints };
          }),
        });
      } catch (error) {
        return mcpError(`Error describing table '${schema_name}.${table_name}' in database '${database_name}': ${(error as Error).message}`);
      }
    },
  );
}
