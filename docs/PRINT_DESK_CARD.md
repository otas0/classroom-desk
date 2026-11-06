# 讲台一页纸 · 单教室（1 教师机 + 多学生机）

## 拓扑

只在本教室：教师机跑服务（8787）；学生机只装客户端，全部指向该教师机 IP。不跨教室、不接公网。

## 上课前

1. 教师机已开机，API 自启（或手动 `npm run start:server`），`HOST=0.0.0.0`。  
2. 固定教师机 IP；防火墙已跑过 `windows-teacher-host.ps1`。  
3. **任选一台学生浏览器**打开 `http://教师IP:8787/health`（不通先关 AP/访客隔离）。  
4. 学生机时间与教师机一致（自动对时）。  
5. `/admin`：选班 → 花名册已导入 → 需要时开留言。

## 学生机

- `apiBase = http://教师IP:8787`（禁止 127.0.0.1）  
- `classId` = 本班（「指派学生机」下载 config 或设置页填写）  
- 未签名包：SmartScreen → 更多信息 → 仍要运行  

## 课堂操作

| 角色 | 操作 |
|---|---|
| 学生 | 花名册点自己的名 → 签到 / 自定义分值理由请求加分 / 答题 / 留言 |
| 教师 | 加分审核；发题并看正确率/错误率；签到月统计；导出 CSV/Excel/JSON/TSV |

## 导出与备份

- 导出：教师后台「导出」选格式（csv / xlsx / json / tsv），含签到明细、月出勤汇总、加分、题目。  
- 备份：教师机 `npm run backup:db` → `apps/server/data/backups`（本教室不接 NAS）。  

## 安装包

本教室专用：`node scripts/pack-classroom-config.mjs --apiBase http://教师IP:8787 --classId <id>` 后 `dist:win`。  
样机装好后镜像刷其余学生机。有证书后再换签名包，拓扑不变。
