import { describe, it, expect } from "vitest";
import {
  PermissionLevelSchema,
  TableConfigSchema,
  SchemaConfigSchema,
  DatabaseConfigSchema,
  DataDanConfigSchema,
} from "../config/schema.js";

describe("PermissionLevelSchema", () => {
  it("accepts valid permission levels", () => {
    for (const level of ["read", "write", "delete", "none", "yolo"]) {
      expect(PermissionLevelSchema.parse(level)).toBe(level);
    }
  });

  it("rejects invalid permission levels", () => {
    expect(() => PermissionLevelSchema.parse("admin")).toThrow();
    expect(() => PermissionLevelSchema.parse("")).toThrow();
    expect(() => PermissionLevelSchema.parse(42)).toThrow();
  });
});

describe("TableConfigSchema", () => {
  it("accepts table with name only", () => {
    const result = TableConfigSchema.parse({ name: "users" });
    expect(result).toEqual({ name: "users" });
  });

  it("accepts table with optional permission", () => {
    const result = TableConfigSchema.parse({ name: "users", permission: "write" });
    expect(result).toEqual({ name: "users", permission: "write" });
  });

  it("rejects table without name", () => {
    expect(() => TableConfigSchema.parse({})).toThrow();
  });
});

describe("SchemaConfigSchema", () => {
  it("accepts schema with name only", () => {
    const result = SchemaConfigSchema.parse({ name: "public" });
    expect(result).toEqual({ name: "public" });
  });

  it("accepts schema with tables", () => {
    const result = SchemaConfigSchema.parse({
      name: "public",
      permission: "read",
      tables: [{ name: "users" }],
    });
    expect(result.tables).toHaveLength(1);
  });
});

describe("DatabaseConfigSchema", () => {
  it("accepts minimal database config", () => {
    const result = DatabaseConfigSchema.parse({
      name: "mydb",
      connection_string: "postgresql://localhost/mydb",
    });
    expect(result.name).toBe("mydb");
  });

  it("rejects missing connection_string", () => {
    expect(() => DatabaseConfigSchema.parse({ name: "mydb" })).toThrow();
  });
});

describe("DataDanConfigSchema", () => {
  it("accepts valid full config", () => {
    const result = DataDanConfigSchema.parse({
      name: "test",
      "default-permission": "read",
      "hot-reload": false,
      databases: [
        { name: "db1", connection_string: "postgresql://localhost/db1" },
      ],
    });
    expect(result.name).toBe("test");
    expect(result["default-permission"]).toBe("read");
  });

  it("rejects config without required fields", () => {
    expect(() => DataDanConfigSchema.parse({ name: "test" })).toThrow();
  });

  it("rejects invalid default-permission", () => {
    expect(() =>
      DataDanConfigSchema.parse({
        name: "test",
        "default-permission": "superadmin",
        "hot-reload": false,
        databases: [],
      })
    ).toThrow();
  });
});
