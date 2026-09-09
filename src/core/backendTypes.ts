/**
 * TypeScript mirrors of Rust types returned by Tauri commands
 * (`src-tauri/src/db/models.rs`). Kept in one place so a backend shape
 * change is a one-file update on the frontend.
 */

export type PermissionScope = "denied" | "ask" | "allow";

export interface AuditEntry {
  id: string;
  category: string;
  action: string;
  detail: string;
  result: "ok" | "denied" | "error";
  created_at: string;
}

export interface SystemInfo {
  os_name: string;
  os_version: string;
  hostname: string;
  cpu_usage_percent: number;
  cpu_count: number;
  total_memory_mb: number;
  used_memory_mb: number;
  disks: Array<{ name: string; mount_point: string; total_gb: number; available_gb: number }>;
}
