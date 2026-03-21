import { describe, it, expect, vi } from "vitest";
import { getSchemas, getTables, getColumns } from "../db/introspect.js";

function mockPool(queryResults: Record<string, { rows: any[] }>) {
  let callIndex = 0;
  const queryFn = vi.fn().mockImplementation((sql: string, _params?: any[]) => {
    // For getColumns which calls query 4 times in parallel
    // We identify queries by order or SQL content
    for (const [key, value] of Object.entries(queryResults)) {
      if (sql.includes(key)) {
        return Promise.resolve(value);
      }
    }
    // Fallback: return empty
    return Promise.resolve({ rows: [] });
  });
  return { query: queryFn } as any;
}

describe("getSchemas", () => {
  it("returns schema names excluding system schemas", async () => {
    const pool = mockPool({
      "information_schema.schemata": {
        rows: [
          { schema_name: "public" },
          { schema_name: "analytics" },
        ],
      },
    });

    const schemas = await getSchemas(pool);
    expect(schemas).toEqual(["public", "analytics"]);
  });

  it("returns empty array when no schemas", async () => {
    const pool = mockPool({
      "information_schema.schemata": { rows: [] },
    });
    const schemas = await getSchemas(pool);
    expect(schemas).toEqual([]);
  });
});

describe("getTables", () => {
  it("returns table names for a schema", async () => {
    const pool = mockPool({
      "information_schema.tables": {
        rows: [
          { table_name: "users" },
          { table_name: "orders" },
        ],
      },
    });

    const tables = await getTables(pool, "public");
    expect(tables).toEqual(["users", "orders"]);
    expect(pool.query).toHaveBeenCalledWith(
      expect.stringContaining("table_schema = $1"),
      ["public"],
    );
  });

  it("returns empty array when no tables", async () => {
    const pool = mockPool({
      "information_schema.tables": { rows: [] },
    });
    const tables = await getTables(pool, "empty_schema");
    expect(tables).toEqual([]);
  });
});

describe("getColumns", () => {
  it("returns column info with constraints", async () => {
    const pool = {
      query: vi.fn()
        .mockResolvedValueOnce({
          // columns query
          rows: [
            { column_name: "id", data_type: "integer", is_nullable: "NO", column_default: "nextval('id_seq')" },
            { column_name: "name", data_type: "text", is_nullable: "YES", column_default: null },
            { column_name: "email", data_type: "text", is_nullable: "NO", column_default: null },
            { column_name: "org_id", data_type: "integer", is_nullable: "YES", column_default: null },
          ],
        })
        .mockResolvedValueOnce({
          // primary key query
          rows: [{ column_name: "id" }],
        })
        .mockResolvedValueOnce({
          // unique query
          rows: [{ column_name: "email" }],
        })
        .mockResolvedValueOnce({
          // foreign key query
          rows: [
            { column_name: "org_id", foreign_schema: "public", foreign_table: "orgs", foreign_column: "id" },
          ],
        }),
    } as any;

    const columns = await getColumns(pool, "public", "users");

    expect(columns).toHaveLength(4);

    // id: primary key, not nullable
    expect(columns[0].name).toBe("id");
    expect(columns[0].isPrimaryKey).toBe(true);
    expect(columns[0].nullable).toBe(false);
    expect(columns[0].defaultValue).toBe("nextval('id_seq')");

    // name: nullable, no constraints
    expect(columns[1].name).toBe("name");
    expect(columns[1].nullable).toBe(true);
    expect(columns[1].isPrimaryKey).toBe(false);
    expect(columns[1].isUnique).toBe(false);
    expect(columns[1].isForeignKey).toBe(false);

    // email: unique, not nullable
    expect(columns[2].isUnique).toBe(true);
    expect(columns[2].nullable).toBe(false);

    // org_id: foreign key
    expect(columns[3].isForeignKey).toBe(true);
    expect(columns[3].foreignKeyRef).toBe("public.orgs.id");
  });

  it("returns empty array when table has no columns", async () => {
    const pool = {
      query: vi.fn().mockResolvedValue({ rows: [] }),
    } as any;

    const columns = await getColumns(pool, "public", "nonexistent");
    expect(columns).toEqual([]);
  });
});
