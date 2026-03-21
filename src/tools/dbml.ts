import { z } from "zod";
import { writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { resolvePermission } from "../config/resolver.js";
import { getSchemas, getTables, getColumns } from "../db/introspect.js";
import type { ColumnInfo } from "../db/introspect.js";

/**
 * Resolves the effective permission for a schema (without a specific table).
 */
function getSchemaPermission(config: DataDanConfig, dbName: string, schemaName: string): string {
  const dbConfig = config.databases.find((db) => db.name === dbName);
  if (!dbConfig) return config["default-permission"];

  const schemaConfig = dbConfig.schemas?.find((s) => s.name === schemaName);
  if (!schemaConfig) return dbConfig.permission ?? config["default-permission"];

  return schemaConfig.permission ?? dbConfig.permission ?? config["default-permission"];
}

/**
 * Maps a PostgreSQL data type to a DBML-friendly type string.
 */
function mapDbmlType(dataType: string): string {
  return dataType;
}

/**
 * Generates a DBML column settings string (e.g., [pk, not null, default: 'value']).
 */
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

      try {
        const pool = connectionManager.getPool(database_name);
        const schemas = await getSchemas(pool);

        // Filter to accessible schemas
        const accessibleSchemas = schemas.filter((schema) => {
          const permission = getSchemaPermission(config, database_name, schema);
          return permission !== "none";
        });

        const dbmlLines: string[] = [];
        const refs: string[] = [];
        let tableCount = 0;

        for (const schemaName of accessibleSchemas) {
          const tables = await getTables(pool, schemaName);

          // Filter to accessible tables
          const accessibleTables = tables.filter((table) => {
            const permission = resolvePermission(config, database_name, schemaName, table);
            return permission !== "none";
          });

          for (const tableName of accessibleTables) {
            const columns = await getColumns(pool, schemaName, tableName);
            if (columns.length === 0) continue;

            tableCount++;
            dbmlLines.push(`Table ${schemaName}.${tableName} {`);

            for (const col of columns) {
              dbmlLines.push(`  ${col.name} ${mapDbmlType(col.dataType)}${columnSettings(col)}`);

              // Collect foreign key references
              if (col.isForeignKey && col.foreignKeyRef) {
                refs.push(`Ref: ${schemaName}.${tableName}.${col.name} > ${col.foreignKeyRef}`);
              }
            }

            dbmlLines.push("}");
            dbmlLines.push("");
          }
        }

        // Append references at the end
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

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify(
                {
                  file: filePath,
                  database: database_name,
                  schemasExported: accessibleSchemas.length,
                  tablesExported: tableCount,
                  referencesExported: refs.length,
                  summary: `Exported ${tableCount} table(s) across ${accessibleSchemas.length} schema(s) to ${filePath}`,
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
              text: `Error exporting DBML for database '${database_name}': ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  );
}
