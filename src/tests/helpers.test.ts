import { describe, it, expect, vi } from "vitest";
import { mcpError, mcpSuccess, findDatabaseOrError, classifyAndAuthorize, executeSqlTool } from "../tools/helpers.js";
import type { DataDanConfig } from "../config/schema.js";

function makeConfig(databases: DataDanConfig["databases"] = []): DataDanConfig {
  return {
    name: "test",
    "default-permission": "read",
    "hot-reload": false,
    databases,
  };
}

describe("mcpError", () => {
  it("returns error structure with isError true", () => {
    const result = mcpError("something failed");
    expect(result.isError).toBe(true);
    expect(result.content).toEqual([{ type: "text", text: "something failed" }]);
  });
});

describe("mcpSuccess", () => {
  it("returns JSON-stringified content", () => {
    const result = mcpSuccess({ count: 42 });
    expect(result.isError).toBeUndefined();
    expect(JSON.parse(result.content[0].text)).toEqual({ count: 42 });
  });

  it("handles arrays", () => {
    const result = mcpSuccess([1, 2, 3]);
    expect(JSON.parse(result.content[0].text)).toEqual([1, 2, 3]);
  });

  it("handles null", () => {
    const result = mcpSuccess(null);
    expect(result.content[0].text).toBe("null");
  });
});

describe("findDatabaseOrError", () => {
  it("returns dbConfig when database exists", () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://" },
    ]);
    const result = findDatabaseOrError(config, "db1");
    expect("dbConfig" in result).toBe(true);
    if ("dbConfig" in result) {
      expect(result.dbConfig.name).toBe("db1");
    }
  });

  it("returns error when database not found", () => {
    const config = makeConfig([]);
    const result = findDatabaseOrError(config, "nonexistent");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.isError).toBe(true);
      expect(result.error.content[0].text).toContain("nonexistent");
      expect(result.error.content[0].text).toContain("not found");
    }
  });

  it("lists available databases in error message", () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://" },
      { name: "db2", connection_string: "pg://" },
    ]);
    const result = findDatabaseOrError(config, "db3");
    if ("error" in result) {
      expect(result.error.content[0].text).toContain("db1");
      expect(result.error.content[0].text).toContain("db2");
    }
  });
});

describe("classifyAndAuthorize", () => {
  it("returns classified query for valid SELECT", () => {
    const config = makeConfig([{ name: "db1", connection_string: "pg://" }]);
    const result = classifyAndAuthorize(config, "db1", "SELECT * FROM users", ["select"], "query");
    expect("classified" in result).toBe(true);
    if ("classified" in result) {
      expect(result.classified.statementType).toBe("select");
    }
  });

  it("returns error for wrong statement type", () => {
    const config = makeConfig([{ name: "db1", connection_string: "pg://" }]);
    const result = classifyAndAuthorize(
      config, "db1",
      "INSERT INTO users (name) VALUES ('x')",
      ["select"],
      "query",
    );
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.content[0].text).toContain("SELECT");
      expect(result.error.content[0].text).toContain("query");
    }
  });

  it("returns error for invalid SQL", () => {
    const config = makeConfig([{ name: "db1", connection_string: "pg://" }]);
    const result = classifyAndAuthorize(config, "db1", "GOBBLEDYGOOK", ["select"], "query");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.content[0].text).toContain("Failed to parse SQL");
    }
  });

  it("returns permission error when insufficient permissions", () => {
    const config = makeConfig([
      {
        name: "db1",
        connection_string: "pg://",
        permission: "none",
      },
    ]);
    const result = classifyAndAuthorize(config, "db1", "SELECT * FROM users", ["select"], "query");
    expect("error" in result).toBe(true);
    if ("error" in result) {
      expect(result.error.content[0].text).toContain("Permission denied");
    }
  });

  it("allows multiple statement types", () => {
    const config = makeConfig([{ name: "db1", connection_string: "pg://", permission: "write" }]);
    const result = classifyAndAuthorize(
      config, "db1",
      "INSERT INTO users (name) VALUES ('x')",
      ["insert", "update"],
      "execute",
    );
    expect("classified" in result).toBe(true);
  });
});

describe("executeSqlTool", () => {
  it("returns error when database not found", async () => {
    const config = makeConfig([]);
    const mockConnMgr = { getPool: vi.fn() } as any;
    const result = await executeSqlTool(
      config, mockConnMgr, "nope", "SELECT 1", ["select"], "query",
      () => mcpSuccess({ rows: [] }),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("not found");
  });

  it("returns error when SQL is invalid", async () => {
    const config = makeConfig([{ name: "db1", connection_string: "pg://" }]);
    const mockConnMgr = { getPool: vi.fn() } as any;
    const result = await executeSqlTool(
      config, mockConnMgr, "db1", "INVALID SQL", ["select"], "query",
      () => mcpSuccess({ rows: [] }),
    );
    expect(result.isError).toBe(true);
  });

  it("returns error when pool.query throws", async () => {
    const config = makeConfig([{ name: "db1", connection_string: "pg://", permission: "read" }]);
    const mockPool = { query: vi.fn().mockRejectedValue(new Error("connection refused")) };
    const mockConnMgr = { getPool: vi.fn().mockReturnValue(mockPool) } as any;
    const result = await executeSqlTool(
      config, mockConnMgr, "db1", "SELECT * FROM users", ["select"], "query",
      () => mcpSuccess({ rows: [] }),
    );
    expect(result.isError).toBe(true);
    expect(result.content[0].text).toContain("connection refused");
  });

  it("calls formatResult on success", async () => {
    const config = makeConfig([{ name: "db1", connection_string: "pg://", permission: "read" }]);
    const mockResult = { rows: [{ id: 1 }], rowCount: 1, command: "SELECT", fields: [] };
    const mockPool = { query: vi.fn().mockResolvedValue(mockResult) };
    const mockConnMgr = { getPool: vi.fn().mockReturnValue(mockPool) } as any;
    const formatResult = vi.fn().mockReturnValue(mcpSuccess({ data: "ok" }));

    const result = await executeSqlTool(
      config, mockConnMgr, "db1", "SELECT * FROM users", ["select"], "query",
      formatResult,
    );
    expect(formatResult).toHaveBeenCalledWith(mockResult, expect.objectContaining({ statementType: "select" }));
    expect(result.isError).toBeUndefined();
  });
});
