#!/usr/bin/env node

import { Command } from "commander";
import { execSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { loadConfig, writeConfig } from "./config/parser.js";
import { PERMISSION_HIERARCHY, resolvePermission } from "./config/resolver.js";
import pg from "pg";
import { ConnectionManager } from "./db/connection.js";
import { getSchemas, getTables } from "./db/introspect.js";
import { syncSchema } from "./db/sync.js";
import { createServer, startServer } from "./server.js";
import type { DataDanConfig } from "./config/schema.js";

const { Pool } = pg;

const CONFIG_FILENAME = "datadan.config.yaml";

const TEMPLATE = `# DataDan configuration file
# Docs: https://github.com/your-org/datadan

# Display name for this configuration
name: my-project

# Default permission applied to all databases/schemas/tables unless overridden
# Options: read | write | delete | yolo | none
default-permission: read

# When true, DataDan re-reads this file before each tool invocation
# so you can change permissions mid-session without restarting
hot-reload: true

# Database connections
databases:
  # Each database entry needs a name and connection string
  - name: my-database
    # Use \${ENV_VAR} syntax to reference environment variables
    connection_string: \${DATABASE_URL}
    # Optional: override default-permission for this entire database
    # permission: write

    # Optional: per-schema overrides
    # schemas:
    #   - name: public
    #     permission: write
    #     # Optional: per-table overrides
    #     tables:
    #       - name: users
    #         permission: read
`;

const program = new Command();

program
  .name("datadan")
  .description(
    "PostgreSQL MCP server that gives coding agents permission-bound access to databases via a YAML config"
  )
  .version("0.1.0");

/**
 * Runs the init logic: scaffolds datadan.config.yaml and auto-registers databases.
 * Returns true if at least one database was discovered and config written,
 * false if only a template was written (no PG entries found or all connections failed).
 */
async function runInit(): Promise<boolean> {
  const configPath = join(process.cwd(), CONFIG_FILENAME);

  if (existsSync(configPath)) {
    console.error(
      `${CONFIG_FILENAME} already exists in this directory. Remove it first if you want to re-initialize.`
    );
    process.exit(1);
  }

  // Load .env from the current directory
  const envPath = join(process.cwd(), ".env");
  loadDotenv({ path: envPath, quiet: true });

  // Scan .env for PostgreSQL connection strings
  const pgEntries = scanEnvForPostgres(envPath);

  if (pgEntries.length === 0) {
    // No connection strings found — write the template as a fallback
    writeFileSync(configPath, TEMPLATE, "utf-8");
    const mcpResult = registerMcpServer(process.cwd());
    const agentFile = registerAgentInstruction(process.cwd());
    console.log(`Created ${CONFIG_FILENAME} (template)`);
    if (mcpResult.method === "claude-cli") {
      console.log("Registered DataDan as MCP server (via Claude Code CLI)");
    } else if (mcpResult.method === "mcp-json") {
      console.log("Registered DataDan in .mcp.json");
    }
    if (agentFile) {
      console.log(`Added DataDan instruction to ${agentFile}`);
    }
    console.log();
    console.log("No PostgreSQL connection strings found in .env.");
    console.log("Next steps:");
    console.log("  1. Add connection strings to your .env file (e.g. DATABASE_URL=postgresql://...)");
    console.log("  2. Re-run: npx datadan init");
    return false;
  }

  console.log(`Found ${pgEntries.length} PostgreSQL connection string(s) in .env`);

  // Validate each connection and discover schemas/tables
  const databases: Array<{
    name: string;
    envVar: string;
    connectionString: string;
    schemas: Array<{ name: string; tables: Array<{ name: string }> }>;
  }> = [];

  for (const entry of pgEntries) {
    const dbName = envVarToDatabaseName(entry.key);
    console.log(`  Connecting to ${dbName} (\${${entry.key}})...`);

    const pool = new Pool({ connectionString: entry.value });
    try {
      const client = await pool.connect();
      try {
        await client.query("SELECT 1");
      } finally {
        client.release();
      }

      // Discover schemas and tables
      const schemaNames = await getSchemas(pool);
      const schemas = await Promise.all(
        schemaNames.map(async (schemaName) => {
          const tableNames = await getTables(pool, schemaName);
          return { name: schemaName, tables: tableNames.map((t) => ({ name: t })) };
        }),
      );

      const totalTables = schemas.reduce((sum, s) => sum + s.tables.length, 0);
      console.log(`    ${schemaNames.length} schema(s), ${totalTables} table(s)`);

      databases.push({
        name: dbName,
        envVar: entry.key,
        connectionString: entry.value,
        schemas,
      });
    } catch (error) {
      console.error(`    Failed: ${(error as Error).message}`);
    } finally {
      await pool.end();
    }
  }

  if (databases.length === 0) {
    writeFileSync(configPath, TEMPLATE, "utf-8");
    console.log();
    console.log(`All connections failed. Created ${CONFIG_FILENAME} (template)`);
    return false;
  }

  // Build the config
  const config: DataDanConfig = {
    name: basename(process.cwd()),
    "default-permission": "read",
    "hot-reload": true,
    databases: databases.map((db) => ({
      name: db.name,
      connection_string: db.connectionString,
      _connection_string_template: `\${${db.envVar}}`,
      schemas: db.schemas,
    })),
  };

  writeConfig(config, configPath);

  // Register DataDan as MCP server
  const mcpResult = registerMcpServer(process.cwd());
  const agentFile = registerAgentInstruction(process.cwd());

  console.log();
  console.log(`Created ${CONFIG_FILENAME} with ${databases.length} database(s)`);
  if (mcpResult.method === "claude-cli") {
    console.log("Registered DataDan as MCP server (via Claude Code CLI)");
  } else if (mcpResult.method === "mcp-json") {
    console.log("Registered DataDan in .mcp.json");
  }
  if (agentFile) {
    console.log(`Added DataDan instruction to ${agentFile}`);
  }
  console.log();
  console.log("Next steps:");
  console.log(`  1. Edit ${CONFIG_FILENAME} to adjust permissions (default: read)`);
  if (!mcpResult.registered) {
    console.log("  2. Register DataDan as an MCP server:");
    console.log(`     claude mcp add -e DATADAN_CONFIG=./datadan.config.yaml datadan -- npx -y datadan start`);
  }
  return true;
}

program
  .command("init")
  .description("Scaffold datadan.config.yaml and auto-register databases found in .env")
  .action(async () => { await runInit(); });

/**
 * Runs the start logic: loads config, connects to databases, syncs schema, and starts the MCP server.
 */
async function runStart(opts: { config?: string; dryRun?: boolean }): Promise<void> {
  // Resolve config path: --config flag > DATADAN_CONFIG env > ./datadan.config.yaml
  const configPath = resolve(
    opts.config ?? process.env.DATADAN_CONFIG ?? join(process.cwd(), CONFIG_FILENAME),
  );

  // Load .env from the same directory as the config file.
  // This populates process.env before loadConfig() interpolates ${VAR} references.
  // dotenv never overwrites existing env vars, so shell/CI vars take precedence.
  loadDotenv({ path: join(dirname(configPath), ".env"), quiet: true });

  let config;
  try {
    config = loadConfig(configPath);
  } catch (err) {
    console.error(`Error: ${(err as Error).message}`);
    console.error("Run 'datadan init' to create a config, or use --config <path> to specify a location.");
    process.exit(1);
  }

  const connectionManager = new ConnectionManager(config);
  const status = await connectionManager.connect();

  if (status.successes.length === 0) {
    const failureDetails = status.failures
      .map((f) => `  - ${f.database}: ${f.error}`)
      .join("\n");
    console.error(
      `Error: All database connections failed.\n${failureDetails}`,
    );
    await connectionManager.disconnect();
    process.exit(1);
  }

  if (status.failures.length > 0) {
    for (const f of status.failures) {
      console.error(`[datadan] Warning: Failed to connect to '${f.database}': ${f.error}`);
    }
  }

  for (const name of status.successes) {
    console.error(`[datadan] Connected to '${name}'`);
  }

  // Sync schema before accepting requests
  try {
    const syncSummary = await syncSchema(config, connectionManager, configPath);
    if (syncSummary.added.schemas > 0 || syncSummary.added.tables > 0 || syncSummary.removed.schemas > 0 || syncSummary.removed.tables > 0) {
      console.error(
        `[datadan] Schema sync: +${syncSummary.added.schemas} schemas, +${syncSummary.added.tables} tables, -${syncSummary.removed.schemas} schemas, -${syncSummary.removed.tables} tables`,
      );
    }
  } catch (err) {
    console.error(`[datadan] Warning: Schema sync failed: ${(err as Error).message}`);
  }

  if (opts.dryRun) {
    printPermissionSummary(config);
    await connectionManager.disconnect();
    process.exit(0);
  }

  const server = createServer(config, connectionManager, configPath);
  await startServer(server);

  console.error(`[datadan] MCP server started (${config.databases.length} database(s) configured)`);
}

program
  .command("start")
  .description("Start the DataDan MCP server")
  .option("--config <path>", "Path to datadan.config.yaml")
  .option("--dry-run", "Show resolved permissions without starting the server")
  .action(async (opts: { config?: string; dryRun?: boolean }) => { await runStart(opts); });

function printPermissionSummary(config: DataDanConfig): void {
  const rows: Array<{ database: string; schema: string; table: string; permission: string }> = [];

  for (const db of config.databases) {
    if (!db.schemas || db.schemas.length === 0) {
      // Database with no schemas discovered — show database-level default
      const perm = db.permission ?? config["default-permission"];
      rows.push({ database: db.name, schema: "-", table: "-", permission: perm });
      continue;
    }
    for (const schema of db.schemas) {
      if (!schema.tables || schema.tables.length === 0) {
        // Schema with no tables discovered — show schema-level default
        const perm = schema.permission ?? db.permission ?? config["default-permission"];
        rows.push({ database: db.name, schema: schema.name, table: "-", permission: perm });
        continue;
      }
      for (const table of schema.tables) {
        const perm = resolvePermission(config, db.name, schema.name, table.name);
        rows.push({ database: db.name, schema: schema.name, table: table.name, permission: perm });
      }
    }
  }

  if (rows.length === 0) {
    console.log("No databases configured.");
    return;
  }

  // Calculate column widths
  const headers = { database: "Database", schema: "Schema", table: "Table", permission: "Permission" };
  const widths = {
    database: Math.max(headers.database.length, ...rows.map((r) => r.database.length)),
    schema: Math.max(headers.schema.length, ...rows.map((r) => r.schema.length)),
    table: Math.max(headers.table.length, ...rows.map((r) => r.table.length)),
    permission: Math.max(headers.permission.length, ...rows.map((r) => formatPermission(r.permission).length)),
  };

  const pad = (s: string, w: number) => s.padEnd(w);
  const sep = `${"─".repeat(widths.database + 2)}┼${"─".repeat(widths.schema + 2)}┼${"─".repeat(widths.table + 2)}┼${"─".repeat(widths.permission + 2)}`;

  // Print header
  console.log(
    ` ${pad(headers.database, widths.database)} │ ${pad(headers.schema, widths.schema)} │ ${pad(headers.table, widths.table)} │ ${pad(headers.permission, widths.permission)}`,
  );
  console.log(sep);

  // Print rows
  for (const row of rows) {
    const perm = formatPermission(row.permission);
    console.log(
      ` ${pad(row.database, widths.database)} │ ${pad(row.schema, widths.schema)} │ ${pad(row.table, widths.table)} │ ${pad(perm, widths.permission)}`,
    );
  }
}

function formatPermission(permission: string): string {
  return permission === "yolo" ? "⚠ yolo" : permission;
}

const AGENT_INSTRUCTION = "- Use the DataDan MCP tools (prefixed with `datadan_`) to read and write to PostgreSQL databases. Run `npx datadan config` to see available permission levels.";

/**
 * Add a DataDan instruction to AGENTS.md or CLAUDE.md so coding agents
 * know to use DataDan for database operations.
 * Returns the filename written to, or null if skipped/failed.
 */
function registerAgentInstruction(projectDir: string): string | null {
  const candidates = ["AGENTS.md", "CLAUDE.md"];
  let targetFile: string | null = null;
  let targetPath: string | null = null;

  // Find existing AGENTS.md or CLAUDE.md
  for (const name of candidates) {
    const p = join(projectDir, name);
    if (existsSync(p)) {
      targetFile = name;
      targetPath = p;
      break;
    }
  }

  // If neither exists, create CLAUDE.md
  if (!targetPath) {
    targetFile = "CLAUDE.md";
    targetPath = join(projectDir, "CLAUDE.md");
  }

  try {
    let content = "";
    if (existsSync(targetPath)) {
      content = readFileSync(targetPath, "utf-8");
    }

    // Idempotent: skip if already present
    if (content.includes("DataDan MCP")) {
      return null;
    }

    const separator = content.length > 0 && !content.endsWith("\n\n")
      ? (content.endsWith("\n") ? "\n" : "\n\n")
      : "";
    writeFileSync(targetPath, content + separator + AGENT_INSTRUCTION + "\n", "utf-8");
    return targetFile;
  } catch {
    return null;
  }
}

/**
 * Attempt to register DataDan via `claude mcp add` CLI command.
 * Returns true on success, false on any failure (command not found, non-zero exit, timeout).
 */
function registerWithClaudeCli(): boolean {
  try {
    execSync(
      "claude mcp add -e DATADAN_CONFIG=./datadan.config.yaml datadan -- npx -y datadan start",
      { stdio: "pipe", timeout: 10_000 },
    );
    return true;
  } catch {
    return false;
  }
}

/**
 * Register DataDan as an MCP server.
 * Tries `claude mcp add` first; falls back to writing .mcp.json.
 */
function registerMcpServer(projectDir: string): { registered: boolean; method: "claude-cli" | "mcp-json" | "none" } {
  if (registerWithClaudeCli()) {
    return { registered: true, method: "claude-cli" };
  }

  if (registerInMcpJson(projectDir)) {
    return { registered: true, method: "mcp-json" };
  }

  return { registered: false, method: "none" };
}

/**
 * Register DataDan in .mcp.json (project-level MCP config).
 * Creates the file if it doesn't exist. Adds the "datadan" server entry
 * if not already present. Returns true if the entry was added or already existed.
 */
function registerInMcpJson(projectDir: string): boolean {
  const mcpPath = join(projectDir, ".mcp.json");

  let mcpConfig: Record<string, unknown>;
  if (existsSync(mcpPath)) {
    try {
      mcpConfig = JSON.parse(readFileSync(mcpPath, "utf-8"));
    } catch {
      return false;
    }
  } else {
    mcpConfig = {};
  }

  if (!mcpConfig.mcpServers || typeof mcpConfig.mcpServers !== "object") {
    mcpConfig.mcpServers = {};
  }

  const servers = mcpConfig.mcpServers as Record<string, unknown>;

  // Don't overwrite if already registered
  if (servers.datadan) return true;

  servers.datadan = {
    command: "npx",
    args: ["-y", "datadan", "start"],
    env: {
      DATADAN_CONFIG: `./${CONFIG_FILENAME}`,
    },
  };

  try {
    writeFileSync(mcpPath, JSON.stringify(mcpConfig, null, 2) + "\n", "utf-8");
    return true;
  } catch {
    return false;
  }
}

/**
 * Scan a .env file for values that look like PostgreSQL connection strings.
 * Returns an array of { key, value } pairs.
 */
function scanEnvForPostgres(envPath: string): Array<{ key: string; value: string }> {
  if (!existsSync(envPath)) return [];

  let contents: string;
  try {
    contents = readFileSync(envPath, "utf-8");
  } catch {
    return [];
  }

  const entries: Array<{ key: string; value: string }> = [];
  for (const line of contents.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;

    const eqIndex = trimmed.indexOf("=");
    if (eqIndex === -1) continue;

    const key = trimmed.slice(0, eqIndex).trim();
    let value = trimmed.slice(eqIndex + 1).trim();

    // Strip surrounding quotes
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }

    if (/^postgres(ql)?:\/\//i.test(value)) {
      entries.push({ key, value });
    }
  }

  return entries;
}

/**
 * Derive a short database name from an env var name.
 * e.g. SANDBOX_DATABASE_URL → sandbox, MY_DB_URL → my, DATABASE_URL → database
 */
function envVarToDatabaseName(envVar: string): string {
  return envVar
    .replace(/_?(DATABASE|DB|POSTGRES|PG)_?(URL|URI|STRING|DSN|CONN)?$/i, "")
    .replace(/_+$/, "")
    .toLowerCase()
    .replace(/_/g, "-") || envVar.toLowerCase();
}

program
  .command("setup")
  .description("Initialize config and start the MCP server in one step (runs init then start)")
  .action(async () => {
    const configured = await runInit();
    if (!configured) {
      console.log();
      console.log("Skipping server start — no databases are configured yet.");
      console.log("Add connection strings to .env, then run: npx datadan setup");
      return;
    }
    console.log();
    await runStart({});
  });

program
  .command("config")
  .description("Show configurable options and permission levels")
  .action(() => {
    console.log("DataDan Configuration Reference");
    console.log("================================");
    console.log();
    console.log("Config file: datadan.config.yaml");
    console.log();
    console.log("Top-level fields:");
    console.log("  name                 Display name for this configuration");
    console.log("  default-permission   Default permission for all databases/schemas/tables");
    console.log("  hot-reload           Re-read config before each tool invocation (true/false)");
    console.log("  databases            List of database connections");
    console.log();
    console.log("Permission levels:");
    console.log("─────────────────────────────────────────────────────────");
    for (const [level, ops] of Object.entries(PERMISSION_HIERARCHY)) {
      const opsStr = ops.length > 0 ? ops.join(", ") : "(no access)";
      const label = level === "yolo" ? `  ⚠ ${level}` : `  ${level}`;
      console.log(`${label.padEnd(12)} ${opsStr}`);
    }
    console.log("─────────────────────────────────────────────────────────");
    console.log();
    console.log("Resolution order (most specific wins):");
    console.log("  table → schema → database → default-permission");
    console.log();
    console.log("Example:");
    console.log("  default-permission: read");
    console.log("  databases:");
    console.log("    - name: my-db");
    console.log("      connection_string: ${DATABASE_URL}");
    console.log("      permission: write           # overrides default for this db");
    console.log("      schemas:");
    console.log("        - name: public");
    console.log("          tables:");
    console.log("            - name: audit_log");
    console.log("              permission: read     # read-only override for this table");
  });

program.parse();
