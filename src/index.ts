#!/usr/bin/env node

import { Command } from "commander";
import { existsSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { loadConfig } from "./config/parser.js";
import { ConnectionManager } from "./db/connection.js";
import { syncSchema } from "./db/sync.js";
import { createServer, startServer } from "./server.js";

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
    console.log("  1. Set your DATABASE_URL environment variable");
    console.log(`  2. Edit ${CONFIG_FILENAME} to configure permissions`);
    console.log("  3. Run: npx datadan start");
  });

program
  .command("start")
  .description("Start the DataDan MCP server")
  .option("--config <path>", "Path to datadan.config.yaml")
  .action(async (opts: { config?: string }) => {
    // Resolve config path: --config flag > DATADAN_CONFIG env > ./datadan.config.yaml
    const configPath = resolve(
      opts.config ?? process.env.DATADAN_CONFIG ?? join(process.cwd(), CONFIG_FILENAME),
    );

    if (!existsSync(configPath)) {
      console.error(
        `Error: No config file found at '${configPath}'.\nRun 'datadan init' to create one, or use --config <path> to specify a location.`,
      );
      process.exit(1);
    }

    let config;
    try {
      config = loadConfig(configPath);
    } catch (err) {
      console.error(`Error: ${(err as Error).message}`);
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

    const server = createServer(config, connectionManager, configPath);
    await startServer(server);

    console.error(`[datadan] MCP server started (${config.databases.length} database(s) configured)`);
  });

program.parse();
