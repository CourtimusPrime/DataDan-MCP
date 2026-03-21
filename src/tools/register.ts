import { z } from "zod";
import pg from "pg";
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { writeConfig } from "../config/parser.js";
import { getSchemas, getTables } from "../db/introspect.js";
import { mcpError, mcpSuccess } from "./helpers.js";

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
      const existing = config.databases.find((db) => db.name === database_name);
      if (existing) {
        return mcpError(`Database '${database_name}' is already registered.`);
      }

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
        return mcpError(`Connection test failed for '${database_name}': ${(error as Error).message}`);
      }

      let discoveredSchemas: { name: string; tables: { name: string }[] }[];
      try {
        const schemaNames = await getSchemas(testPool);
        discoveredSchemas = await Promise.all(
          schemaNames.map(async (schemaName) => {
            const tableNames = await getTables(testPool, schemaName);
            return { name: schemaName, tables: tableNames.map((t) => ({ name: t })) };
          }),
        );
      } catch (error) {
        await testPool.end();
        return mcpError(`Schema discovery failed for '${database_name}': ${(error as Error).message}`);
      }

      await testPool.end();

      const newDbConfig = {
        name: database_name,
        connection_string,
        schemas: discoveredSchemas,
      };

      config.databases.push(newDbConfig);
      connectionManager.addPool(database_name, connection_string);

      try {
        writeConfig(config, configPath);
      } catch (error) {
        return mcpError(`Database registered in-memory but failed to persist config: ${(error as Error).message}`);
      }

      const schemaNames = discoveredSchemas.map((s) => s.name);
      const totalTables = discoveredSchemas.reduce((sum, s) => sum + s.tables.length, 0);
      const defaultPermission = config["default-permission"];

      return mcpSuccess({
        status: "success",
        database: database_name,
        defaultPermission,
        schemasDiscovered: schemaNames,
        totalTables,
        message: `Database '${database_name}' registered successfully with ${schemaNames.length} schemas and ${totalTables} tables. Default permission '${defaultPermission}' applies.`,
      });
    },
  );
}
