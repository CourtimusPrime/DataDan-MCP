# DataDan

**Status:** Draft  
**Last updated:** 2026-03-21

---

DataDan is a PostgreSQL MCP server that gives coding agents permission-bound access to databases.

DataDan gives solo developers explicit, config-driven control over what their coding agents can do to their databases — without needing to juggle Postgres roles, `GRANT`/`REVOKE` SQL, or database administration.

---

## Problem

When Claude Code is given a Postgres connection string, developers are exposed to [catastrophic data loss](https://uk.pcmag.com/ai/159249/vibe-coding-fiasco-ai-agent-goes-rogue-deletes-companys-entire-database). The correct alternative would be to manage `GRANT`/`REVOKE` permissions, but that's a lot of friction for something that should be really simple. Instead, most developers default to giving their agents full access or none at all.

---

## Solution

DataDan proxies agent queries through a permission layer you configure in a YAML file. Connect to multiple PostgreSQL databases and give your agents specific access to specific data models.

### Three Perks

**1. Minimal config.** Use `/dd-setup` to let your agent read your `.env` connection strings and register them in `datadan.config.yaml`. Permissions are set to `read` for everything by default[^setup].

[^setup]: Use `/dd-setup none` to set the default permission to `none`.

**2. Agent-aware UX.** DataDan speaks MCP natively. Blocked queries return structured errors the agent can reason about and report back to you. The agent understands _why_ it can't do something.

**3. Fine-grained per-table control in one config.** DataDan lets you express rules at the table level — one config file across all your databases, regardless of where they're hosted.

---

## Core Concepts

### Permission Levels

- `read` — SELECT only
- `write` — SELECT + INSERT + UPDATE
- `delete` — SELECT + INSERT + UPDATE + DELETE
- `none` — target is invisible to the agent entirely
- `yolo` — full access including DDL (`DROP TABLE`, `DROP SCHEMA [...] CASCADE`, etc.). Requires explicit opt-in per target.

> **`yolo` is scoped, not global.** It applies only to the specific database, schema, or table it's set on. It does not override the permissions of any other target in the config — an agent operating on a `yolo` schema cannot use that to affect a `read` schema next to it. Each target's permission is evaluated independently.

### Permission Targets

- Entire database
- Schema within a database
- Individual table

More specific rules take precedence over broader ones (table > schema > database), i.e. read one table in a schema but hide everything else.

---

## Config

DataDan is configured with a root `datadan.config.yaml`, or pointed to via an env var / CLI flag.

```yaml
name: claude code session
default-permission: read
hot-reload: true

databases:
  - name: my_database
    connection_string: ${DATABASE_URL}
    schemas:
      - name: public
        permission: read
        tables:
          - name: users
            permission: none
          - name: orders
            permission: read
          - name: analytics
            permission: write
      - name: private
        permission: write
        tables:
          - name: secrets
            permission: write

  - name: another_database
    connection_string: ${ANOTHER_DATABASE_URL}
    schemas:
      - name: main
        permission: read
        tables:
          - name: products
            permission: read
          - name: sales
            permission: read
      - name: archive
        permission: yolo
```

### Top-level config fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Human-readable label for this config (e.g. session name) |
| `default-permission` | permission level | Fallback permission for any target not explicitly listed |
| `hot-reload` | boolean | If `true`, DataDan re-reads `datadan.config.yaml` on every use — no restart needed |

### Permission resolution order
1. Table-level rule (most specific)
2. Schema-level permission
3. Database-level permission (if set)
4. Top-level `default-permission`

---

## Schema Sync

DataDan validates the config against the live database on startup and on every hot-reload. Rather than failing on mismatches, it reconciles silently:

- **Table or schema in config no longer exists** → entry is ignored. No error, no friction. Databases change.
- **New table or schema exists in the DB but not in config** → automatically added to the config with the applicable `default-permission` (schema default, or top-level default if no schema default is set).

The `datadan.config.yaml` is updated in-place to reflect the current state of the database. The config file is always an accurate picture of what DataDan knows about, and new tables are never silently granted more access than intended.

---

## Agent Skills

| Tool | Description | Minimum permission |
|---|---|---|
| `register` | Register a new database connection string (defaults to `read`) | — |
| `list_databases` | List accessible databases | read |
| `list_schemas` | List accessible schemas in a database | read |
| `list_tables` | List tables in a schema | read |
| `describe_table` | Get column definitions, types, constraints | read |
| `dbml` | Export the database structure as a `.dbml` file at project root | read |
| `query` | Run a SELECT query | read |
| `execute` | Run INSERT / UPDATE statements | write |
| `delete` | Run DELETE statements | delete |
| `run_migration` | Execute DDL (CREATE, ALTER, DROP) | yolo |


Targets with `none` permission are excluded from `list_*` responses entirely — they don't exist from the agent's perspective.

> **Note on `yolo` and `run_migration`:** `yolo` is not a global override. It must be explicitly set on the specific database, schema, or table the agent is operating on. An agent cannot invoke `run_migration` on a target unless that exact target has `yolo` set — no other permission level unlocks it, and `yolo` on one target never bleeds into another.

---

## Key Features

**1. Multi-database support.** One DataDan instance manages all your Postgres connections — local or remote (RDS, Supabase, Neon, Railway, etc.).

**2. Permission hierarchy.** Permissions cascade from database → schema → table, with more specific rules always winning.

**3. Hot-reload.** When `hot-reload: true`, DataDan re-reads `datadan.config.yaml` on every use. Edit permissions mid-session without restarting.

**4. Live schema sync.** On every load, DataDan reconciles the config against the live database. New tables and schemas are auto-added at `default-permission`. Stale entries are silently dropped. The config stays current automatically.

**5. Preview mode.** Run DataDan with `--dry-run` to see what the agent would be allowed to do without executing anything. Useful for validating a config before opening it to an agent session.

**6. Blocked query feedback.** When an agent attempts an action it doesn't have permission for, DataDan returns a clear explanation that helps the agent auto-correct rather than silently fail.

---

## Distribution & Installation

DataDan ships as an npm package. No global install required.

```bash
# Scaffold a config in the current project
npx datadan init

# Start the MCP server (called by Claude Code, not manually)
npx datadan start --config ./datadan.config.yaml
```

### Claude Code integration

Add DataDan to your project's `.claude/mcp.json` (or global `~/.claude/mcp.json`):

```json
{
  "mcpServers": {
    "datadan": {
      "command": "npx",
      "args": ["datadan", "start"],
      "env": {
        "DATADAN_CONFIG": "./datadan.config.yaml"
      }
    }
  }
}
```

---

## Technical Notes

- **Transport:** MCP stdio (runs locally, connects outbound to remote or local DBs)
- **Language:** TypeScript
- **Distribution:** npm (`npx datadan`) — no global install required
- **Config format:** YAML primary, JSON supported
- **Remote DB support:** Any Postgres-compatible host reachable via connection string — RDS, Supabase, Neon, Railway, Cloud SQL, etc.
- **SSL:** Connection strings support `?sslmode=require` and certificate options via the `pg` driver
- **Postgres driver:** `pg` (node-postgres)
- **MCP SDK:** `@modelcontextprotocol/sdk`

---

## Success Metrics

| Metric | Target |
|---|---|
| Time to first working config | < 5 minutes from install |
| Config file lines for a typical 3-DB setup | < 40 lines |
| Zero false-positive permission blocks | 100% — permitted queries must always go through |
| Blocked query clarity | User can understand why a query was blocked without reading docs |

---

## Non-Goals (v1)

- **Audit logging.** Out of scope — users can wire in their own observability tooling if needed.
- **MySQL / SQLite support.** PostgreSQL only.
- **Role-based access per agent.** All agents share the same permission config. Multi-agent RBAC is a future consideration.
- **GUI config editor.** Config is file-based. A UI can come later.
- **Network-exposed proxy.** DataDan runs as a local MCP server over stdio — it is not itself a networked service.

---

## Open Questions

1. **Schema sync write-back format.** When DataDan auto-adds new tables to `datadan.config.yaml`, should it preserve comments and formatting, or rewrite cleanly? YAML round-trip without comment preservation is a known pain point worth deciding early.
2. **`/dd-setup` permission prompt.** When registering a new database, should `/dd-setup` ask the agent to confirm the default permission before writing to config, or always use the top-level `default-permission` silently?
3. **Connection pooling.** Persistent connections vs. connect-on-demand. For remote DBs, persistent connections matter for latency but may need keepalive config for long-idle sessions. PgBouncer compatibility worth considering.
4. **`yolo` schema sync inheritance.** When schema sync auto-adds a new table inside a `yolo` schema, it inherits `yolo`. Should DataDan surface a warning in this case, since a new table silently receiving destructive access may be unexpected?