import type { DataDanConfig, PermissionLevel } from "./schema.js";

/**
 * Maps each permission level to the SQL operations it allows.
 * Each higher level includes all operations from lower levels.
 */
export const PERMISSION_HIERARCHY: Record<PermissionLevel, string[]> = {
  none: [],
  read: ["SELECT"],
  write: ["SELECT", "INSERT", "UPDATE"],
  delete: ["SELECT", "INSERT", "UPDATE", "DELETE"],
  yolo: ["SELECT", "INSERT", "UPDATE", "DELETE", "CREATE", "ALTER", "DROP", "TRUNCATE"],
};

/**
 * Resolves the effective permission for a specific table by cascading:
 * table-level -> schema-level -> database-level -> config default-permission
 */
export function resolvePermission(
  config: DataDanConfig,
  database: string,
  schema: string,
  table: string,
): PermissionLevel {
  const dbConfig = config.databases.find((db) => db.name === database);
  if (!dbConfig) {
    return config["default-permission"];
  }

  const schemaConfig = dbConfig.schemas?.find((s) => s.name === schema);
  if (!schemaConfig) {
    return dbConfig.permission ?? config["default-permission"];
  }

  const tableConfig = schemaConfig.tables?.find((t) => t.name === table);
  if (!tableConfig) {
    return schemaConfig.permission ?? dbConfig.permission ?? config["default-permission"];
  }

  return tableConfig.permission ?? schemaConfig.permission ?? dbConfig.permission ?? config["default-permission"];
}
