# DataDan MCP — Testing Report

**Date:** 2026-03-21
**Tester:** Simulated real-world user in `example/` directory
**Database:** Railway PostgreSQL (sandbox) with schemas: catalog, inventory, public, sales
**Config permissions:** catalog=read, inventory=write, public=none, sales=delete (customers=none)

---

## Test Results Summary

**Initial run:** 18 passed, 4 failed
**After fixes:** 13/13 regression tests passing (all bugs verified fixed)

---

## Bugs Found & Fixed

### BUG-001: CRITICAL — `run_migration` bypasses permission checks on ALTER TABLE

**Severity:** Critical (security vulnerability)
**Status:** FIXED
**Tool:** `run_migration`
**Reproduction:**

Config has `catalog` schema set to `permission: read`. Running:
```
run_migration({ database_name: "sandbox", sql: "ALTER TABLE catalog.albums ADD COLUMN test_col TEXT" })
```
**Expected:** Permission denied — DDL requires `yolo` permission.
**Actual (before fix):** ALTER TABLE executes successfully. Column was added to a read-only schema.

**Root cause:** `node-sql-parser`'s `parser.tableList()` returns `[]` for ALTER TABLE statements, even though the AST correctly contains the table reference (`{ db: "catalog", table: "albums" }`). The permission checker in `checker.ts` loops over `referencedTables` — when empty, it skips all checks and returns `{ allowed: true }`.

CREATE TABLE, DROP TABLE, and TRUNCATE are NOT affected — `tableList()` correctly extracts tables for those statement types. Only ALTER TABLE is broken.

**Impact:** Any agent can ALTER any table in any database, regardless of permission level. This defeats the core purpose of DataDan.

**Fix applied:**
1. `src/permissions/classifier.ts` — `extractTables()` now falls back to AST inspection when `parser.tableList()` returns empty. For ALTER TABLE, the AST contains `{ table: [{ db: "catalog", table: "albums" }] }`, which is properly extracted.
2. `src/permissions/checker.ts` — Defense-in-depth: if `referencedTables` is empty and `requiredPermission` is not `read`, the query is denied with "Could not determine target tables for this statement. Permission denied for safety."

---

### BUG-002: SECURITY — Schema sync leaks raw connection strings to config file

**Severity:** High (credential exposure)
**Status:** FIXED
**Component:** `config/parser.ts` + `config/schema.ts`
**Reproduction:**

1. Set `connection_string: ${SANDBOX_DATABASE_URL}` in config
2. Start DataDan (triggers schema sync)
3. Schema sync discovers new schemas/tables and calls `writeConfig()`
4. Config file on disk now contains the raw PostgreSQL connection string with username and password

**Expected:** Config file preserves `${SANDBOX_DATABASE_URL}` env var reference.
**Actual (before fix):** Config file contains `postgresql://postgres:RXBKjaH...@caboose.proxy.rlwy.net:39116/railway`.

**Root cause:** `loadConfig()` saves the original template in `_connection_string_template` on the raw object before Zod validation. But `DatabaseConfigSchema` was a strict `z.object()` which strips unknown keys. After `safeParse()`, `_connection_string_template` was gone. When `writeConfig()` checked for it, it was missing, so the resolved (secret-containing) string was written to disk.

**Impact:** Database credentials written to the config file in plaintext. If committed to git, credentials are exposed.

**Fix applied:** Added `_connection_string_template: z.string().optional()` to `DatabaseConfigSchema` in `src/config/schema.ts`. Zod now preserves the field through validation, allowing `writeConfig()` to restore `${VAR}` references before writing.

---

### BUG-003: `register` tool always writes raw connection strings (unfixed — design consideration)

**Severity:** Medium (credential exposure)
**Status:** Open (by design, but worth considering)
**Component:** `tools/register.ts`

When `register` is called by an agent, the connection string is passed directly and stored in `config.databases` without any `_connection_string_template`. When `writeConfig()` is called, the raw connection string is written to the config file.

This is somewhat expected since `register` receives a literal connection string (not an env var reference). However, the PRD's `.env`-based workflow suggests credentials should never end up in the config file. Consider storing registered databases' connection strings in `.env` and writing `${VAR}` references to the config.

---

## Full Test Matrix

### Discovery Tools

| # | Test | Tool | Result |
|---|------|------|--------|
| 1 | list_databases shows sandbox | `list_databases` | PASS |
| 2 | list_schemas shows catalog | `list_schemas` | PASS |
| 3 | list_schemas shows inventory | `list_schemas` | PASS |
| 4 | list_schemas shows sales | `list_schemas` | PASS |
| 5 | list_schemas hides public (none) | `list_schemas` | PASS |
| 6 | list_schemas errors for nonexistent db | `list_schemas` | PASS |
| 7 | list_tables shows albums in catalog | `list_tables` | PASS |
| 8 | list_tables hides customers in sales (none) | `list_tables` | PASS |
| 9 | list_tables shows orders in sales | `list_tables` | PASS |
| 10 | describe_table on catalog.albums | `describe_table` | PASS |
| 11 | describe_table blocked on none-permission table | `describe_table` | PASS |

### Permission Enforcement

| # | Test | Tool | Result |
|---|------|------|--------|
| 12 | SELECT on read schema | `query` | PASS |
| 13 | SELECT on write schema | `query` | PASS |
| 14 | SELECT on none schema blocked | `query` | PASS |
| 15 | INSERT on read schema blocked | `execute` | PASS |
| 16 | DELETE on read schema blocked | `delete` | PASS |
| 17 | DELETE on write schema blocked | `delete` | PASS |
| 18 | dbml export | `dbml` | PASS |

### Permission Matrix (Post-Fix)

| Permission | SELECT | INSERT/UPDATE | DELETE | DDL (ALTER) | DDL (CREATE/DROP) |
|-----------|--------|---------------|--------|-------------|-------------------|
| `none` | Blocked | Blocked | Blocked | Blocked | Blocked |
| `read` | Allowed | Blocked | Blocked | Blocked | Blocked |
| `write` | Allowed | Allowed | Blocked | Blocked | Blocked |
| `delete` | Allowed | Allowed | Allowed | Blocked | Blocked |
| `yolo` | Allowed | Allowed | Allowed | Allowed | Allowed |

### Regression Tests (Post-Fix)

| # | Test | Result |
|---|------|--------|
| 1-8 | All discovery + permission tests | PASS |
| 9 | ALTER TABLE on read schema BLOCKED | PASS |
| 10 | ALTER TABLE on write schema BLOCKED | PASS |
| 11 | ALTER TABLE on delete schema BLOCKED | PASS |
| 12 | Config preserves ${SANDBOX_DATABASE_URL} after sync | PASS |
| 13 | Config still has env var reference after sync | PASS |

---

## Files Changed

| File | Change |
|------|--------|
| `src/permissions/classifier.ts` | AST fallback for table extraction in DDL |
| `src/permissions/checker.ts` | Safety check: deny when tables unresolvable for mutating ops |
| `src/config/schema.ts` | Added `_connection_string_template` to Zod schema |
