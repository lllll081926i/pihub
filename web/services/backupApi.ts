/**
 * Backup API Service
 *
 * Handles database backup export/import for the settings page.
 */

import { invoke } from '@tauri-apps/api/core';

export interface BackupManifest {
  format: string;
  version: number;
  schema_version: number;
  app_version: string;
  created_at: string;
  database_file: string;
}

/**
 * Export the SQLite database plus manifest to a user-chosen directory.
 * Returns the written manifest as JSON.
 */
export const exportDatabaseBackup = async (targetDir: string): Promise<BackupManifest> => {
  const json = await invoke<string>('export_database_backup', { targetDir });
  return JSON.parse(json) as BackupManifest;
};

/**
 * Validate a backup file and stage it for swap on next restart.
 * Returns the validated manifest.
 */
export const importDatabaseBackup = async (sourceDb: string): Promise<BackupManifest> => {
  const json = await invoke<string>('import_database_backup', { sourceDb });
  return JSON.parse(json) as BackupManifest;
};
