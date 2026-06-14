# reports/ — 长期处置台账

> 跨次运行的长期台账（与单次证据 `artifacts/` 区分：artifacts 是一次性运行产物且 gitignore；reports 是需长期保留、跨运行累积的处置记录）。被静态扫描闭环引用（见 `../AGENTS.md` 静态扫描节）。

## 子目录

| 目录 | 内容 |
|---|---|
| `static-scan/` | 静态扫描基线与处置台账（`baseline.json` / `dispositions.json`，详见 `static-scan/README.md`） |
