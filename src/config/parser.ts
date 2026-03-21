import { readFileSync } from "node:fs";
import yaml from "js-yaml";
import { DataDanConfigSchema, type DataDanConfig } from "./schema.js";

function interpolateEnvVars(connectionString: string): string {
  return connectionString.replace(/\$\{(\w+)\}/g, (match, varName: string) => {
    const value = process.env[varName];
    if (value === undefined) {
      throw new Error(
        `Environment variable '${varName}' is not set (referenced in connection_string: "${connectionString}")`
      );
    }
    return value;
  });
}

export function loadConfig(configPath: string): DataDanConfig {
  let fileContents: string;
  try {
    fileContents = readFileSync(configPath, "utf-8");
  } catch (err) {
    throw new Error(
      `Failed to read config file at '${configPath}': ${err instanceof Error ? err.message : String(err)}`
    );
  }

  let rawConfig: unknown;
  try {
    rawConfig = yaml.load(fileContents);
  } catch (err) {
    throw new Error(
      `Failed to parse YAML in '${configPath}': ${err instanceof Error ? err.message : String(err)}`
    );
  }

  // Interpolate env vars in connection_string fields
  if (
    rawConfig &&
    typeof rawConfig === "object" &&
    "databases" in rawConfig &&
    Array.isArray((rawConfig as Record<string, unknown>).databases)
  ) {
    for (const db of (rawConfig as Record<string, unknown[]>).databases) {
      if (
        db &&
        typeof db === "object" &&
        "connection_string" in db &&
        typeof (db as Record<string, unknown>).connection_string === "string"
      ) {
        (db as Record<string, string>).connection_string = interpolateEnvVars(
          (db as Record<string, string>).connection_string
        );
      }
    }
  }

  const result = DataDanConfigSchema.safeParse(rawConfig);
  if (!result.success) {
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");
    throw new Error(
      `Config validation failed for '${configPath}':\n${issues}`
    );
  }

  return result.data;
}
