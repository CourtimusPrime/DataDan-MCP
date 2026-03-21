import { describe, it, expect } from "vitest";
import { classifyQuery } from "../permissions/classifier.js";

describe("classifyQuery", () => {
  describe("SELECT statements", () => {
    it("classifies simple SELECT", () => {
      const result = classifyQuery("SELECT * FROM users");
      expect(result.statementType).toBe("select");
      expect(result.requiredPermission).toBe("read");
      expect(result.referencedTables).toEqual([{ schema: "public", table: "users" }]);
    });

    it("classifies SELECT with explicit schema", () => {
      const result = classifyQuery("SELECT id FROM myschema.users");
      expect(result.referencedTables).toEqual([{ schema: "myschema", table: "users" }]);
    });

    it("classifies SELECT with JOIN", () => {
      const result = classifyQuery(
        "SELECT u.id, o.total FROM users u JOIN orders o ON u.id = o.user_id"
      );
      expect(result.statementType).toBe("select");
      expect(result.referencedTables).toHaveLength(2);
      const tableNames = result.referencedTables.map((t) => t.table).sort();
      expect(tableNames).toEqual(["orders", "users"]);
    });

    it("deduplicates tables referenced multiple times", () => {
      const result = classifyQuery(
        "SELECT * FROM users WHERE id IN (SELECT user_id FROM users)"
      );
      expect(result.referencedTables).toHaveLength(1);
    });
  });

  describe("INSERT statements", () => {
    it("classifies INSERT", () => {
      const result = classifyQuery("INSERT INTO users (name) VALUES ('test')");
      expect(result.statementType).toBe("insert");
      expect(result.requiredPermission).toBe("write");
    });
  });

  describe("UPDATE statements", () => {
    it("classifies UPDATE", () => {
      const result = classifyQuery("UPDATE users SET name = 'test' WHERE id = 1");
      expect(result.statementType).toBe("update");
      expect(result.requiredPermission).toBe("write");
    });
  });

  describe("DELETE statements", () => {
    it("classifies DELETE", () => {
      const result = classifyQuery("DELETE FROM users WHERE id = 1");
      expect(result.statementType).toBe("delete");
      expect(result.requiredPermission).toBe("delete");
    });
  });

  describe("DDL statements", () => {
    it("classifies CREATE TABLE", () => {
      const result = classifyQuery("CREATE TABLE users (id serial PRIMARY KEY)");
      expect(result.statementType).toBe("ddl");
      expect(result.requiredPermission).toBe("yolo");
    });

    it("classifies DROP TABLE", () => {
      const result = classifyQuery("DROP TABLE users");
      expect(result.statementType).toBe("ddl");
      expect(result.requiredPermission).toBe("yolo");
    });

    it("classifies ALTER TABLE", () => {
      const result = classifyQuery("ALTER TABLE users ADD COLUMN email text");
      expect(result.statementType).toBe("ddl");
      expect(result.requiredPermission).toBe("yolo");
    });

    it("classifies TRUNCATE", () => {
      const result = classifyQuery("TRUNCATE users");
      expect(result.statementType).toBe("ddl");
      expect(result.requiredPermission).toBe("yolo");
    });
  });

  describe("error handling", () => {
    it("throws on invalid SQL", () => {
      expect(() => classifyQuery("NOT VALID SQL AT ALL")).toThrow("Failed to parse SQL");
    });
  });

  describe("default schema", () => {
    it("uses public as default schema when none specified", () => {
      const result = classifyQuery("SELECT * FROM users");
      expect(result.referencedTables[0].schema).toBe("public");
    });
  });
});
