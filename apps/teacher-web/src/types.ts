export type ClassItem = { id: string; name: string; classCode: string };

export const POINT_REASON_CHIPS = ['表扬', '作业', '课堂表现', '答题', '互助'] as const;

export const IMPORT_ERROR_ZH: Record<string, string> = {
  file_required: '未收到上传文件，请重新选择 Excel/CSV 后再试',
  unsupported_file_type: '仅支持 .xlsx / .xls / .csv，请检查文件后缀',
  parse_failed: '文件解析失败：可能不是有效表格、文件损坏或列名无法识别',
  corrupt_file: 'Excel 文件损坏或不是有效的 .xlsx/.xls，请用 WPS/Excel 另存后再导入',
  empty_sheet: '表格无有效数据行，请确认有「姓名」列且至少一行学生',
  empty_csv: 'CSV 为空',
  import_all_failed: '全班导入失败，请按行核对提示',
  class_not_found: '班级不存在',
  import_failed: '导入失败',
};

export function preferClassroomId(items: ClassItem[], current: string): string {
  if (current && items.some((c) => c.id === current)) return current;
  const preferred =
    items.find((c) => c.name === '本教室') ??
    items.find((c) => c.name.includes('本教室')) ??
    items[0];
  return preferred?.id ?? '';
}

export function monthString(d = new Date()): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y!, (m! - 1) + delta, 1);
  return monthString(d);
}
