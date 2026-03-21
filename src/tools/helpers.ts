import type { DataDanConfig } from "../config/schema.js";
import type { ConnectionManager } from "../db/connection.js";
import { classifyQuery, type ClassifiedQuery } from "../permissions/classifier.js";
import { checkQueryPermission } from "../permissions/checker.js";

export interface McpToolResult {
  [x: string]: unknown;
  isError?: true;
  content: Array<{ type: "text"; text: string }>;
}

export function mcpError(message: string): McpToolResult {
  return {
    isError: true,
    content: [{ type: "text", text: message }],
  };
}

export function mcpSuccess(data: unknown): McpToolResult {
  return {
    content: [{ type: "text", text: JSON.stringify(data, null, 2) }],
  };
}

export function findDatabaseOrError(
  config: DataDanConfig,
  database_name: string,
): { dbConfig: DataDanConfig["databases"][0] } | { error: McpToolResult } {
  const dbConfig = config.databases.find((db) => db.name === database_name);
  if (!dbConfig) {
    return {
      error: mcpError(
        `Database '${database_name}' not found. Available databases: ${config.databases.map((db) => db.name).join(", ")}`,
      ),
    };
  }
  return { dbConfig };
}

/**
 * Classifies SQL, validates the statement type, and checks permissions.
 * Returns the classified query on success, or an MCP error response on failure.
 */
export function classifyAndAuthorize(
  config: DataDanConfig,
  databaseName: string,
  sql: string,
  allowedTypes: ClassifiedQuery["statementType"][],
  toolName: string,
): { classified: ClassifiedQuery } | { error: McpToolResult } {
  let classified: ClassifiedQuery;
  try {
    classified = classifyQuery(sql);
  } catch (error) {
    return { error: mcpError(`Failed to parse SQL: ${(error as Error).message}`) };
  }

  if (!allowedTypes.includes(classified.statementType)) {
    const allowed = allowedTypes.map((t) => t.toUpperCase()).join("/");
    return {
      error: mcpError(
        `Only ${allowed} statements are allowed in the ${toolName} tool. Got: ${classified.statementType.toUpperCase()}. Use the appropriate tool for ${classified.statementType} operations.`,
      ),
    };
  }

  const check = checkQueryPermission(config, databaseName, classified);
  if (!check.allowed) {
    return { error: check.error };
  }

  return { classified };
}

/**
 * Runs the full SQL tool pipeline: find DB, classify, authorize, execute.
 * Only the result formatter varies per tool.
 */
export async function executeSqlTool(
  config: DataDanConfig,
  connectionManager: ConnectionManager,
  database_name: string,
  sql: string,
  allowedTypes: ClassifiedQuery["statementType"][],
  toolName: string,
  formatResult: (result: { rows: unknown[]; rowCount: number | null; command: string; fields: Array<{ name: string; dataTypeID: number }> }, classified: ClassifiedQuery) => McpToolResult,
): Promise<McpToolResult> {
  const dbLookup = findDatabaseOrError(config, database_name);
  if ("error" in dbLookup) return dbLookup.error;

  const authResult = classifyAndAuthorize(config, database_name, sql, allowedTypes, toolName);
  if ("error" in authResult) return authResult.error;

  try {
    const pool = connectionManager.getPool(database_name);
    const result = await pool.query(sql);
    return formatResult(result, authResult.classified);
  } catch (error) {
    return mcpError(`Execution error: ${(error as Error).message}`);
  }
}
