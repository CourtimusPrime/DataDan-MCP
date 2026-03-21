import { describe, it, expect } from "vitest";
import { resolvePermission, resolveSchemaPermission, PERMISSION_HIERARCHY } from "../config/resolver.js";
import type { DataDanConfig } from "../config/schema.js";

function makeConfig(overrides: Partial<DataDanConfig> = {}): DataDanConfig {
  return {
    name: "test",
    "default-permission": "read",
    "hot-reload": false,
    databases: [],
    ...overrides,
  };
}

describe("PERMISSION_HIERARCHY", () => {
  it("none allows nothing", () => {
    expect(PERMISSION_HIERARCHY.none).toEqual([]);
  });

  it("read allows SELECT", () => {
    expect(PERMISSION_HIERARCHY.read).toEqual(["SELECT"]);
  });

  it("write allows SELECT, INSERT, UPDATE", () => {
    expect(PERMISSION_HIERARCHY.write).toEqual(["SELECT", "INSERT", "UPDATE"]);
  });

  it("delete includes write ops plus DELETE", () => {
    expect(PERMISSION_HIERARCHY.delete).toContain("DELETE");
    expect(PERMISSION_HIERARCHY.delete).toContain("SELECT");
  });

  it("yolo includes everything", () => {
    expect(PERMISSION_HIERARCHY.yolo).toContain("CREATE");
    expect(PERMISSION_HIERARCHY.yolo).toContain("DROP");
    expect(PERMISSION_HIERARCHY.yolo).toContain("ALTER");
    expect(PERMISSION_HIERARCHY.yolo).toContain("TRUNCATE");
  });
});

describe("resolvePermission", () => {
  it("returns default-permission when database not found", () => {
    const config = makeConfig({ "default-permission": "write" });
    expect(resolvePermission(config, "unknown", "public", "users")).toBe("write");
  });

  it("returns database permission when no schema config", () => {
    const config = makeConfig({
      databases: [
        { name: "db1", connection_string: "pg://", permission: "delete" },
      ],
    });
    expect(resolvePermission(config, "db1", "public", "users")).toBe("delete");
  });

  it("falls back to default-permission when database has no permission", () => {
    const config = makeConfig({
      "default-permission": "none",
      databases: [{ name: "db1", connection_string: "pg://" }],
    });
    expect(resolvePermission(config, "db1", "public", "users")).toBe("none");
  });

  it("returns schema permission when no table config", () => {
    const config = makeConfig({
      databases: [
        {
          name: "db1",
          connection_string: "pg://",
          permission: "read",
          schemas: [{ name: "public", permission: "write" }],
        },
      ],
    });
    expect(resolvePermission(config, "db1", "public", "users")).toBe("write");
  });

  it("returns table-level permission when specified", () => {
    const config = makeConfig({
      databases: [
        {
          name: "db1",
          connection_string: "pg://",
          schemas: [
            {
              name: "public",
              permission: "read",
              tables: [{ name: "users", permission: "yolo" }],
            },
          ],
        },
      ],
    });
    expect(resolvePermission(config, "db1", "public", "users")).toBe("yolo");
  });

  it("cascades through table -> schema -> db -> default", () => {
    const config = makeConfig({
      "default-permission": "none",
      databases: [
        {
          name: "db1",
          connection_string: "pg://",
          permission: "read",
          schemas: [
            {
              name: "public",
              permission: "write",
              tables: [
                { name: "users" }, // no permission -> falls to schema
                { name: "secrets", permission: "none" },
              ],
            },
          ],
        },
      ],
    });
    expect(resolvePermission(config, "db1", "public", "users")).toBe("write");
    expect(resolvePermission(config, "db1", "public", "secrets")).toBe("none");
    expect(resolvePermission(config, "db1", "other_schema", "anything")).toBe("read");
  });
});

describe("resolveSchemaPermission", () => {
  it("returns default-permission when database not found", () => {
    const config = makeConfig({ "default-permission": "write" });
    expect(resolveSchemaPermission(config, "unknown", "public")).toBe("write");
  });

  it("returns db permission when schema not found", () => {
    const config = makeConfig({
      databases: [
        { name: "db1", connection_string: "pg://", permission: "delete" },
      ],
    });
    expect(resolveSchemaPermission(config, "db1", "nonexistent")).toBe("delete");
  });

  it("returns schema-level permission", () => {
    const config = makeConfig({
      databases: [
        {
          name: "db1",
          connection_string: "pg://",
          schemas: [{ name: "public", permission: "yolo" }],
        },
      ],
    });
    expect(resolveSchemaPermission(config, "db1", "public")).toBe("yolo");
  });

  it("falls back through schema -> db -> default", () => {
    const config = makeConfig({
      "default-permission": "none",
      databases: [
        {
          name: "db1",
          connection_string: "pg://",
          permission: "read",
          schemas: [{ name: "public" }], // no permission set
        },
      ],
    });
    expect(resolveSchemaPermission(config, "db1", "public")).toBe("read");
  });
});
