#!/usr/bin/env node

import { Command } from "commander";
import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

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

program.parse();
