import { describe, it, expect, vi, beforeEach } from "vitest";
import { ConnectionManager } from "../db/connection.js";
import type { DataDanConfig } from "../config/schema.js";

// Mock pg module
vi.mock("pg", () => {
  class MockPool {
    connect = vi.fn();
    end = vi.fn().mockResolvedValue(undefined);
    query = vi.fn();
  }
  return {
    default: {
      Pool: MockPool,
    },
  };
});

function makeConfig(databases: DataDanConfig["databases"] = []): DataDanConfig {
  return {
    name: "test",
    "default-permission": "read",
    "hot-reload": false,
    databases,
  };
}

describe("ConnectionManager", () => {
  it("creates pools for configured databases", () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://host1/db1" },
      { name: "db2", connection_string: "pg://host2/db2" },
    ]);
    const manager = new ConnectionManager(config);
    expect(manager.getDatabaseNames()).toEqual(["db1", "db2"]);
  });

  it("getPool returns pool for existing database", () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://host1/db1" },
    ]);
    const manager = new ConnectionManager(config);
    const pool = manager.getPool("db1");
    expect(pool).toBeDefined();
  });

  it("getPool throws for non-existent database", () => {
    const config = makeConfig([]);
    const manager = new ConnectionManager(config);
    expect(() => manager.getPool("nonexistent")).toThrow("not found");
  });

  it("addPool adds a new pool", () => {
    const config = makeConfig([]);
    const manager = new ConnectionManager(config);
    manager.addPool("newdb", "pg://host/newdb");
    expect(manager.getDatabaseNames()).toContain("newdb");
    expect(manager.getPool("newdb")).toBeDefined();
  });

  it("getDatabaseNames returns all pool names", () => {
    const config = makeConfig([
      { name: "a", connection_string: "pg://" },
      { name: "b", connection_string: "pg://" },
    ]);
    const manager = new ConnectionManager(config);
    expect(manager.getDatabaseNames().sort()).toEqual(["a", "b"]);
  });

  it("disconnect clears all pools", async () => {
    const config = makeConfig([
      { name: "db1", connection_string: "pg://" },
    ]);
    const manager = new ConnectionManager(config);
    await manager.disconnect();
    expect(manager.getDatabaseNames()).toEqual([]);
  });

  describe("connect", () => {
    it("reports successful connections", async () => {
      const config = makeConfig([
        { name: "db1", connection_string: "pg://host1/db1" },
      ]);
      const manager = new ConnectionManager(config);
      // Mock the pool's connect to return a client that works
      const pool = manager.getPool("db1");
      const mockClient = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
      (pool.connect as any).mockResolvedValue(mockClient);

      const status = await manager.connect();
      expect(status.successes).toEqual(["db1"]);
      expect(status.failures).toEqual([]);
    });

    it("reports failed connections", async () => {
      const config = makeConfig([
        { name: "db1", connection_string: "pg://host1/db1" },
      ]);
      const manager = new ConnectionManager(config);
      const pool = manager.getPool("db1");
      (pool.connect as any).mockRejectedValue(new Error("connection refused"));

      const status = await manager.connect();
      expect(status.successes).toEqual([]);
      expect(status.failures).toHaveLength(1);
      expect(status.failures[0].database).toBe("db1");
      expect(status.failures[0].error).toContain("connection refused");
    });

    it("handles mix of successes and failures", async () => {
      const config = makeConfig([
        { name: "db1", connection_string: "pg://host1/db1" },
        { name: "db2", connection_string: "pg://host2/db2" },
      ]);
      const manager = new ConnectionManager(config);

      const pool1 = manager.getPool("db1");
      const mockClient = { query: vi.fn().mockResolvedValue({}), release: vi.fn() };
      (pool1.connect as any).mockResolvedValue(mockClient);

      const pool2 = manager.getPool("db2");
      (pool2.connect as any).mockRejectedValue(new Error("timeout"));

      const status = await manager.connect();
      expect(status.successes).toEqual(["db1"]);
      expect(status.failures).toHaveLength(1);
      expect(status.failures[0].database).toBe("db2");
    });
  });
});
