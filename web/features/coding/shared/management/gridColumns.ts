export const MANAGEMENT_GRID_COLUMN_OPTIONS = ['auto', 1, 2, 3, 4, 5] as const;

export type ManagementGridColumnSetting = typeof MANAGEMENT_GRID_COLUMN_OPTIONS[number];

export function parseManagementGridColumnSetting(value: string): ManagementGridColumnSetting {
  if (value === 'auto') {
    return 'auto';
  }
  const parsed = Number(value);
  if (Number.isInteger(parsed) && parsed >= 1 && parsed <= 5) {
    return parsed as ManagementGridColumnSetting;
  }
  return 'auto';
}
