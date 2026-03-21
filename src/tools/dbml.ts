import { z } from "zod";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { resolvePermission, resolveSchemaPermission } from "../config/resolver.js";
import { getSchemas, getTables, getColumns } from "../db/introspect.js";
import type { ColumnInfo } from "../db/introspect.js";
import { findDatabaseOrError, mcpError, mcpSuccess } from "./helpers.js";

function columnSettings(col: ColumnInfo): string {
  const settings: string[] = [];
  if (col.isPrimaryKey) settings.push("pk");
  if (!col.nullable) settings.push("not null");
  if (col.isUnique && !col.isPrimaryKey) settings.push("unique");
  if (col.defaultValue !== null) settings.push(`default: '${col.defaultValue}'`);
  return settings.length > 0 ? ` [${settings.join(", ")}]` : "";
}

export function registerDbmlTool(
  server: McpServer,
  config: DataDanConfig,
  connectionManager: ConnectionManager,
): void {
  server.registerTool(
    "dbml",
    {
      description: "Export the database structure as a DBML file for schema visualization",
      inputSchema: {
        database_name: z.string().describe("Name of the database to export"),
      },
    },
    async ({ database_name }) => {
      const dbLookup = findDatabaseOrError(config, database_name);
      if ("error" in dbLookup) return dbLookup.error;

      try {
        const pool = connectionManager.getPool(database_name);
        const schemas = await getSchemas(pool);

        const accessibleSchemas = schemas.filter(
          (schema) => resolveSchemaPermission(config, database_name, schema) !== "none",
        );

        const dbmlLines: string[] = [];
        const refs: string[] = [];
        let tableCount = 0;

        for (const schemaName of accessibleSchemas) {
          const tables = await getTables(pool, schemaName);
          const accessibleTables = tables.filter(
            (table) => resolvePermission(config, database_name, schemaName, table) !== "none",
          );

          for (const tableName of accessibleTables) {
            const columns = await getColumns(pool, schemaName, tableName);
            if (columns.length === 0) continue;

            tableCount++;
            dbmlLines.push(`Table ${schemaName}.${tableName} {`);

            for (const col of columns) {
              dbmlLines.push(`  ${col.name} ${col.dataType}${columnSettings(col)}`);
              if (col.isForeignKey && col.foreignKeyRef) {
                refs.push(`Ref: ${schemaName}.${tableName}.${col.name} > ${col.foreignKeyRef}`);
              }
            }

            dbmlLines.push("}");
            dbmlLines.push("");
          }
        }

        if (refs.length > 0) {
          dbmlLines.push("// References");
          for (const ref of refs) {
            dbmlLines.push(ref);
          }
          dbmlLines.push("");
        }

        const dbmlContent = dbmlLines.join("\n");
        const filePath = resolve(process.cwd(), `${database_name}.dbml`);
        writeFileSync(filePath, dbmlContent, "utf-8");

        return mcpSuccess({
          file: filePath,
          database: database_name,
          schemasExported: accessibleSchemas.length,
          tablesExported: tableCount,
          referencesExported: refs.length,
          summary: `Exported ${tableCount} table(s) across ${accessibleSchemas.length} schema(s) to ${filePath}`,
        });
      } catch (error) {
        return mcpError(`Error exporting DBML for database '${database_name}': ${(error as Error).message}`);
      }
    },
  );
}
