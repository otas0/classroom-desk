## Summary

-

## Checklist

- [ ] Tests / typecheck green locally (or CI)
- [ ] No mock/demo data in product UI defaults (见 `.cursor/rules/no-mock.mdc`)
- [ ] 若改动 `docs/SKU_CAPABILITIES.md`：已跑 `npm run generate:sku-html` 并提交同步后的 `docs/SKU_CAPABILITIES.html`  
      （CI 步骤 **SKU HTML generated from Markdown (no drift)** 会执行同一命令并以 `git diff --exit-code -- docs/SKU_CAPABILITIES.html` 失败，文案：`SKU HTML out of date — run npm run generate:sku-html`）
- [ ] 证据/`tmp/live-evidence` 分享前已跑 `npm run check:live-evidence`（可选 `--fail-on-rfc1918-leak`）

## Test plan

- [ ]
