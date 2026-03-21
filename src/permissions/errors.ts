import type { PermissionLevel } from "../config/schema.js";

export interface McpError {
  isError: true;
  content: Array<{ type: "text"; text: string }>;
}

/**
 * Builds a structured MCP error for permission denial.
 */
export function buildPermissionError(
  tool: string,
  target: string,
  requiredLevel: PermissionLevel,
  currentLevel: PermissionLevel,
): McpError {
  const action = tool;
  return {
    isError: true,
    content: [
      {
        type: "text",
        text: `Permission denied: table '${target}' has permission '${currentLevel}', but ${action} requires '${requiredLevel}'. Update datadan.config.yaml to grant '${requiredLevel}' permission if needed.`,
      },
    ],
  };
}
