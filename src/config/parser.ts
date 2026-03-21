import { readFileSync, writeFileSync } from "node:fs";
import yaml from "js-yaml";
import { DataDanConfigSchema, type DataDanConfig } from "./schema.js";

export function writeConfig(config: DataDanConfig, configPath: string): void {
  // Restore original ${ENV_VAR} templates before writing so we don't
  // leak resolved secrets into the config file on disk.
  const clone = structuredClone(config);
  for (const db of clone.databases) {
    const template = (db as Record<string, unknown>)._connection_string_template;
    if (typeof template === "string") {
      db.connection_string = template;
    }
    delete (db as Record<string, unknown>)._connection_string_template;
  }
  const yamlStr = yaml.dump(clone, { lineWidth: -1, quotingType: '"' });
  writeFileSync(configPath, yamlStr, "utf-8");
}

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
        const raw = (db as Record<string, string>).connection_string;
        // Preserve the original template so writeConfig can restore it
        if (/\$\{\w+\}/.test(raw)) {
          (db as Record<string, string>)._connection_string_template = raw;
        }
        (db as Record<string, string>).connection_string = interpolateEnvVars(raw);
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
