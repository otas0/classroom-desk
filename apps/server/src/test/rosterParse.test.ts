import {
  detectNameAndNo,
  parseCsvToRows,
  parseSheetMatrixToRows,
} from '../services/rosterParse.js';

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

// comma / full-width / tab / space
assert(parseCsvToRows('姓名,学号\n张三,2026001').length === 1, 'csv header');
assert(parseCsvToRows('张三，2026001')[0]?.studentNo === '2026001', 'fullwidth comma');
assert(parseCsvToRows('李四\t2026002')[0]?.name === '李四', 'tab');
assert(parseCsvToRows('王五 2026003')[0]?.studentNo === '2026003', 'space');
assert(parseCsvToRows('2026004 赵六')[0]?.name === '赵六', 'no-first space');
assert(parseCsvToRows('钱七2026005')[0]?.studentNo === '2026005', 'glued');

const matrixHeader = [
  ['序号', '姓名', '学号', '备注'],
  [1, '周八', 2026006, ''],
  [2, '吴九', '2026007', ''],
];
const fromHeader = parseSheetMatrixToRows(matrixHeader);
assert(fromHeader.length === 2, 'sheet header rows');
assert(fromHeader[0]?.name === '周八' && fromHeader[0]?.studentNo === '2026006', 'excel number');

const matrixNoHeader = [
  ['2026010', '郑十'],
  ['冯十一', '2026011'],
];
const noHeader = parseSheetMatrixToRows(matrixNoHeader);
assert(noHeader.some((r) => r.name === '郑十'), 'no-header detect');

assert(detectNameAndNo(['学号', '姓名']) == null, 'header pair skipped by caller');
assert(detectNameAndNo(['甲同学'])?.name === '甲同学', 'name only');

// Multilingual email/phone header variants (template + locale aliases)
const emailHeaders = [
  '姓名,学号,邮箱,手机\n甲,1001,a@school.edu,13800000001',
  '姓名,学号,电子邮箱,联系电话\n乙,1002,b@school.edu,13800000002',
  'name,student_no,email,phone\nProp,1003,c@school.edu,13800000003',
  'Name,Student ID,E-mail,Mobile\nDing,1004,d@school.edu,13800000004',
  '姓名,学号,メール,電話\n戊,1005,e@school.edu,13800000005',
  '이름,학번,이메일,휴대폰\n己,1006,f@school.edu,13800000006',
];
for (const csv of emailHeaders) {
  const rows = parseCsvToRows(csv);
  assert(rows.length === 1, `email header parse: ${csv.split('\n')[0]}`);
  assert(rows[0]?.contactEmail?.includes('@'), `email bound: ${csv.split('\n')[0]}`);
}

const templateOnly = parseCsvToRows('姓名,学号,邮箱,手机\n');
assert(templateOnly.length === 0, 'header-only template yields no students');

console.log('rosterParse ok');
