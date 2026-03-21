import { describe, it, expect } from "vitest";
import type { ColumnInfo } from "../db/introspect.js";

// Test the columnSettings logic (private function, replicated here)
function columnSettings(col: ColumnInfo): string {
  const settings: string[] = [];
  if (col.isPrimaryKey) settings.push("pk");
  if (!col.nullable) settings.push("not null");
  if (col.isUnique && !col.isPrimaryKey) settings.push("unique");
  if (col.defaultValue !== null) settings.push(`default: '${col.defaultValue}'`);
  return settings.length > 0 ? ` [${settings.join(", ")}]` : "";
}

function makeCol(overrides: Partial<ColumnInfo> = {}): ColumnInfo {
  return {
    name: "col",
    dataType: "text",
    nullable: true,
    defaultValue: null,
    isPrimaryKey: false,
    isForeignKey: false,
    isUnique: false,
    foreignKeyRef: null,
    ...overrides,
  };
}

describe("columnSettings", () => {
  it("returns empty string for nullable column with no constraints", () => {
    expect(columnSettings(makeCol())).toBe("");
  });

  it("includes pk for primary key", () => {
    expect(columnSettings(makeCol({ isPrimaryKey: true, nullable: false }))).toContain("pk");
  });

  it("includes not null for non-nullable column", () => {
    expect(columnSettings(makeCol({ nullable: false }))).toContain("not null");
  });

  it("includes unique (but not for PKs)", () => {
    expect(columnSettings(makeCol({ isUnique: true }))).toContain("unique");
    // PK columns should NOT show unique separately
    expect(columnSettings(makeCol({ isPrimaryKey: true, isUnique: true, nullable: false }))).not.toContain("unique");
  });

  it("includes default value", () => {
    expect(columnSettings(makeCol({ defaultValue: "now()" }))).toContain("default: 'now()'");
  });

  it("combines multiple settings", () => {
    const result = columnSettings(makeCol({
      isPrimaryKey: true,
      nullable: false,
      defaultValue: "nextval('seq')",
    }));
    expect(result).toContain("pk");
    expect(result).toContain("not null");
    expect(result).toContain("default:");
  });
});
