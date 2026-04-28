# 测试规范

确保测试覆盖核心逻辑，不写脆弱测试，不追求 100% 覆盖。

## 5.1 必须写测试的场景

- 所有业务规则和领域逻辑
- 所有公有 API 的 happy path + 主要错误路径
- 边界条件（空输入、极值、零值）
- Ecto changeset 校验

## 5.2 可以不写测试的场景

- 纯 getter/setter / 简单委托
- 一次性迁移脚本
- 临时调试用代码（不提交）

## 5.3 测试结构

### Elixir

```
test/novel_app/
├── support/          # 测试辅助模块
├── <domain>/         # 与 lib/ 下结构对应
│   ├── module_test.exs
│   └── module_test.exs
└── test_helper.exs
```

### TypeScript

```
frontend/src/__tests__/
├── components/
├── lib/
└── ...
```

## 5.4 测试模式

### Arrange-Act-Assert (AAA)

```elixir
test "update_turn returns error when turn not found" do
  # Arrange
  turn_id = Ecto.UUID.generate()

  # Act
  result = TurnService.update_turn(turn_id, %{title: "new"})

  # Assert
  assert {:error, :not_found} = result
end
```

### 避免的特点

| 反模式 | 说明 | 替代 |
|--------|------|------|
| DRY 过度 | 为了去重把测试逻辑写得比被测代码还复杂 | 重复是允许的 |
| 依赖实现细节 | 测试关注内部状态而非外部行为 | 只测公有接口 |
| 超规格模拟 | 精确标记每个函数调用参数 | 使用松散匹配 |
| 过度 setup | 大量 setup 块导致看不清理清了什么 | 每个测试独立 setup |

## 5.5 集成测试

- Ecto 相关测试使用 `data_case` 操作真实数据库
- Channel 测试使用 `channel_case`
- 外部 API 调用使用 Mock（仅在 test 环境）

## 5.6 运行检查

- `mix test` 必须全部通过
- CI 需要跑 `mix test --warnings-as-errors`
