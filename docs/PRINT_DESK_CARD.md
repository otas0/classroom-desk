# 讲台一页纸 · 单教室（1 教师机 + 多学生机 · 无签名）

塑封后放讲台。完整勾选见 [LOCAL_USB_CHECKLIST.md](./LOCAL_USB_CHECKLIST.md)。

## 拓扑

只在本教室：教师机跑服务（8787）；学生机只装客户端，全部指向该教师机 IP。不跨教室、不接公网、不做代码签名。

## 上课前（必做）

1. 教师机已开机，API 自启（或 `npm run start:server`），`HOST=0.0.0.0`。  
2. 固定教师机 IP；防火墙已跑过 `windows-teacher-host.ps1`。  
3. **任选一台学生浏览器**打开 `http://教师IP:8787/health`（不通先关 AP/访客隔离）。  
4. 学生机时间与教师机一致（自动对时；迟到按本地时刻）。  
5. 教师机 `npm run backup:db` 后 `/health` 无 `lastError`。  
6. `/admin`：选班 → 花名册已导入 → 按需关留言 → 设置迟到阈值（上课开始时刻 + 分钟）。

## 学生机

- `apiBase = http://教师IP:8787`（禁止 127.0.0.1）  
- `classId` = 本班（「指派学生机」或 `pack-classroom-config`）  
- 客户端启动会强制 `/health`；未签名包：SmartScreen → 更多信息 → 仍要运行  

## 课堂操作

| 角色 | 操作 |
|---|---|
| 学生 | 花名册点自己的名 → 签到 / 自定义分值理由请求加分 / 答题；（留言关则无留言 Tab） |
| 教师 | 加分审核；发题看正确率；签到月统计（本地自然月）；导出 CSV/Excel/JSON/TSV |

## 导出与备份

- 导出：教师后台「导出」四种格式各下一份核对。  
- 备份：教师机 `npm run backup:db` → `apps/server/data/backups`。  

## 本教室包

`node scripts/pack-classroom-config.mjs --apiBase http://教师IP:8787 --classId <id>` 后装样机，镜像刷其余机。
