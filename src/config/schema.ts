import { z } from "zod";

export const PermissionLevelSchema = z.enum([
  "read",
  "write",
  "delete",
  "none",
  "yolo",
]);

export type PermissionLevel = z.infer<typeof PermissionLevelSchema>;

export const TableConfigSchema = z.object({
  name: z.string(),
  permission: PermissionLevelSchema.optional(),
});

export type TableConfig = z.infer<typeof TableConfigSchema>;

export const SchemaConfigSchema = z.object({
  name: z.string(),
  permission: PermissionLevelSchema.optional(),
  tables: z.array(TableConfigSchema).optional(),
});

export type SchemaConfig = z.infer<typeof SchemaConfigSchema>;

export const DatabaseConfigSchema = z.object({
  name: z.string(),
  connection_string: z.string(),
  permission: PermissionLevelSchema.optional(),
  schemas: z.array(SchemaConfigSchema).optional(),
});

export type DatabaseConfig = z.infer<typeof DatabaseConfigSchema>;

export const DataDanConfigSchema = z.object({
  name: z.string(),
  "default-permission": PermissionLevelSchema,
  "hot-reload": z.boolean(),
  databases: z.array(DatabaseConfigSchema),
});

export type DataDanConfig = z.infer<typeof DataDanConfigSchema>;
