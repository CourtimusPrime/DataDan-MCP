import pkg from "node-sql-parser";
const { Parser } = pkg;
import type { PermissionLevel } from "../config/schema.js";

export interface ClassifiedQuery {
  statementType: "select" | "insert" | "update" | "delete" | "ddl";
  requiredPermission: PermissionLevel;
  referencedTables: Array<{ schema: string; table: string }>;
}

const parser = new Parser();

const STATEMENT_TYPE_MAP: Record<string, ClassifiedQuery["statementType"]> = {
  select: "select",
  insert: "insert",
  update: "update",
  delete: "delete",
  create: "ddl",
  alter: "ddl",
  drop: "ddl",
  truncate: "ddl",
};

const PERMISSION_MAP: Record<ClassifiedQuery["statementType"], PermissionLevel> = {
  select: "read",
  insert: "write",
  update: "write",
  delete: "delete",
  ddl: "yolo",
};

/** Permission levels ordered from lowest to highest for comparison */
const PERMISSION_ORDER: PermissionLevel[] = ["none", "read", "write", "delete", "yolo"];

function higherPermission(a: PermissionLevel, b: PermissionLevel): PermissionLevel {
  return PERMISSION_ORDER.indexOf(a) >= PERMISSION_ORDER.indexOf(b) ? a : b;
}

function extractTables(sql: string): Array<{ schema: string; table: string }> {
  const tableList = parser.tableList(sql, { database: "PostgresQL" });
  const seen = new Set<string>();
  const tables: Array<{ schema: string; table: string }> = [];

  for (const entry of tableList) {
    // Format: "operation::schema::table"
    const parts = entry.split("::");
    const schema = parts[1] === "null" ? "public" : parts[1];
    const table = parts[2];
    const key = `${schema}.${table}`;
    if (!seen.has(key)) {
      seen.add(key);
      tables.push({ schema, table });
    }
  }

  return tables;
}

/**
 * Parses SQL and determines the statement type, required permission level,
 * and referenced tables.
 */
export function classifyQuery(sql: string): ClassifiedQuery {
  let ast: ReturnType<typeof parser.astify>;
  try {
    ast = parser.astify(sql, { database: "PostgresQL" });
  } catch (err) {
    throw new Error(
      `Failed to parse SQL: ${err instanceof Error ? err.message : String(err)}`
    );
  }

  const statements = Array.isArray(ast) ? ast : [ast];

  if (statements.length === 0) {
    throw new Error("Failed to parse SQL: empty statement");
  }

  let highestPermission: PermissionLevel = "none";
  let primaryStatementType: ClassifiedQuery["statementType"] | undefined;

  for (const stmt of statements) {
    const type = (stmt as { type: string }).type?.toLowerCase();
    const mapped = STATEMENT_TYPE_MAP[type];
    if (!mapped) {
      throw new Error(`Unsupported SQL statement type: '${type}'`);
    }

    if (!primaryStatementType) {
      primaryStatementType = mapped;
    }

    const perm = PERMISSION_MAP[mapped];
    highestPermission = higherPermission(highestPermission, perm);

    // If this statement requires a higher permission, it becomes the primary type
    if (PERMISSION_ORDER.indexOf(perm) > PERMISSION_ORDER.indexOf(PERMISSION_MAP[primaryStatementType])) {
      primaryStatementType = mapped;
    }
  }

  const referencedTables = extractTables(sql);

  return {
    statementType: primaryStatementType!,
    requiredPermission: highestPermission,
    referencedTables,
  };
}
