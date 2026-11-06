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

console.log('rosterParse ok');
