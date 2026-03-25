import { describe, it, expect, vi } from "vitest";
import { registerListTools } from "../tools/list.js";

function captureHandlers(config: any, mockConnMgr: any) {
  const handlers: Record<string, any> = {};
  const mockServer = {
    registerTool: vi.fn((name, _def, handler) => { handlers[name] = handler; }),
  } as any;
  registerListTools(mockServer, config, mockConnMgr);
  return handlers;
}

const baseConfig = {
  name: "test",
  "default-permission": "read" as const,
  "hot-reload": false,
  databases: [{
    name: "db1",
    connection_string: "pg://",
    permission: "read" as const,
    schemas: [
      {
        name: "public",
        tables: [{ name: "users" }, { name: "orders" }],
      },
      {
        name: "internal",
        tables: [{ name: "logs" }],
      },
    ],
  }],
};

describe("list_databases", () => {
  it("lists accessible databases", async () => {
    const handlers = captureHandlers(baseConfig, {} as any);
    const result = await handlers.list_databases();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.databases).toEqual(["db1"]);
  });

  it("filters out inaccessible databases", async () => {
    const config = {
      ...baseConfig,
      "default-permission": "none" as const,
      databases: [
        { name: "db1", connection_string: "pg://", permission: "none" as const },
        { name: "db2", connection_string: "pg://", permission: "read" as const },
      ],
    };
    const handlers = captureHandlers(config, {} as any);
    const result = await handlers.list_databases();
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.databases).toEqual(["db2"]);
  });
});

describe("list_schemas", () => {
  it("lists accessible schemas", async () => {
    const handlers = captureHandlers(baseConfig, {} as any);
    const result = await handlers.list_schemas({ database_name: "db1" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.schemas).toEqual(["public", "internal"]);
  });

  it("returns error for unknown database", async () => {
    const handlers = captureHandlers(baseConfig, {} as any);
    const result = await handlers.list_schemas({ database_name: "missing" });
    expect(result.isError).toBe(true);
  });

  it("filters schemas with none permission", async () => {
    const config = {
      ...baseConfig,
      "default-permission": "none" as const,
      databases: [{
        name: "db1",
        connection_string: "pg://",
        permission: "none" as const,
        schemas: [
          { name: "public", permission: "read" as const },
          { name: "secret", permission: "none" as const },
        ],
      }],
    };

    const handlers = captureHandlers(config, {} as any);
    const result = await handlers.list_schemas({ database_name: "db1" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.schemas).toEqual(["public"]);
  });

  it("returns empty schemas when database has no schemas in config", async () => {
    const config = {
      ...baseConfig,
      databases: [{ name: "db1", connection_string: "pg://", permission: "read" as const }],
    };
    const handlers = captureHandlers(config, {} as any);
    const result = await handlers.list_schemas({ database_name: "db1" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.schemas).toEqual([]);
  });
});

describe("list_tables", () => {
  it("lists accessible tables", async () => {
    const handlers = captureHandlers(baseConfig, {} as any);
    const result = await handlers.list_tables({ database_name: "db1", schema_name: "public" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tables).toEqual(["users", "orders"]);
  });

  it("returns error when schema not found in config", async () => {
    const handlers = captureHandlers(baseConfig, {} as any);
    const result = await handlers.list_tables({ database_name: "db1", schema_name: "empty" });
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("filters tables with none permission", async () => {
    const config = {
      ...baseConfig,
      "default-permission": "none" as const,
      databases: [{
        name: "db1",
        connection_string: "pg://",
        permission: "none" as const,
        schemas: [{
          name: "public",
          permission: "none" as const,
          tables: [
            { name: "users", permission: "read" as const },
            { name: "secrets", permission: "none" as const },
          ],
        }],
      }],
    };

    const handlers = captureHandlers(config, {} as any);
    const result = await handlers.list_tables({ database_name: "db1", schema_name: "public" });
    const parsed = JSON.parse(result.content[0].text);
    expect(parsed.tables).toEqual(["users"]);
  });

  it("returns error for unknown database", async () => {
    const handlers = captureHandlers(baseConfig, {} as any);
    const result = await handlers.list_tables({ database_name: "missing", schema_name: "public" });
    expect(result.isError).toBe(true);
  });
});
