import { z } from "zod";
import { writeFileSync } from "node:fs";
import pg from "pg";
import yaml from "js-yaml";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { getSchemas, getTables } from "../db/introspect.js";

const { Pool } = pg;

export function registerRegisterTool(
  server: McpServer,
  config: DataDanConfig,
  connectionManager: ConnectionManager,
  configPath: string,
): void {
  server.registerTool(
    "register",
    {
      description:
        "Register a new database connection at runtime. Validates the connection, discovers schemas/tables, and persists the config.",
      inputSchema: {
        database_name: z.string().describe("Name for the new database"),
        connection_string: z
          .string()
          .describe("PostgreSQL connection string (e.g., postgresql://user:pass@host:5432/dbname)"),
      },
    },
    async ({ database_name, connection_string }) => {
      // Check if database already exists
      const existing = config.databases.find((db) => db.name === database_name);
      if (existing) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Database '${database_name}' is already registered.`,
            },
          ],
        };
      }

      // Validate connection by attempting to connect
      const testPool = new Pool({ connectionString: connection_string });
      try {
        const client = await testPool.connect();
        try {
          await client.query("SELECT 1");
        } finally {
          client.release();
        }
      } catch (error) {
        await testPool.end();
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Connection test failed for '${database_name}': ${(error as Error).message}`,
            },
          ],
        };
      }

      // Discover schemas and tables
      const defaultPermission = config["default-permission"];
      let discoveredSchemas: { name: string; tables: { name: string }[] }[];
      try {
        const schemaNames = await getSchemas(testPool);
        discoveredSchemas = [];
        for (const schemaName of schemaNames) {
          const tableNames = await getTables(testPool, schemaName);
          discoveredSchemas.push({
            name: schemaName,
            tables: tableNames.map((t) => ({ name: t })),
          });
        }
      } catch (error) {
        await testPool.end();
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Schema discovery failed for '${database_name}': ${(error as Error).message}`,
            },
          ],
        };
      }

      // Clean up test pool — ConnectionManager will create its own
      await testPool.end();

      // Build the new database config entry
      const newDbConfig = {
        name: database_name,
        connection_string,
        schemas: discoveredSchemas.map((s) => ({
          name: s.name,
          tables: s.tables.map((t) => ({ name: t.name })),
        })),
      };

      // Add to in-memory config
      config.databases.push(newDbConfig);

      // Add pool to ConnectionManager
      connectionManager.addPool(database_name, connection_string);

      // Write updated config back to YAML
      try {
        const yamlStr = yaml.dump(config, { lineWidth: -1, quotingType: '"' });
        writeFileSync(configPath, yamlStr, "utf-8");
      } catch (error) {
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text: `Database registered in-memory but failed to persist config: ${(error as Error).message}`,
            },
          ],
        };
      }

      const schemaNames = discoveredSchemas.map((s) => s.name);
      const totalTables = discoveredSchemas.reduce(
        (sum, s) => sum + s.tables.length,
        0,
      );

      return {
        content: [
          {
            type: "text" as const,
            text: JSON.stringify(
              {
                status: "success",
                database: database_name,
                defaultPermission,
                schemasDiscovered: schemaNames,
                totalTables,
                message: `Database '${database_name}' registered successfully with ${schemaNames.length} schemas and ${totalTables} tables. Default permission '${defaultPermission}' applies.`,
              },
              null,
              2,
            ),
          },
        ],
      };
    },
  );
}
