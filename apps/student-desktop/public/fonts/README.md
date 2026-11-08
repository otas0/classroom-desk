# CJK fonts (student desktop)

```bash
npm run fonts:cjk
```

Loads via `/fonts/*.ttf` (Vite `public/`). Offline Electron packs these files; CSP stays `style-src 'self'`.
System fallbacks: Yu Gothic UI / Malgun Gothic when JP/KR files are missing.
