# 书库说明

`books/_template/` 是新书母版。

新建一本书：

```bash
./scripts/new_book.sh BookSlug "书名"
```

新书创建后：

- `approved/current/` 是正式真相层。
- `candidate/` 是工作区。
- 每本书目录下的 `AGENTS.md` 会在你进入该书目录工作时补充书级规则。
