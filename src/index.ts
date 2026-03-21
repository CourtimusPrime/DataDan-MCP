#!/usr/bin/env node

import { Command } from "commander";
import { existsSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { config as loadDotenv } from "dotenv";
import { loadConfig } from "./config/parser.js";
import { resolvePermission } from "./config/resolver.js";
import { ConnectionManager } from "./db/connection.js";
import { syncSchema } from "./db/sync.js";
import { createServer, startServer } from "./server.js";
import type { DataDanConfig } from "./config/schema.js";

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

program
  .command("init")
  .description("Scaffold a starter datadan.config.yaml in the current directory")
  .action(() => {
    const configPath = join(process.cwd(), CONFIG_FILENAME);

    if (existsSync(configPath)) {
      console.error(
        `${CONFIG_FILENAME} already exists in this directory. Remove it first if you want to re-initialize.`
      );
      process.exit(1);
    }

    writeFileSync(configPath, TEMPLATE, "utf-8");

    console.log(`Created ${CONFIG_FILENAME}`);
    console.log();
    console.log("Next steps:");
    console.log("  1. Create a .env file with your database connection strings");
    console.log(`  2. Edit ${CONFIG_FILENAME} to configure permissions`);
    console.log("  3. Add DataDan to your .mcp.json");
    console.log("  4. Run: npx datadan start");
  });

program
  .command("start")
  .description("Start the DataDan MCP server")
  .option("--config <path>", "Path to datadan.config.yaml")
  .option("--dry-run", "Show resolved permissions without starting the server")
  .action(async (opts: { config?: string; dryRun?: boolean }) => {
    // Resolve config path: --config flag > DATADAN_CONFIG env > ./datadan.config.yaml
    const configPath = resolve(
      opts.config ?? process.env.DATADAN_CONFIG ?? join(process.cwd(), CONFIG_FILENAME),
    );

    // Load .env from the same directory as the config file.
    // This populates process.env before loadConfig() interpolates ${VAR} references.
    // dotenv never overwrites existing env vars, so shell/CI vars take precedence.
    loadDotenv({ path: join(dirname(configPath), ".env") });

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
  });

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

program.parse();
