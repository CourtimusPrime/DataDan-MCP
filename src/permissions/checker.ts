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

  // Safety check: if we couldn't identify any tables and the operation is
  // mutating, deny by default rather than silently allowing.
  if (referencedTables.length === 0 && requiredPermission !== "read") {
    return {
      allowed: false,
      error: {
        isError: true,
        content: [
          {
            type: "text",
            text: "Could not determine target tables for this statement. Permission denied for safety.",
          },
        ],
      },
    };
  }

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
