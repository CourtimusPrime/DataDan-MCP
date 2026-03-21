import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { loadConfig, writeConfig } from "../config/parser.js";
import type { DataDanConfig } from "../config/schema.js";

describe("loadConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "datadan-test-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("loads a valid YAML config", () => {
    const yaml = `
name: test-project
default-permission: read
hot-reload: false
databases:
  - name: mydb
    connection_string: postgresql://localhost/mydb
`;
    const configPath = join(tempDir, "config.yaml");
    writeFileSync(configPath, yaml);
    const config = loadConfig(configPath);
    expect(config.name).toBe("test-project");
    expect(config["default-permission"]).toBe("read");
    expect(config.databases).toHaveLength(1);
  });

  it("throws on missing file", () => {
    expect(() => loadConfig("/nonexistent/config.yaml")).toThrow("Failed to read config file");
  });

  it("throws on invalid YAML", () => {
    const configPath = join(tempDir, "bad.yaml");
    writeFileSync(configPath, ":::invalid:::");
    expect(() => loadConfig(configPath)).toThrow();
  });

  it("throws on schema validation failure", () => {
    const yaml = `
name: test
databases: "not-an-array"
`;
    const configPath = join(tempDir, "invalid.yaml");
    writeFileSync(configPath, yaml);
    expect(() => loadConfig(configPath)).toThrow("Config validation failed");
  });

  it("interpolates environment variables in connection_string", () => {
    const originalEnv = process.env.TEST_DB_URL;
    process.env.TEST_DB_URL = "postgresql://testhost/testdb";

    const yaml = `
name: test
default-permission: read
hot-reload: false
databases:
  - name: mydb
    connection_string: \${TEST_DB_URL}
`;
    const configPath = join(tempDir, "env.yaml");
    writeFileSync(configPath, yaml);
    const config = loadConfig(configPath);
    expect(config.databases[0].connection_string).toBe("postgresql://testhost/testdb");

    if (originalEnv === undefined) {
      delete process.env.TEST_DB_URL;
    } else {
      process.env.TEST_DB_URL = originalEnv;
    }
  });

  it("throws when env var is not set", () => {
    delete process.env.DATADAN_MISSING_VAR_12345;
    const yaml = `
name: test
default-permission: read
hot-reload: false
databases:
  - name: mydb
    connection_string: \${DATADAN_MISSING_VAR_12345}
`;
    const configPath = join(tempDir, "missing-env.yaml");
    writeFileSync(configPath, yaml);
    expect(() => loadConfig(configPath)).toThrow("DATADAN_MISSING_VAR_12345");
  });

  it("handles config with schemas and tables", () => {
    const yaml = `
name: test
default-permission: read
hot-reload: true
databases:
  - name: mydb
    connection_string: postgresql://localhost/mydb
    permission: write
    schemas:
      - name: public
        permission: read
        tables:
          - name: users
            permission: yolo
`;
    const configPath = join(tempDir, "full.yaml");
    writeFileSync(configPath, yaml);
    const config = loadConfig(configPath);
    expect(config.databases[0].schemas![0].tables![0].permission).toBe("yolo");
  });
});

describe("writeConfig", () => {
  let tempDir: string;

  beforeEach(() => {
    tempDir = mkdtempSync(join(tmpdir(), "datadan-write-"));
  });

  afterEach(() => {
    rmSync(tempDir, { recursive: true, force: true });
  });

  it("writes and re-reads a config roundtrip", () => {
    const config: DataDanConfig = {
      name: "roundtrip",
      "default-permission": "write",
      "hot-reload": false,
      databases: [
        {
          name: "db1",
          connection_string: "postgresql://localhost/db1",
          schemas: [{ name: "public", tables: [{ name: "users" }] }],
        },
      ],
    };
    const configPath = join(tempDir, "out.yaml");
    writeConfig(config, configPath);
    const loaded = loadConfig(configPath);
    expect(loaded.name).toBe("roundtrip");
    expect(loaded.databases[0].schemas![0].tables![0].name).toBe("users");
  });
});
