# Offline security custody（监管锁 / 最高保密级）

## Official hardening ladder（不要倒序）

机房要「最高安全级」时，按这一条走；**不要**先做配套浏览器。

| 阶 | 做什么 | 谁 | 状态 |
|----|--------|-----|------|
| 1 | **Assigned Access 单应用** 指向学生端（`Classroom Desk.exe`）+ 建议 Intune HideTaskManager | 学校 IT | 必配 L3，见 [EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md) |
| 2 | **DeskDNS / 防火墙 deny** | IT + 教师 | **产品内**上课页「部署 DeskDNS」（非独立 SKU）；旁路机轮询 `/api/v1/desk-dns/policy` 互通。机房防火墙按校网配 |
| 3 | **拉黑名单（按班/按人）+ 一键武装最高保密级** | 教师 | 已交付（设备控制栏） |
| 4 | **考试壳 allowlist**（深锁 exam URL / 主机白名单） | 教师，仅考场需要时 | 已有深锁 exam shell；按场次启用，非日常默认 |

单独做浏览器 ≠ 更高安全级；没有阶 1，壳仍可被 Alt+Tab / 任务管理器绕过。

### 旁路互通（公开策略，无 JWT）

| 端点 | 用途 |
|------|------|
| `GET /api/v1/desk-dns/policy` | DeskDNS / Exam Box DNS 意图 |
| `GET /api/v1/gateway/policy` | openNDS IP 白名单 + 深锁 netMode |
| `GET /api/v1/shield/policy` | Shield 适配器意图（含 allowlist） |
| `GET /api/v1/network-zones/export` | SSID/CIDR→VLAN 防火墙映射 |
| Federation peers | 仅 `netMode` / `examActive` 状态，**不**跨班远程锁 |

## Hard truth

**App-layer alone cannot reach true OS lockdown.**  
Without school **Assigned Access + Intune** (L3), students can still Alt+Tab or end the process in Task Manager. That is an **incomplete lab deployment**, not a missing software toggle. See [SECURITY.md](./SECURITY.md).

| Layer | What Classroom Desk does | Who closes the gap |
|-------|--------------------------|--------------------|
| App | Kiosk cover, network seal (only teacher API), kill browsers/chat/games, persist lock across relaunch (+ Windows ProgramData flag), unlock code; display hotplug re-cover | Product |
| Peer-drop | **Day-to-day default:** lock only the disconnected student. **最高保密级 arm:** also `kick_class` + freeze whole class (`freezeClassOnPeerDrop`) | Teacher toggle |
| OS | Block Alt+Tab / Win / Task Manager / USB | School IT — Assigned Access + Intune XML |

## One-click arm — 最高保密级 (teacher)

Official sequence ([EXIT_LOCK_MDM.md](./EXIT_LOCK_MDM.md)):

1. IT configures Assigned Access (+ Intune as needed)
2. IT sets hardening signal: env `CD_ASSIGNED_ACCESS=1` **or** file `C:\ProgramData\ClassroomDesk\assigned-access.ready`
3. Students online report `hardened: true` via presence
4. Teacher checks「本校 IT 已配置 Assigned Access / Intune」on the session red banner
5. Banner shows **online ≥ 1** and **unhardened = 0**
6. **一键武装最高保密级** unlocks

Until steps 4–5 pass (including at least one online hardened client), the arm button stays **disabled**. Empty class + declare alone cannot arm.

When armed (default scope = **本班**; switch to **个别学生** to arm only selected roster rows):

1. Offline policy → max-secrecy preset (~1s grace, hold until unlock, kill escapes, **`freezeClassOnPeerDrop: true`** for class arm)
2. Deep-lock patch (class arm only) → frozen + net deny + kill browsers/distractions + focus freeze
3. Teacher may later switch「有学生掉线时」back to「只锁该学生」without disarming other custody flags

### Scope (teacher device-control bar)

One **配置范围** applies to both **拉黑名单** (`policyStore`) and **掉线监管** (`offlineStore`):

| Scope | Effect |
|-------|--------|
| 全校默认 | `*.global` — used when no class/student override |
| 本班覆盖 | `byClass[classId]` — this class only |
| 个别学生 | `byStudent[studentId]` — highest priority |

Resolve order on the student client: **student > class > global**. Open/close commands can target the whole class or only checked students (`studentIds`). DeskDNS blocks the **union** of all blocked hosts in the store (DNS cannot attribute queriers per student).

## Student behavior when bonded + offline

1. Health fails ~1s (poll ~600ms) → enter custody  
2. `setKiosk(true)` + secondary blackouts + focus steal; display hotplug re-covers  
3. Chromium blocks all http(s) except teacher API / localhost  
4. Continuously taskkill browsers / chat / games (+ teacher blockedApps)  
5. Persist `userData/offline-custody.json` and (Windows) `ProgramData\ClassroomDesk\offline-custody.flag` — relaunch still locked  
6. Leave only with teacher **解除码**

## Forbidden (still)

Keyloggers, anti-kill drivers, hidden processes, Defender bypass — not “最高保密级”, that’s spyware. We will not ship them.
