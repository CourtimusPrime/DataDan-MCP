import pg from "pg";
import type { DataDanConfig } from "../config/schema.js";

const { Pool } = pg;

export interface ConnectionStatus {
  successes: string[];
  failures: { database: string; error: string }[];
}

export class ConnectionManager {
  private pools: Map<string, pg.Pool> = new Map();

  constructor(config: DataDanConfig) {
    for (const db of config.databases) {
      const pool = new Pool({
        connectionString: db.connection_string,
      });
      this.pools.set(db.name, pool);
    }
  }

  getPool(databaseName: string): pg.Pool {
    const pool = this.pools.get(databaseName);
    if (!pool) {
      throw new Error(`Database '${databaseName}' not found. Available databases: ${[...this.pools.keys()].join(", ")}`);
    }
    return pool;
  }

  async connect(): Promise<ConnectionStatus> {
    const status: ConnectionStatus = { successes: [], failures: [] };

    const results = await Promise.allSettled(
      [...this.pools.entries()].map(async ([name, pool]) => {
        const client = await pool.connect();
        try {
          await client.query("SELECT 1");
        } finally {
          client.release();
        }
        return name;
      }),
    );

    for (const result of results) {
      if (result.status === "fulfilled") {
        status.successes.push(result.value);
      } else {
        const error = result.reason as Error;
        // Extract the database name from the error context
        const idx = results.indexOf(result);
        const name = [...this.pools.keys()][idx];
        status.failures.push({ database: name, error: error.message });
      }
    }

    return status;
  }

  async disconnect(): Promise<void> {
    const endPromises = [...this.pools.values()].map((pool) => pool.end());
    await Promise.allSettled(endPromises);
    this.pools.clear();
  }

  addPool(databaseName: string, connectionString: string): void {
    const pool = new Pool({ connectionString });
    this.pools.set(databaseName, pool);
  }

  getDatabaseNames(): string[] {
    return [...this.pools.keys()];
  }
}
