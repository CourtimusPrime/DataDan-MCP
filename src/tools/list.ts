import { z } from "zod";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { resolvePermission } from "../config/resolver.js";
import { getSchemas, getTables } from "../db/introspect.js";

/**
 * Checks if a database has at least one target with permission >= read.
 */
function isDatabaseAccessible(config: DataDanConfig, dbName: string): boolean {
  const dbConfig = config.databases.find((db) => db.name === dbName);
  if (!dbConfig) return false;

  // If the database-level effective permission is not 'none', it's accessible
  const dbPermission = dbConfig.permission ?? config["default-permission"];
  if (dbPermission !== "none") return true;

  // Database default is 'none' — check for schema/table overrides
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

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify({ databases: accessibleDbs }, null, 2),
          },
        ],
      };
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

        const accessibleSchemas = schemas.filter((schema) => {
          const permission = getSchemaPermission(config, database_name, schema);
          return permission !== "none";
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ database: database_name, schemas: accessibleSchemas }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Error listing schemas for database '${database_name}': ${(error as Error).message}`,
            },
          ],
        };
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
        const tables = await getTables(pool, schema_name);

        if (tables.length === 0) {
          return {
            isError: true as const,
            content: [
              {
                type: "text" as const,
                text: `Schema '${schema_name}' not found or has no tables in database '${database_name}'.`,
              },
            ],
          };
        }

        const accessibleTables = tables.filter((table) => {
          const permission = resolvePermission(config, database_name, schema_name, table);
          return permission !== "none";
        });

        return {
          content: [
            {
              type: "text" as const,
              text: JSON.stringify({ database: database_name, schema: schema_name, tables: accessibleTables }, null, 2),
            },
          ],
        };
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Error listing tables for '${database_name}.${schema_name}': ${(error as Error).message}`,
            },
          ],
        };
      }
    },
  );
}
