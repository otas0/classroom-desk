# Intune 试验组 · 22H2 / 24H2 填写与回滚

模板文件：[`C2_intune-version.example.txt`](./C2_intune-version.example.txt)  
策略样例：[`intune-student-kiosk.example.xml`](./intune-student-kiosk.example.xml)  
回滚：[`intune-student-kiosk.rollback.xml`](./intune-student-kiosk.rollback.xml)

本地证据目录（`npm run init:c2-evidence`）会拷入可编辑的 `C2-intune-version.txt`。

## 部署顺序

1. Intune 自定义配置上传 example XML → **仅试验组**（1～3 台）。
2. 设备「同步」；各台记下「设置 → 系统 → 关于」内部版本。
3. 至少 **一台 22H2、一台 24H2**（没有两台则注明缺版本，不可标全绿）。
4. 逐项填表：`HideTaskManager`、`RemovableDiskDenyWrite`、`RemovableDiskDenyExecute` → 填 **是** 或 **否**（不要留「是 / 否」字面）。
5. 截图策略分配页 → `C2-intune-policy.png`。
6. 试验结束：取消分配或下发 rollback → 再填「回滚验证」段。

## 填完后自检（开发机）

```bash
npm run init:c2-evidence          # 若尚无目录
# 样机填完 txt + 放入 mp4/png 后：
npm run verify:c2-evidence
```

`verify:c2-evidence` 在 `C2-intune-version.txt` 仍含模板空白（`是 / 否`、`例如 22621`）且未见 `HideTaskManager 生效: 是` 时会失败。

## 本仓库无法代填

无学校 Intune 租户时，本项保持 **真机待验**；代码侧只提供 XML、回滚与校验脚本。
