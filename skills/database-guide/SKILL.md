---
name: database-guide
description: Background knowledge for using DataDan's PostgreSQL MCP tools — permission model, available tools, workflow, and rules
user-invocable: false
---

# DataDan — PostgreSQL MCP Server Guide

DataDan gives you permission-bound access to PostgreSQL databases via MCP tools. The user controls what you can do through a `datadan.config.yaml` file in their project.

## Permission Model

Permissions are hierarchical and cascade from general to specific:

`default-permission` → database → schema → table

The most specific level wins. Permission levels (each includes the capabilities of the levels above it):

| Level    | Allowed SQL                        |
|----------|------------------------------------|
| `none`   | No access                          |
| `read`   | SELECT                             |
| `write`  | SELECT, INSERT, UPDATE             |
| `delete` | SELECT, INSERT, UPDATE, DELETE     |
| `yolo`   | Everything including DDL (CREATE, ALTER, DROP, TRUNCATE) |

## Available Tools

### Discovery tools (require `read` or higher)
- **`list_databases`** — List all accessible databases. No parameters. Start here.
- **`list_schemas`** — List schemas in a database. Params: `database_name`
- **`list_tables`** — List tables in a schema. Params: `database_name`, `schema_name`
- **`describe_table`** — Get columns, types, constraints, and foreign keys. Params: `database_name`, `schema_name`, `table_name`

### Query tool (requires `read` or higher)
- **`query`** — Run a SELECT statement. Params: `database_name`, `sql`

### Write tools (require `write` or higher)
- **`execute`** — Run INSERT or UPDATE statements. Params: `database_name`, `sql`

### Delete tool (requires `delete` or higher)
- **`delete`** — Run DELETE statements. Params: `database_name`, `sql`

### DDL tool (requires `yolo`)
- **`run_migration`** — Run CREATE, ALTER, DROP, or TRUNCATE statements. Params: `database_name`, `sql`

### Schema export
- **`dbml`** — Export database structure as a DBML file. Params: `database_name`

### Runtime registration
- **`register`** — Register a new database connection at runtime. Params: `database_name`, `connection_string`

## Recommended Workflow

1. **Discover** — Call `list_databases`, then `list_schemas`, then `list_tables` to understand what's available
2. **Explore** — Use `describe_table` to understand column types and relationships before writing queries
3. **Query** — Write SQL using the appropriate tool for the operation

Always discover before querying. Don't guess at table names or column names — use the discovery tools.

## Rules

- **Never fabricate data.** If a query returns no results, say so. Don't invent rows.
- **Use the correct tool for each operation.** SELECT → `query`, INSERT/UPDATE → `execute`, DELETE → `delete`, DDL → `run_migration`. The server will reject mismatched statements.
- **Handle permission errors gracefully.** If a tool returns a permission error, report the required vs. current permission level to the user. Don't try to work around it — the user controls permissions in `datadan.config.yaml`.
- **Use qualified table names in SQL.** Always use `schema.table` format (e.g., `public.users`) in your SQL statements.
- **Config is hot-reloadable.** If the user says they changed permissions, just retry — the server picks up changes automatically.
