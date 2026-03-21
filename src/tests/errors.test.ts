import { describe, it, expect } from "vitest";
import { buildPermissionError } from "../permissions/errors.js";

describe("buildPermissionError", () => {
  it("returns structured MCP error", () => {
    const error = buildPermissionError("select", "public.users", "read", "none");
    expect(error.isError).toBe(true);
    expect(error.content).toHaveLength(1);
    expect(error.content[0].type).toBe("text");
  });

  it("includes target table in message", () => {
    const error = buildPermissionError("select", "public.users", "read", "none");
    expect(error.content[0].text).toContain("public.users");
  });

  it("includes current and required permission levels", () => {
    const error = buildPermissionError("delete", "myschema.orders", "delete", "write");
    expect(error.content[0].text).toContain("'write'");
    expect(error.content[0].text).toContain("'delete'");
  });

  it("includes guidance to update config", () => {
    const error = buildPermissionError("select", "public.users", "read", "none");
    expect(error.content[0].text).toContain("datadan.config.yaml");
  });

  it("includes the tool name as action", () => {
    const error = buildPermissionError("insert", "public.users", "write", "read");
    expect(error.content[0].text).toContain("insert");
  });
});
