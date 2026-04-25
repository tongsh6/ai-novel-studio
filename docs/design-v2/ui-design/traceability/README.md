# UI Traceability

> 状态：占位
>
> 角色：记录 UI 文档、Pencil screen、ADR / Foundation / Domain 来源之间的追溯关系。

---

## 1. 文件

- `screen-to-doc-map.md`：每个原型 screen 对应的 UI 文档章节与 contract 来源。

---

## 2. 追溯粒度

每个 screen 至少记录：

1. screen frame name
2. 对应 UI 文档章节
3. 关键 ADR 来源
4. 涉及的 `card_type` / `next_action` / state family
5. 是否存在 deferred 或 blocked placeholder
