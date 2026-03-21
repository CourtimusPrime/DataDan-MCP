# PRD: DataDan — PostgreSQL MCP Server with Permission-Bound Access

## Introduction

DataDan is a PostgreSQL MCP server that gives coding agents (e.g. Claude Code) permission-bound access to databases. It solves the problem that developers either give their AI agents full database access (risking catastrophic data loss) or no access at all, because managing Postgres `GRANT`/`REVOKE` permissions is too much friction for typical workflows.

DataDan proxies agent queries through a permission layer configured in a single YAML file. Developers connect multiple PostgreSQL databases and define per-table, per-schema, or per-database permissions — all without touching Postgres roles or SQL grants. Blocked queries return structured MCP errors the agent can reason about.

This PRD covers the full v1 implementation from scratch.

---

## Goals

- Allow developers to configure database permissions for AI agents in a single YAML file in under 5 minutes
- Enforce permission levels (`read`, `write`, `delete`, `none`, `yolo`) at the table, schema, and database level
- Support multiple PostgreSQL databases (local and remote) from one config
- Ship as an npm package runnable via `npx datadan`
- Integrate natively with Claude Code via MCP stdio transport
- Provide clear, agent-understandable error messages when queries are blocked
- Auto-sync config against live database schemas (add new tables, drop stale entries)
- Support hot-reload so developers can change permissions mid-session

---

## User Stories

### US-001: Parse and validate YAML config
**Description:** As a developer, I want DataDan to load and validate my `datadan.config.yaml` so that misconfigured files are caught before any database connection is attempted.

**Acceptance Criteria:**
- [ ] Parses `datadan.config.yaml` from the working directory by default
- [ ] Accepts config path via `DATADAN_CONFIG` env var or `--config` CLI flag
- [ ] Validates required fields: `name`, `default-permission`, `databases` array
- [ ] Validates each database entry has `name` and `connection_string`
- [ ] Validates all `permission` values are one of: `read`, `write`, `delete`, `none`, `yolo`
- [ ] Resolves `${ENV_VAR}` references in `connection_string` values from `process.env`
- [ ] Returns clear error messages with line context for invalid config
- [ ] Typecheck passes

### US-002: Resolve permissions with cascading precedence
**Description:** As a developer, I want permissions to cascade from database to schema to table, with more specific rules winning, so that I can set broad defaults and override per-table.

**Acceptance Criteria:**
- [ ] Table-level permission overrides schema-level
- [ ] Schema-level permission overrides database-level
- [ ] Database-level permission overrides top-level `default-permission`
- [ ] If no permission is set at any level, `default-permission` applies
- [ ] Resolution is deterministic and returns exactly one permission level per table
- [ ] Typecheck passes

### US-003: Classify SQL queries by permission requirement
**Description:** As the system, I need to determine the minimum permission level required for any SQL query so that I can allow or block it.

**Acceptance Criteria:**
- [ ] `SELECT` queries require `read`
- [ ] `INSERT` and `UPDATE` queries require `write`
- [ ] `DELETE` queries require `delete`
- [ ] DDL statements (`CREATE`, `ALTER`, `DROP`, `TRUNCATE`) require `yolo`
- [ ] Multi-statement queries are classified by the highest permission required
- [ ] Queries referencing multiple tables are checked against all referenced tables — the query is blocked if any referenced table lacks sufficient permission
- [ ] Typecheck passes

### US-004: Connect to PostgreSQL databases
**Description:** As a developer, I want DataDan to establish connections to the PostgreSQL databases listed in my config so that the agent can query them.

**Acceptance Criteria:**
- [ ] Connects to each database in the `databases` array using the resolved `connection_string`
- [ ] Supports standard Postgres connection strings (`postgres://user:pass@host:port/db`)
- [ ] Supports `?sslmode=require` and SSL certificate options via the `pg` driver
- [ ] Works with remote hosts (RDS, Supabase, Neon, Railway, Cloud SQL)
- [ ] Handles connection failures gracefully with clear error messages per database
- [ ] Does not crash if one database is unreachable — other databases remain available
- [ ] Typecheck passes

### US-005: Implement MCP server with stdio transport
**Description:** As the system, I need to expose DataDan's capabilities as MCP tools over stdio so that Claude Code can invoke them.

**Acceptance Criteria:**
- [ ] Starts an MCP server using `@modelcontextprotocol/sdk`
- [ ] Uses stdio transport (stdin/stdout)
- [ ] Registers all agent tools (see US-006 through US-015)
- [ ] Responds to MCP `list_tools` with all available tools and their schemas
- [ ] Handles MCP protocol errors gracefully
- [ ] Typecheck passes

### US-006: Tool — `register`
**Description:** As an agent, I want to register a new database connection string at runtime so that I can add databases without editing the config file manually.

**Acceptance Criteria:**
- [ ] Accepts a database name and connection string
- [ ] Adds the database to the running config with `default-permission` applied
- [ ] Writes the new entry to `datadan.config.yaml`
- [ ] Validates the connection string by attempting a connection before persisting
- [ ] Returns success confirmation or structured error
- [ ] Typecheck passes

### US-007: Tool — `list_databases`
**Description:** As an agent, I want to list all accessible databases so that I know what data sources are available.

**Acceptance Criteria:**
- [ ] Returns names of all databases with permission >= `read`
- [ ] Excludes databases with `none` permission entirely
- [ ] Requires minimum `read` permission on at least one target within the database
- [ ] Typecheck passes

### US-008: Tool — `list_schemas`
**Description:** As an agent, I want to list accessible schemas within a database so that I can navigate the data structure.

**Acceptance Criteria:**
- [ ] Accepts a database name parameter
- [ ] Returns schema names with permission >= `read`
- [ ] Excludes schemas with `none` permission entirely
- [ ] Returns structured error if database name is invalid or inaccessible
- [ ] Typecheck passes

### US-009: Tool — `list_tables`
**Description:** As an agent, I want to list tables in a schema so that I can discover available data.

**Acceptance Criteria:**
- [ ] Accepts database name and schema name parameters
- [ ] Returns table names with permission >= `read`
- [ ] Excludes tables with `none` permission entirely
- [ ] Returns structured error if schema is invalid or inaccessible
- [ ] Typecheck passes

### US-010: Tool — `describe_table`
**Description:** As an agent, I want to see column definitions, types, and constraints for a table so that I can write correct queries.

**Acceptance Criteria:**
- [ ] Accepts database name, schema name, and table name parameters
- [ ] Returns column names, data types, nullable flags, default values, and constraints (PK, FK, unique)
- [ ] Requires minimum `read` permission on the table
- [ ] Returns structured error if table has `none` permission or doesn't exist
- [ ] Typecheck passes

### US-011: Tool — `dbml`
**Description:** As an agent, I want to export the database structure as a DBML file so that I can understand the full schema at a glance.

**Acceptance Criteria:**
- [ ] Accepts a database name parameter
- [ ] Generates valid DBML output covering all accessible schemas and tables
- [ ] Excludes tables/schemas with `none` permission
- [ ] Writes the `.dbml` file to the project root
- [ ] Requires minimum `read` permission
- [ ] Typecheck passes

### US-012: Tool — `query`
**Description:** As an agent, I want to run SELECT queries so that I can read data from the database.

**Acceptance Criteria:**
- [ ] Accepts a database name and SQL string
- [ ] Only allows SELECT statements
- [ ] Checks `read` permission on all referenced tables
- [ ] Returns query results as structured data (rows + column metadata)
- [ ] Returns structured error with explanation if permission is insufficient
- [ ] Returns structured error if the SQL is not a SELECT
- [ ] Typecheck passes

### US-013: Tool — `execute`
**Description:** As an agent, I want to run INSERT and UPDATE statements so that I can modify data when permitted.

**Acceptance Criteria:**
- [ ] Accepts a database name and SQL string
- [ ] Allows INSERT and UPDATE statements
- [ ] Checks `write` permission on all referenced tables
- [ ] Returns affected row count
- [ ] Returns structured error with explanation if permission is insufficient
- [ ] Typecheck passes

### US-014: Tool — `delete`
**Description:** As an agent, I want to run DELETE statements so that I can remove data when permitted.

**Acceptance Criteria:**
- [ ] Accepts a database name and SQL string
- [ ] Allows DELETE statements only
- [ ] Checks `delete` permission on all referenced tables
- [ ] Returns affected row count
- [ ] Returns structured error with explanation if permission is insufficient
- [ ] Typecheck passes

### US-015: Tool — `run_migration`
**Description:** As an agent, I want to run DDL statements (CREATE, ALTER, DROP) so that I can modify database structure when explicitly permitted.

**Acceptance Criteria:**
- [ ] Accepts a database name and SQL string
- [ ] Allows DDL statements (CREATE, ALTER, DROP, TRUNCATE, etc.)
- [ ] Checks `yolo` permission on all referenced targets
- [ ] `yolo` on one target does not grant access to other targets
- [ ] Returns execution result or structured error
- [ ] Returns structured error with explanation if permission is insufficient
- [ ] Typecheck passes

### US-016: Blocked query feedback
**Description:** As an agent, I want clear error messages when a query is blocked so that I can explain the situation to the developer and adjust my approach.

**Acceptance Criteria:**
- [ ] Blocked query errors include: the tool invoked, the target (database/schema/table), the required permission level, and the current permission level
- [ ] Error message is a structured MCP error (not a raw string)
- [ ] Error message is phrased so the agent can report it to the user without additional context
- [ ] Example: `"Permission denied: table 'public.users' has permission 'read', but DELETE requires 'delete'. Ask the developer to update datadan.config.yaml if this access is needed."`
- [ ] Typecheck passes

### US-017: Schema sync on startup
**Description:** As a developer, I want DataDan to reconcile my config against the live database on startup so that new tables are auto-added and stale entries are dropped.

**Acceptance Criteria:**
- [ ] On startup, queries each connected database for current schemas and tables
- [ ] Tables/schemas in config that no longer exist in the DB are silently removed from config
- [ ] New tables/schemas in the DB that are not in config are added with the applicable default permission (schema default, then top-level `default-permission`)
- [ ] Updates `datadan.config.yaml` in-place with the reconciled state
- [ ] Does not alter permissions of entries that already exist in config
- [ ] Typecheck passes

### US-018: Hot-reload config
**Description:** As a developer, I want DataDan to re-read the config file on every tool invocation (when `hot-reload: true`) so that I can change permissions mid-session without restarting.

**Acceptance Criteria:**
- [ ] When `hot-reload: true`, re-reads and re-parses `datadan.config.yaml` before each tool invocation
- [ ] Re-runs schema sync on reload
- [ ] When `hot-reload: false`, config is loaded once at startup
- [ ] Invalid config on reload logs a warning and continues with the last valid config
- [ ] Typecheck passes

### US-019: CLI — `datadan init`
**Description:** As a developer, I want to scaffold a starter `datadan.config.yaml` in my project so that I can get started quickly.

**Acceptance Criteria:**
- [ ] Running `npx datadan init` creates a `datadan.config.yaml` in the current directory
- [ ] Scaffolded config includes placeholder values with comments explaining each field
- [ ] Does not overwrite an existing `datadan.config.yaml` (warns and exits)
- [ ] Typecheck passes

### US-020: CLI — `datadan start`
**Description:** As a developer (or Claude Code), I want to start the MCP server from the command line so that it can begin handling agent requests.

**Acceptance Criteria:**
- [ ] Running `npx datadan start` starts the MCP server over stdio
- [ ] Accepts `--config <path>` flag to specify config file location
- [ ] Reads `DATADAN_CONFIG` env var as fallback config path
- [ ] Falls back to `./datadan.config.yaml` if neither is provided
- [ ] Runs schema sync on all configured databases before accepting requests
- [ ] Exits with clear error if no valid config is found
- [ ] Typecheck passes

### US-021: CLI — `datadan start --dry-run`
**Description:** As a developer, I want a preview mode that shows what the agent would be allowed to do without executing anything, so that I can validate my config.

**Acceptance Criteria:**
- [ ] `--dry-run` flag connects to databases and runs schema sync but does not start the MCP server
- [ ] Outputs a summary table of all databases, schemas, tables, and their resolved permissions
- [ ] Highlights any `yolo` permissions with a warning
- [ ] Exits after printing the summary
- [ ] Typecheck passes

### US-022: npm package setup
**Description:** As a developer, I want to install and run DataDan via `npx datadan` so that no global install is required.

**Acceptance Criteria:**
- [ ] `package.json` configured with `bin` entry pointing to the CLI entrypoint
- [ ] Package name is `datadan` on npm
- [ ] `npx datadan init` and `npx datadan start` work without prior installation
- [ ] Package includes only necessary files (no tests, no dev config)
- [ ] Typecheck passes

---

## Functional Requirements

- FR-1: DataDan must load config from `datadan.config.yaml`, a `--config` CLI flag, or the `DATADAN_CONFIG` env var (in that precedence order: CLI flag > env var > default path)
- FR-2: Config must support environment variable interpolation in `connection_string` fields using `${VAR_NAME}` syntax
- FR-3: Permission levels are: `read` (SELECT), `write` (SELECT + INSERT + UPDATE), `delete` (SELECT + INSERT + UPDATE + DELETE), `none` (invisible), `yolo` (full access including DDL)
- FR-4: Permission resolution follows: table > schema > database > `default-permission`, with most-specific winning
- FR-5: Targets with `none` permission must be completely invisible to the agent — excluded from all `list_*` responses
- FR-6: `yolo` permission is scoped to its specific target and does not affect any other target
- FR-7: SQL queries must be classified by statement type to determine required permission level
- FR-8: Multi-table queries must check permissions on all referenced tables; the query is blocked if any table lacks sufficient permission
- FR-9: Blocked queries must return structured MCP errors containing: target, required permission, current permission, and a human-readable explanation
- FR-10: Schema sync must run on startup and on every hot-reload, adding new DB objects at `default-permission` and removing stale config entries
- FR-11: Schema sync must update `datadan.config.yaml` in-place
- FR-12: Hot-reload (when enabled) must re-read config before every tool invocation
- FR-13: The MCP server must use stdio transport
- FR-14: The `register` tool must validate connectivity before persisting a new database to config
- FR-15: Connection failures for one database must not prevent other databases from being available
- FR-16: The `--dry-run` flag must output a permission summary without starting the MCP server

---

## Non-Goals (v1)

- **Audit logging.** No query logging or access audit trail. Developers can wire in their own observability.
- **MySQL / SQLite support.** PostgreSQL only.
- **Role-based access per agent.** All agents share the same permission config. Multi-agent RBAC is future work.
- **GUI config editor.** Config is file-based only.
- **Network-exposed proxy.** DataDan runs locally over stdio — it is not a networked service.
- **Connection pooling.** v1 uses connect-on-demand. Persistent connections and PgBouncer compatibility are deferred.
- **Row-level or column-level permissions.** Permissions are at the table level at most.
- **Transaction management.** Queries are executed as individual statements, not within managed transactions.

---

## Architecture & Technical Considerations

### Project Structure

```
datadan/
  package.json
  tsconfig.json
  src/
    index.ts              # CLI entrypoint (commander or yargs)
    server.ts             # MCP server setup and tool registration
    config/
      parser.ts           # YAML parsing, validation, env var interpolation
      schema.ts           # TypeScript types/interfaces for config
      resolver.ts         # Permission resolution logic (table > schema > db > default)
    db/
      connection.ts       # pg Pool management, connect/disconnect per database
      introspect.ts       # Schema introspection (list schemas, tables, columns)
      sync.ts             # Schema sync — reconcile config vs live DB
    permissions/
      classifier.ts       # SQL statement classification (SELECT → read, INSERT → write, etc.)
      checker.ts          # Check a query against resolved permissions for all referenced tables
      errors.ts           # Structured MCP error builders for blocked queries
    tools/
      register.ts         # register tool handler
      list.ts             # list_databases, list_schemas, list_tables handlers
      describe.ts         # describe_table handler
      dbml.ts             # dbml export handler
      query.ts            # query tool handler (SELECT only)
      execute.ts          # execute tool handler (INSERT/UPDATE)
      delete.ts           # delete tool handler (DELETE)
      migration.ts        # run_migration tool handler (DDL)
```

### Key Libraries

| Library | Purpose |
|---|---|
| `@modelcontextprotocol/sdk` | MCP server and tool registration |
| `pg` (node-postgres) | PostgreSQL driver |
| `js-yaml` | YAML parsing and serialization |
| `zod` | Config schema validation |
| `commander` | CLI argument parsing |
| `node-sql-parser` | SQL statement parsing and table extraction |

### SQL Classification Strategy

Use `node-sql-parser` to parse incoming SQL and extract:
1. **Statement type** — `SELECT`, `INSERT`, `UPDATE`, `DELETE`, `CREATE`, `ALTER`, `DROP`, `TRUNCATE`
2. **Referenced tables** — all tables the query touches (including JOINs, subqueries, CTEs)

Map statement types to permission levels:
- `SELECT` → `read`
- `INSERT`, `UPDATE` → `write`
- `DELETE` → `delete`
- `CREATE`, `ALTER`, `DROP`, `TRUNCATE` → `yolo`

For multi-statement SQL, take the highest permission required across all statements. For multi-table queries, check every referenced table and block if any lacks sufficient permission.

### Config Hot-Reload Strategy

When `hot-reload: true`, wrap each tool handler in middleware that:
1. Reads and parses the YAML config
2. Runs schema sync against connected databases
3. Rebuilds the permission resolution map
4. Then executes the tool logic

Cache the last valid config. If a reload produces an invalid config, log a warning and continue with the cached version.

### Schema Introspection

Use `information_schema.schemata` and `information_schema.tables` to discover current schemas and tables. Compare against config entries:
- **Present in DB, missing from config** → add with applicable default permission
- **Present in config, missing from DB** → remove from config
- **Present in both** → keep existing permission, no change

Write back to `datadan.config.yaml` using `js-yaml` dump. Note: this will not preserve YAML comments (acceptable for v1 — see Open Questions).

### Connection Management

Use `pg.Pool` with one pool per database. Pools are created on startup (or on `register`) and reused across tool invocations. Connect-on-demand: pools are lazy — the first query triggers the actual connection.

### Error Structure

Blocked query errors returned to the agent should follow this shape:

```typescript
{
  isError: true,
  content: [{
    type: "text",
    text: "Permission denied: table 'public.users' has permission 'read', but DELETE requires 'delete'. Update datadan.config.yaml to grant 'delete' permission on this table if needed."
  }]
}
```

---

## Success Metrics

| Metric | Target |
|---|---|
| Time to first working config | < 5 minutes from install |
| Config file lines for a typical 3-database setup | < 40 lines |
| Zero false-positive permission blocks | 100% — permitted queries always go through |
| Blocked query clarity | Agent can explain the block to the user without additional context |
| Schema sync accuracy | No manual config edits needed after DB schema changes |

---

## Open Questions

1. **Schema sync write-back format.** `js-yaml` dump will not preserve YAML comments. Accept this for v1, or use a comment-preserving library like `yaml` (the `yaml` npm package supports comment round-tripping)?
2. **`/dd-setup` skill scope.** The README mentions a `/dd-setup` agent skill for auto-configuring from `.env` files. Should this be a Claude Code slash command (custom skill) or just the `register` MCP tool? Needs design.
3. **`yolo` schema sync inheritance.** When a new table appears inside a `yolo` schema, it inherits `yolo`. Should DataDan log a warning for this case since destructive access on a new table may be unexpected?
4. **SQL parser coverage.** `node-sql-parser` may not cover all Postgres-specific syntax (e.g., `COPY`, `EXPLAIN`, `LISTEN/NOTIFY`). Define a fallback policy: block unrecognized statements, or allow them at `yolo` only?
5. **Connection string security.** Connection strings contain credentials. Should DataDan redact them in error messages and dry-run output?
6. **Config file locking.** If hot-reload reads the config while the user is editing it, partial reads could occur. Worth adding file locking or atomic read?
