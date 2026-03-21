import type { DataDanConfig, SchemaConfig, TableConfig } from "../config/schema.js";
import { writeConfig } from "../config/parser.js";
import type { ConnectionManager } from "./connection.js";
import { getSchemas, getTables } from "./introspect.js";

export interface SyncSummary {
  added: { schemas: number; tables: number };
  removed: { schemas: number; tables: number };
}

export async function syncSchema(
  config: DataDanConfig,
  connectionManager: ConnectionManager,
  configPath: string,
): Promise<SyncSummary> {
  const summary: SyncSummary = {
    added: { schemas: 0, tables: 0 },
    removed: { schemas: 0, tables: 0 },
  };

  for (const dbConfig of config.databases) {
    let pool;
    try {
      pool = connectionManager.getPool(dbConfig.name);
    } catch {
      // Database not connected — skip
      continue;
    }

    let liveSchemas: string[];
    try {
      liveSchemas = await getSchemas(pool);
    } catch {
      // Introspection failed — skip this database
      continue;
    }

    const liveSchemaSet = new Set(liveSchemas);

    // Build a map of live tables per schema (parallel)
    const liveTablesMap = new Map<string, Set<string>>();
    const tableResults = await Promise.allSettled(
      liveSchemas.map(async (schemaName) => {
        const tables = await getTables(pool, schemaName);
        return { schemaName, tables };
      }),
    );
    for (const result of tableResults) {
      if (result.status === "fulfilled") {
        liveTablesMap.set(result.value.schemaName, new Set(result.value.tables));
      }
    }

    // Initialize schemas array if not present
    if (!dbConfig.schemas) {
      dbConfig.schemas = [];
    }

    // Remove schemas that no longer exist in the DB
    const schemasToRemove: number[] = [];
    for (let i = 0; i < dbConfig.schemas.length; i++) {
      const schemaConfig = dbConfig.schemas[i];
      if (!liveSchemaSet.has(schemaConfig.name)) {
        schemasToRemove.push(i);
        summary.removed.schemas++;
        summary.removed.tables += schemaConfig.tables?.length ?? 0;
      } else {
        // Schema exists — reconcile tables
        const liveTables = liveTablesMap.get(schemaConfig.name);
        if (!liveTables) continue;

        if (!schemaConfig.tables) {
          schemaConfig.tables = [];
        }

        // Remove tables that no longer exist
        const tablesToRemove: number[] = [];
        for (let j = 0; j < schemaConfig.tables.length; j++) {
          if (!liveTables.has(schemaConfig.tables[j].name)) {
            tablesToRemove.push(j);
            summary.removed.tables++;
          }
        }
        // Remove in reverse order to preserve indices
        for (let j = tablesToRemove.length - 1; j >= 0; j--) {
          schemaConfig.tables.splice(tablesToRemove[j], 1);
        }

        // Add new tables not in config
        const configTableNames = new Set(schemaConfig.tables.map((t) => t.name));
        for (const tableName of liveTables) {
          if (!configTableNames.has(tableName)) {
            const newTable: TableConfig = { name: tableName };
            schemaConfig.tables.push(newTable);
            summary.added.tables++;
          }
        }
      }
    }
    // Remove stale schemas in reverse order
    for (let i = schemasToRemove.length - 1; i >= 0; i--) {
      dbConfig.schemas.splice(schemasToRemove[i], 1);
    }

    // Add new schemas not in config
    const configSchemaNames = new Set(dbConfig.schemas.map((s) => s.name));
    for (const schemaName of liveSchemas) {
      if (!configSchemaNames.has(schemaName)) {
        const liveTables = liveTablesMap.get(schemaName);
        const newSchema: SchemaConfig = {
          name: schemaName,
          tables: liveTables
            ? [...liveTables].map((t) => ({ name: t }))
            : [],
        };
        dbConfig.schemas.push(newSchema);
        summary.added.schemas++;
        summary.added.tables += newSchema.tables?.length ?? 0;
      }
    }
  }

  // Only write if something changed
  const { added, removed } = summary;
  if (added.schemas > 0 || added.tables > 0 || removed.schemas > 0 || removed.tables > 0) {
    writeConfig(config, configPath);
  }

  return summary;
}
