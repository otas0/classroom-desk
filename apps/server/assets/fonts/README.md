# CJK fonts for parent-report PDF

Bundled open-source font (SIL OFL): **Noto Sans SC** subset / variable TTF.

- Preferred file: `NotoSansSC-VF.ttf` (or `NotoSansSC-Regular.otf`)
- Fetched by `node scripts/fetch-cjk-font.mjs` when missing
- Override path: env `CLASSROOM_DESK_CJK_FONT`
- Skip network fetch: `CLASSROOM_DESK_SKIP_CJK_FONT_FETCH=1`

`pdf-lib` subsets glyphs used in each report so output stays small.
