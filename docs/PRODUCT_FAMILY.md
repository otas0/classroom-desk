# Product family（同一 GitHub 库）

**唯一产品源码仓：** [`otas0/classroom-desk`](https://github.com/otas0/classroom-desk)

| 产品 | 路径 | 默认端口 | 说明 |
|---|---|---|---|
| **Classroom Desk** | 仓库根 `apps/` · `packages/` · `deploy/` | `:8787` | 课堂答题 / 机房深锁 / 校园网门户 · **主发版对象** |
| **Work Desk** | [`products/work-desk/`](../products/work-desk/) | `:8787`（独立进程） | 工厂/办公打卡与工时 · **独立 npm 根**，不进根 workspace |
| **Brand Family** | [`products/brand-family/`](../products/brand-family/) | `:8788` | 家长管控（品牌名待定）· **独立 npm 根** |

各产品 **独立部署、独立 `.env`、不共用数据库**。同仓只为统一版本叙事、发版清单与备份；不要在根目录 `npm install` 时误装 sibling 产品。

## 启动 sibling

```bash
# Work Desk
cd products/work-desk && cp .env.example .env && npm install && npm run dev

# Brand Family
cd products/brand-family && cp .env.example .env && npm install && npm run build -w @brand-family/shared && npm run dev
```

## 旧仓库

| 旧位置 | 状态 |
|---|---|
| 本地 `~/Projects/work-desk`（无 remote） | 源码已迁入 `products/work-desk` |
| [`otas0/brand-family`](https://github.com/otas0/brand-family)（private） | 源码已迁入 `products/brand-family`；请在旧仓 README 加迁移说明后归档 |

## 发版边界

下一版 **全面 bundle** 指 Classroom Desk 交付物全集（见 [`RELEASE_BUNDLE.md`](./RELEASE_BUNDLE.md)）。  
Work Desk / Brand Family 仍为 **源码同仓**；未声明前不强制打进同一 GitHub Release 附件（避免和机房 zip 混装）。
