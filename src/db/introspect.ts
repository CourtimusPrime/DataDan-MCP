import pg from "pg";

export interface ColumnInfo {
  name: string;
  dataType: string;
  nullable: boolean;
  defaultValue: string | null;
  isPrimaryKey: boolean;
  isForeignKey: boolean;
  isUnique: boolean;
  foreignKeyRef: string | null;
}

export async function getSchemas(pool: pg.Pool): Promise<string[]> {
  const result = await pool.query(
    `SELECT schema_name FROM information_schema.schemata
     WHERE schema_name NOT LIKE 'pg_%'
       AND schema_name <> 'information_schema'
     ORDER BY schema_name`,
  );
  return result.rows.map((row: { schema_name: string }) => row.schema_name);
}

export async function getTables(pool: pg.Pool, schemaName: string): Promise<string[]> {
  const result = await pool.query(
    `SELECT table_name FROM information_schema.tables
     WHERE table_schema = $1
       AND table_type = 'BASE TABLE'
     ORDER BY table_name`,
    [schemaName],
  );
  return result.rows.map((row: { table_name: string }) => row.table_name);
}

export async function getColumns(
  pool: pg.Pool,
  schemaName: string,
  tableName: string,
): Promise<ColumnInfo[]> {
  // Get basic column info
  const columnsResult = await pool.query(
    `SELECT
       c.column_name,
       c.data_type,
       c.is_nullable,
       c.column_default
     FROM information_schema.columns c
     WHERE c.table_schema = $1
       AND c.table_name = $2
     ORDER BY c.ordinal_position`,
    [schemaName, tableName],
  );

  // Get primary key columns
  const pkResult = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'PRIMARY KEY'`,
    [schemaName, tableName],
  );
  const pkColumns = new Set(pkResult.rows.map((row: { column_name: string }) => row.column_name));

  // Get unique constraint columns
  const uniqueResult = await pool.query(
    `SELECT kcu.column_name
     FROM information_schema.table_constraints tc
     JOIN information_schema.key_column_usage kcu
       ON tc.constraint_name = kcu.constraint_name
       AND tc.table_schema = kcu.table_schema
     WHERE tc.table_schema = $1
       AND tc.table_name = $2
       AND tc.constraint_type = 'UNIQUE'`,
    [schemaName, tableName],
  );
  const uniqueColumns = new Set(uniqueResult.rows.map((row: { column_name: string }) => row.column_name));

  // Get foreign key columns with references
  const fkResult = await pool.query(
    `SELECT
       kcu.column_name,
       ccu.table_schema AS foreign_schema,
       ccu.table_name AS foreign_table,
       ccu.column_name AS foreign_column
     FROM information_schema.key_column_usage kcu
     JOIN information_schema.referential_constraints rc
       ON kcu.constraint_name = rc.constraint_name
       AND kcu.constraint_schema = rc.constraint_schema
     JOIN information_schema.key_column_usage ccu
       ON rc.unique_constraint_name = ccu.constraint_name
       AND rc.unique_constraint_schema = ccu.constraint_schema
     WHERE kcu.table_schema = $1
       AND kcu.table_name = $2`,
    [schemaName, tableName],
  );
  const fkMap = new Map<string, string>();
  for (const row of fkResult.rows) {
    fkMap.set(
      row.column_name,
      `${row.foreign_schema}.${row.foreign_table}.${row.foreign_column}`,
    );
  }

  return columnsResult.rows.map((row: { column_name: string; data_type: string; is_nullable: string; column_default: string | null }) => ({
    name: row.column_name,
    dataType: row.data_type,
    nullable: row.is_nullable === "YES",
    defaultValue: row.column_default,
    isPrimaryKey: pkColumns.has(row.column_name),
    isForeignKey: fkMap.has(row.column_name),
    isUnique: uniqueColumns.has(row.column_name),
    foreignKeyRef: fkMap.get(row.column_name) ?? null,
  }));
}
