# Brand Family

家长管控：小孩设备、网页浏览、App 使用。独立部署，不与 Classroom Desk / Work Desk 共用逻辑。

品牌名待定；定名后产品与目录可改为「{品牌} Family」。

> **源码位置：** 本目录属于 monorepo [`otas0/classroom-desk`](https://github.com/otas0/classroom-desk) 的 `products/brand-family`。  
> 旧独立仓 [`otas0/brand-family`](https://github.com/otas0/brand-family) 请加归档说明并指向本路径。默认**不**打进 Classroom Desk Release 附件。

## 做什么

- **孩子档案**：家长账号下管理多个孩子
- **设备**：把手机 / 平板 / 电脑登记到某个孩子
- **网页策略**：按域名允许或拦截浏览
- **App 策略**：按应用标识允许或拦截使用

## 不做什么

隐蔽监控、键鼠记录、未告知的远程窥屏。本产品面向家长显式配置的管控策略。

## 本地启动

```bash
cd products/brand-family
cp .env.example .env
# 可选：BOOTSTRAP_PARENT_USERNAME / BOOTSTRAP_PARENT_PASSWORD 创建首位家长
npm install
npm run build -w @brand-family/shared
npm run dev          # API :8788
npm run dev:parent   # 家长端 :5175
```

未配置 bootstrap 时，打开家长端会引导创建首位家长（库内无家长时）。

## 仓库结构

```text
apps/server        API + SQLite
apps/parent-web    家长管控台
packages/shared    共享类型与常量
```
