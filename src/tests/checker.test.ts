import { describe, it, expect } from "vitest";
import { checkQueryPermission } from "../permissions/checker.js";
import type { DataDanConfig } from "../config/schema.js";
import type { ClassifiedQuery } from "../permissions/classifier.js";

function makeConfig(defaultPerm: string = "read", databases: DataDanConfig["databases"] = []): DataDanConfig {
  return {
    name: "test",
    "default-permission": defaultPerm as DataDanConfig["default-permission"],
    "hot-reload": false,
    databases,
  };
}

function makeClassified(overrides: Partial<ClassifiedQuery> = {}): ClassifiedQuery {
  return {
    statementType: "select",
    requiredPermission: "read",
    referencedTables: [{ schema: "public", table: "users" }],
    ...overrides,
  };
}

describe("checkQueryPermission", () => {
  it("allows SELECT when permission is read", () => {
    const config = makeConfig("read");
    const classified = makeClassified();
    const result = checkQueryPermission(config, "db1", classified);
    expect(result.allowed).toBe(true);
  });

  it("allows SELECT when permission is write (higher)", () => {
    const config = makeConfig("write");
    const classified = makeClassified();
    const result = checkQueryPermission(config, "db1", classified);
    expect(result.allowed).toBe(true);
  });

  it("denies SELECT when permission is none", () => {
    const config = makeConfig("none");
    const classified = makeClassified();
    const result = checkQueryPermission(config, "db1", classified);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.error.isError).toBe(true);
      expect(result.error.content[0].text).toContain("Permission denied");
    }
  });

  it("denies DELETE when permission is write", () => {
    const config = makeConfig("write");
    const classified = makeClassified({
      statementType: "delete",
      requiredPermission: "delete",
    });
    const result = checkQueryPermission(config, "db1", classified);
    expect(result.allowed).toBe(false);
  });

  it("allows DELETE when permission is delete", () => {
    const config = makeConfig("delete");
    const classified = makeClassified({
      statementType: "delete",
      requiredPermission: "delete",
    });
    const result = checkQueryPermission(config, "db1", classified);
    expect(result.allowed).toBe(true);
  });

  it("denies DDL when permission is delete", () => {
    const config = makeConfig("delete");
    const classified = makeClassified({
      statementType: "ddl",
      requiredPermission: "yolo",
    });
    const result = checkQueryPermission(config, "db1", classified);
    expect(result.allowed).toBe(false);
  });

  it("allows DDL when permission is yolo", () => {
    const config = makeConfig("yolo");
    const classified = makeClassified({
      statementType: "ddl",
      requiredPermission: "yolo",
    });
    const result = checkQueryPermission(config, "db1", classified);
    expect(result.allowed).toBe(true);
  });

  it("checks all referenced tables and fails on first blocked one", () => {
    const config = makeConfig("none", [
      {
        name: "db1",
        connection_string: "pg://",
        schemas: [
          {
            name: "public",
            tables: [
              { name: "users", permission: "read" },
              { name: "secrets", permission: "none" },
            ],
          },
        ],
      },
    ]);

    const classified = makeClassified({
      referencedTables: [
        { schema: "public", table: "users" },
        { schema: "public", table: "secrets" },
      ],
    });

    const result = checkQueryPermission(config, "db1", classified);
    expect(result.allowed).toBe(false);
    if (!result.allowed) {
      expect(result.error.content[0].text).toContain("secrets");
    }
  });

  it("allows when all tables have sufficient permission", () => {
    const config = makeConfig("read", [
      {
        name: "db1",
        connection_string: "pg://",
        schemas: [
          {
            name: "public",
            tables: [
              { name: "users", permission: "write" },
              { name: "orders", permission: "write" },
            ],
          },
        ],
      },
    ]);

    const classified = makeClassified({
      requiredPermission: "write",
      referencedTables: [
        { schema: "public", table: "users" },
        { schema: "public", table: "orders" },
      ],
    });

    const result = checkQueryPermission(config, "db1", classified);
    expect(result.allowed).toBe(true);
  });
});
