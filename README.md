# DataDan

PostgreSQL MCP server that gives Claude Code permission-bound database access via a YAML config.

Point it at your databases, set permissions per schema or table, and Claude can browse structure, query data, run migrations — all within the boundaries you define.

## Install

```bash
npm install -g datadan
```

Or use directly with `npx` (no install needed).

## Quick Start

In any project directory with a `.env` containing PostgreSQL connection strings:

```bash
npx datadan init
```

This will:
1. Scan your `.env` for `postgres://` connection strings
2. Connect and discover all schemas and tables
3. Create `datadan.config.yaml` with everything locked to `read`
4. Register DataDan in `.mcp.json` so Claude Code picks it up automatically

That's it. Restart Claude Code and it has read access to your databases.

## Use in Any Project

### Option A: Init per project

Run `npx datadan init` in each project directory. This creates a local config and `.mcp.json` entry.

### Option B: Global config, point from anywhere

Create one config file anywhere:

```yaml
name: my-databases
default-permission: read
hot-reload: true

databases:
  - name: production
    connection_string: ${DATABASE_URL}
  - name: analytics
    connection_string: ${ANALYTICS_DB_URL}
```

Then in any project's `.mcp.json`:

```json
{
  "mcpServers": {
    "datadan": {
      "command": "npx",
      "args": ["datadan", "start", "--config", "/path/to/datadan.config.yaml"]
    }
  }
}
```

Or set the env var `DATADAN_CONFIG` to point to your config.

### Option C: User-level MCP config

Add to `~/.claude/settings.json` to make DataDan available in every project:

```json
{
  "mcpServers": {
    "datadan": {
      "command": "npx",
      "args": ["datadan", "start", "--config", "/home/you/datadan.config.yaml"]
    }
  }
}
```

## Config

`datadan.config.yaml` controls what Claude can do:

```yaml
name: my-project
default-permission: read
hot-reload: true

databases:
  - name: main
    connection_string: ${DATABASE_URL}
    # permission: write          # override default for this database

    # schemas:
    #   - name: public
    #     permission: write       # override for this schema
    #     tables:
    #       - name: users
    #         permission: none    # block access to this table
```

### Permissions

Permissions cascade: `default-permission` -> `database` -> `schema` -> `table`. The most specific override wins.

| Level | What Claude Can Do |
|-------|-------------------|
| `none` | No access at all |
| `read` | SELECT, describe tables |
| `write` | read + INSERT, UPDATE |
| `delete` | write + DELETE |
| `yolo` | delete + CREATE, ALTER, DROP, TRUNCATE |

### Environment Variables

Connection strings support `${ENV_VAR}` syntax. DataDan loads `.env` from the same directory as the config file. Shell/CI variables take precedence.

### Hot Reload

With `hot-reload: true`, DataDan re-reads the config before each tool call. Change permissions mid-session without restarting.

## Tools

Once connected, Claude Code gets these tools:

| Tool | Permission | Description |
|------|-----------|-------------|
| `list_databases` | any | List all accessible databases |
| `list_schemas` | any | List schemas in a database |
| `list_tables` | any | List tables in a schema |
| `describe_table` | read | Show columns, types, keys, and constraints |
| `query` | read | Run SELECT statements |
| `execute` | write | Run INSERT / UPDATE statements |
| `delete` | delete | Run DELETE statements |
| `run_migration` | yolo | Run DDL (CREATE, ALTER, DROP, TRUNCATE) |
| `dbml` | read | Export database structure as a DBML file |
| `register` | - | Add a new database connection at runtime |

## Dry Run

Preview resolved permissions without starting the server:

```bash
npx datadan start --dry-run
```

```
 Database | Schema | Table    | Permission
----------+--------+----------+-----------
 main     | public | users    | read
 main     | public | posts    | write
 main     | public | secrets  | none
```

## Schema Sync

DataDan auto-discovers new schemas and tables on startup and periodically during use. If you add a table to your database, it appears in the config automatically — inheriting the nearest permission level.
