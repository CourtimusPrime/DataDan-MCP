---
name: init
description: Scaffold a datadan.config.yaml file and register DataDan as an MCP server in the current project
disable-model-invocation: true
---

Run `npx datadan init` in the user's current working directory to scaffold a `datadan.config.yaml` configuration file.

This command will:
1. Scan the project's `.env` file for PostgreSQL connection strings (any env var whose value starts with `postgresql://` or `postgres://`)
2. Test each connection and discover schemas and tables
3. Generate `datadan.config.yaml` with discovered databases pre-populated
4. Register the DataDan MCP server in the project's `.mcp.json`

After running, tell the user:
- The default permission is `read` (SELECT only). They can change it in `datadan.config.yaml`.
- Permission levels: `read` (SELECT), `write` (SELECT/INSERT/UPDATE), `delete` (SELECT/INSERT/UPDATE/DELETE), `yolo` (all including DDL), `none` (no access)
- Permissions cascade: `default-permission` applies everywhere unless overridden at the database, schema, or table level
- `hot-reload: true` means they can edit permissions while the server is running — changes take effect on the next tool call
