import type { DataDanConfig } from "../config/schema.js";
import { resolvePermission, PERMISSION_HIERARCHY } from "../config/resolver.js";
import type { ClassifiedQuery } from "./classifier.js";
import { buildPermissionError, type McpError } from "./errors.js";

export type CheckResult =
  | { allowed: true }
  | { allowed: false; error: McpError };

/**
 * Checks a classified query against resolved permissions for all referenced tables.
 * Returns { allowed: true } if every table has sufficient permission,
 * or { allowed: false, error } with an MCP error for the first blocking table.
 */
export function checkQueryPermission(
  config: DataDanConfig,
  databaseName: string,
  classifiedQuery: ClassifiedQuery,
): CheckResult {
  const { requiredPermission, referencedTables } = classifiedQuery;

  for (const { schema, table } of referencedTables) {
    const currentLevel = resolvePermission(config, databaseName, schema, table);
    const allowedOps = PERMISSION_HIERARCHY[currentLevel];
    const requiredOps = PERMISSION_HIERARCHY[requiredPermission];

    // Check that the current permission level covers all operations the query requires
    const hasSufficientPermission = requiredOps.every((op) => allowedOps.includes(op));

    if (!hasSufficientPermission) {
      return {
        allowed: false,
        error: buildPermissionError(
          classifiedQuery.statementType,
          `${schema}.${table}`,
          requiredPermission,
          currentLevel,
        ),
      };
    }
  }

  return { allowed: true };
}
