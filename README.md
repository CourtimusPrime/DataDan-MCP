# DataDan

A minimalist PostgreSQL MCP that gives Claude Code permission-bound access to your database.

- **Problem**: AI agents are notorious for accidentally deleting databases because there is nothing declarative to prevent sessions from over-stepping or acting impulsively.
- **Solution**: DataDan lets you grant scoped permissions to your database, schemas, and tables.

## Quick Start

Add a `.env` with a PostgreSQL connection string to your project, then add DataDan to `.mcp.json`:

```json
{
  "mcpServers": {
    "datadan": {
      "command": "npx",
      "args": ["-y", "datadan", "start"]
    }
  }
}
```

That's it. On first run, DataDan auto-discovers your databases, creates `datadan.config.yaml` with read-only access, and starts the MCP server — all in one pass. Restart Claude Code and it has read access to your databases.

## Use in Any Project

### Option A: Per-project (default)

Add the `.mcp.json` entry above to each project directory. On first `start`, DataDan scans `.env`, creates `datadan.config.yaml`, and registers itself.

To re-initialize manually:

```bash
npx datadan init
```

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

Or set `DATADAN_CONFIG` env var to point to your config.

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

## Security

DataDan enforces permissions at the application layer — it parses every SQL statement, resolves table-level permissions from your config, and blocks statements that exceed the granted level. It also writes a `CLAUDE.md` instruction telling Claude Code to never connect to PostgreSQL directly.

**This is not sufficient on its own.** Claude Code has a Bash tool and can read your `.env`. A determined or mistaken model can bypass DataDan entirely by running `psql $DATABASE_URL` or writing a script that connects directly.

### Use a restricted PostgreSQL user

The only enforcement that cannot be bypassed is PostgreSQL-level permissions. Your `DATABASE_URL` should point to a user with grants that match your DataDan config:

```sql
-- For read-only access
CREATE USER datadan_readonly WITH PASSWORD 'yourpassword';
GRANT CONNECT ON DATABASE yourdb TO datadan_readonly;
GRANT USAGE ON SCHEMA public TO datadan_readonly;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO datadan_readonly;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT ON TABLES TO datadan_readonly;
```

If DataDan's config is `read`, the DB user should only have `SELECT`. Even if a model bypasses DataDan and connects directly, it hits the same wall.

### Keep the config outside the project directory

With `hot-reload: true`, DataDan re-reads `datadan.config.yaml` before each tool call. If the file is writable by Claude Code, a model could escalate its own permissions mid-session.

Move the config file outside the project and point to it via `DATADAN_CONFIG`:

```bash
# In your shell or CI env
export DATADAN_CONFIG=/etc/datadan/myproject.yaml
```

Or use `--config` in your `.mcp.json`:

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

### Defense in depth

| Layer | What it stops |
|-------|--------------|
| Restricted DB user | Direct bypass via Bash/psql/scripts |
| DataDan permission gates | Accidental over-reach through MCP tools |
| Config outside project dir | Mid-session self-escalation via hot-reload |
| `CLAUDE.md` instruction | Well-behaved models using wrong access path |

DataDan is most effective as the right-path guardrail on top of a least-privilege DB user — not as a standalone security boundary.

## Schema Sync

DataDan auto-discovers new schemas and tables on startup and periodically during use. If you add a table to your database, it appears in the config automatically — inheriting the nearest permission level.
