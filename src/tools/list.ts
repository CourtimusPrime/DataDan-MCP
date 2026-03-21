import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { resolvePermission, resolveSchemaPermission } from "../config/resolver.js";
import { getSchemas, getTables } from "../db/introspect.js";
import { findDatabaseOrError, mcpError, mcpSuccess } from "./helpers.js";

/**
 * Checks if a database has at least one target with permission >= read.
 */
function isDatabaseAccessible(config: DataDanConfig, dbName: string): boolean {
  const dbConfig = config.databases.find((db) => db.name === dbName);
  if (!dbConfig) return false;

  const dbPermission = dbConfig.permission ?? config["default-permission"];
  if (dbPermission !== "none") return true;

  if (dbConfig.schemas) {
    for (const schema of dbConfig.schemas) {
      if (schema.permission && schema.permission !== "none") return true;
      if (schema.tables) {
        for (const table of schema.tables) {
          if (table.permission && table.permission !== "none") return true;
        }
      }
    }
  }

  return false;
}

export function registerListTools(
  server: McpServer,
  config: DataDanConfig,
  connectionManager: ConnectionManager,
): void {
  server.registerTool(
    "list_databases",
    {
      description: "List all accessible databases configured in DataDan",
      inputSchema: {},
    },
    async () => {
      const accessibleDbs = config.databases
        .filter((db) => isDatabaseAccessible(config, db.name))
        .map((db) => db.name);
      return mcpSuccess({ databases: accessibleDbs });
    },
  );

  server.registerTool(
    "list_schemas",
    {
      description: "List accessible schemas in a database",
      inputSchema: {
        database_name: z.string().describe("Name of the database"),
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
        return mcpSuccess({ database: database_name, schemas: accessibleSchemas });
      } catch (error) {
        return mcpError(`Error listing schemas for database '${database_name}': ${(error as Error).message}`);
      }
    },
  );

  server.registerTool(
    "list_tables",
    {
      description: "List accessible tables in a database schema",
      inputSchema: {
        database_name: z.string().describe("Name of the database"),
        schema_name: z.string().describe("Name of the schema"),
      },
    },
    async ({ database_name, schema_name }) => {
      const dbLookup = findDatabaseOrError(config, database_name);
      if ("error" in dbLookup) return dbLookup.error;

      try {
        const pool = connectionManager.getPool(database_name);
        const tables = await getTables(pool, schema_name);

        if (tables.length === 0) {
          return mcpError(`Schema '${schema_name}' not found or has no tables in database '${database_name}'.`);
        }

        const accessibleTables = tables.filter(
          (table) => resolvePermission(config, database_name, schema_name, table) !== "none",
        );
        return mcpSuccess({ database: database_name, schema: schema_name, tables: accessibleTables });
      } catch (error) {
        return mcpError(`Error listing tables for '${database_name}.${schema_name}': ${(error as Error).message}`);
      }
    },
  );
}
