# Schema Codegen：JSON Schema → Ecto + Zod

> 状态：草案
>
> 目的：定义如何从 [`../adr/`](../adr/) ADR-0001 等 JSON Schema（位于 `docs/design/schemas/`）双端 codegen 出 Ecto schema（后端）和 Zod schema（前端），保证 single source of truth。

---

## 1. 总览

```yaml
ssot_path:       docs/design/schemas/*.json
backend_target:  apps/novel_persistence/lib/persistence/schemas/         (Ecto, 持久化)
llm_io_target:   apps/novel_provider/lib/provider/llm_schemas/           (Ecto embedded_schema, instructor_lite 结构化输出)
frontend_target: frontend/src/generated/schemas/                         (Zod + TS)
codegen_tool:    自定义 mix task + npm script
schema_validator: ex_json_schema (Elixir) + ajv (Node)
contract_test:   独立 mix test target，CI 必跑
```

> 2026-04-26 实测后追加：除原有 Ecto persistence schema 外，所有进入 LLM 的结构化输出（intent slot / artifact / card payload / quality finding 等）也必须从 SSOT 派生为 `Ecto.Schema` 的 `embedded_schema`，给 `instructor_lite` 用。详见 §4.4。

---

## 2. 为什么必须 codegen

`docs/design/schemas/` 是当前 JSON Schema / enum SSOT；TurnResult 顶层 schema、artifact adoption entry 和枚举文件都从这里派生。

如果允许手写 Ecto schema + Zod schema，**漂移在所难免**：

- 后端工程师改了字段，前端不知道
- 前端加了 validation，后端没有
- ADR 文档与代码脱节

**唯一可靠的纪律**：JSON Schema 是 SSOT，代码全部 codegen。

---

## 3. SSOT 目录结构

```
docs/design/schemas/
├── README.md                          # 总览
├── _common/                           # 共享 fragment
│   ├── workspace_id.json
│   ├── revision_id.json
│   └── source_revision_refs.json
├── turn_result.json                   # ADR-0015 / VS-05
├── card.json                          # VS-05 UI card type subset
├── adoption_state.json                # VS-04 adoption boundary
├── state_enums.json                   # ADR-0006 / ADR-0007 current state/action enums
├── authority_scope.json               # execution authority contract
├── budget.json                        # execution authority contract
├── escalation.json                    # execution authority contract
├── volume.json                        # domain object model
├── arc.json                           # domain object model
├── behavior_state.json                # ADR-0008 / VS-03 behavior lifecycle
├── ui_action.json                     # ADR-0007 / VS-05 AvailableAction
├── maintenance_artifact.json          # domain maintenance hooks
├── intent.json                        # domain intent catalog
├── reading_projection_root.json       # ADR-0016 projection hints
├── reading_projection_toc.json
├── reading_projection_chapter.json
├── reader_recap.json
├── slot_schema.json                   # ADR-0010
├── quality_finding.json               # ADR-0012
├── approval_policy.json               # ADR-0013
├── approval_record.json               # ADR-0013
├── experience_evidence.json           # ADR-0014
├── experience_artifact.json           # ADR-0014
├── experience_rule.json               # ADR-0014
└── structure_panel.json               # ADR-0015
```

每个 JSON Schema 文件遵守：

- `$id` 指向稳定 URI（`https://design.local/schemas/turn_result.json`）
- `$schema: "http://json-schema.org/draft-07/schema#"`
- `$ref` 引用相对其他 schema
- Domain 扩展用 `domain_ext.` 前缀（ADR-0001 §1）

示例（`turn_result.json` 简化版）：

```json
{
  "$schema": "http://json-schema.org/draft-07/schema#",
  "$id": "https://design.local/schemas/turn_result.json",
  "title": "TurnResult",
  "type": "object",
  "required": [
    "turn_id", "workspace_id", "author_id", "intent_ref",
    "phase", "status", "next_action", "behavior_state",
    "adoption_state", "ui_cards", "memory_writes",
    "schema_version", "created_at", "updated_at"
  ],
  "properties": {
    "turn_id": { "type": "string", "format": "uuid" },
    "workspace_id": { "$ref": "_common/workspace_id.json" },
    "phase": { "$ref": "state_enums.json#/definitions/turn_phase" },
    "ui_cards": {
      "type": "array",
      "items": { "$ref": "card.json" }
    },
    "domain_ext": {
      "type": "object",
      "additionalProperties": true
    }
  }
}
```

---

## 4. 后端 codegen：JSON Schema → Ecto schema

### 4.1 自定义 mix task

```elixir
# apps/novel_persistence/lib/mix/tasks/codegen.schemas.ex
defmodule Mix.Tasks.Codegen.Schemas do
  use Mix.Task
  
  @shortdoc "Generate Ecto schemas from JSON Schema SSOT"
  
  def run(_args) do
    Application.ensure_all_started(:ex_json_schema)
    
    schemas_dir = "docs/design/schemas"
    target_dir = "apps/novel_persistence/lib/persistence/schemas"
    
    schemas_dir
    |> Path.expand()
    |> File.ls!()
    |> Enum.filter(&String.ends_with?(&1, ".json"))
    |> Enum.reject(&String.starts_with?(&1, "_"))
    |> Enum.each(fn file ->
      path = Path.join(schemas_dir, file)
      json = File.read!(path) |> Jason.decode!()
      
      module_name = file_to_module(file)
      ecto_code = generate_ecto_schema(json, module_name)
      
      output = Path.join(target_dir, "#{module_basename(file)}.ex")
      File.write!(output, ecto_code)
      
      Mix.shell().info("✓ Generated #{output}")
    end)
  end
  
  defp generate_ecto_schema(json, module_name) do
    """
    # AUTO-GENERATED from #{json["$id"]}
    # Do not edit manually. Re-run `mix codegen.schemas` after JSON Schema changes.
    
    defmodule AINovelStudio.Persistence.Schemas.#{module_name} do
      use Ecto.Schema
      import Ecto.Changeset
      
      @primary_key {:id, :binary_id, autogenerate: true}
      schema "#{table_name(json)}" do
    #{generate_fields(json)}
        timestamps(type: :utc_datetime_usec)
      end
      
      def changeset(struct, params) do
        struct
        |> cast(params, [#{required_fields(json)}])
        |> validate_required([#{required_fields(json)}])
    #{generate_validations(json)}
      end
    end
    """
  end
end
```

### 4.2 类型映射

| JSON Schema | Ecto type |
|---|---|
| `string` | `:string` |
| `string + format=uuid` | `:binary_id` |
| `string + format=date-time` | `:utc_datetime_usec` |
| `integer` | `:integer` |
| `number` | `:float` |
| `boolean` | `:boolean` |
| `array` | `{:array, inner_type}` |
| `object` | `:map` |
| `enum` | `Ecto.Enum, values: [...]` |
| `oneOf / anyOf` | `:map`（手工解析）|

### 4.3 生成示例

输入 `turn_result.json` →

```elixir
# AUTO-GENERATED from https://design.local/schemas/turn_result.json
defmodule AINovelStudio.Persistence.Schemas.TurnResult do
  use Ecto.Schema
  import Ecto.Changeset
  
  @primary_key {:id, :binary_id, autogenerate: true}
  schema "turn_results" do
    field :turn_id, :binary_id
    field :workspace_id, :binary_id
    field :author_id, :binary_id
    field :intent_ref, :string
    field :phase, Ecto.Enum, values: [:RECEIVED, :ROUTED, :READY_TO_EXECUTE, :EXECUTING, :COMPLETED, :NEEDS_CLARIFICATION, :FAILED]
    field :status, Ecto.Enum, values: [:OK, :NEEDS_CLARIFICATION, :NEEDS_CONFIRMATION, :REJECTED, :CANCELLED, :FAILED]
    field :next_action, Ecto.Enum, values: [...]
    field :behavior_state, :map           # complex object, manual parse
    field :adoption_state, :map
    field :ui_cards, {:array, :map}       # 引用 card.json，complex
    field :memory_writes, {:array, :map}
    field :schema_version, :string
    field :domain_ext, :map               # extension point
    
    timestamps(type: :utc_datetime_usec)
  end
  
  def changeset(struct, params) do
    struct
    |> cast(params, [:turn_id, :workspace_id, :author_id, :intent_ref, :phase, ...])
    |> validate_required([:turn_id, :workspace_id, :author_id, :intent_ref, :phase, ...])
    |> validate_inclusion(:phase, [:RECEIVED, :ROUTED, ...])
  end
end
```

### 4.4 LLM I/O 派生：JSON Schema → embedded_schema（instructor_lite 用）

> 来源：[`verification/structured-output-library-choice.md`](./verification/structured-output-library-choice.md) §7（2026-04-26 二跑实测后落地）。
>
> 历史背景：原方案是 `instructor_ex` 0.1.0；spike 二跑补评后切到 `instructor_lite` 1.2。两者都以 Ecto embedded schema 派生 JSON Schema，但 `instructor_lite` 的 `for_type/1` 输出更精简，`instructor_ex` 会额外加入 description / format / pattern 等提示元数据。本节仍然适用，但 Phase 0 的 reverse-check 必须以 `InstructorLite` 实际输出为准。

`instructor_lite` 使用 `Ecto.Schema` 的 `embedded_schema` 作为 `response_model`，在底层自动派生 JSON Schema 并校验。如果 LLM I/O 与持久化共用一份 Ecto schema，会拽进 timestamps / 自增 ID / DB 字段，污染 LLM contract。所以两套 Ecto 输出必须分开：

| 输出类型 | 目标目录 | 形态 | 用途 |
|---|---|---|---|
| 持久化 schema | `apps/novel_persistence/lib/persistence/schemas/` | `schema "table" do ... end`，含 `@primary_key` 与 `timestamps`，绑定表 | 写库、Repo 操作 |
| LLM I/O schema | `apps/novel_provider/lib/provider/llm_schemas/` | `embedded_schema do ... end`，**无** PK、**无** timestamps，只表达 LLM 协议字段 | `instructor_lite` `response_model:`、Provider Gateway 出入参 |

代码规则（Phase 0 起强制）：

```elixir
# AUTO-GENERATED from https://design.local/schemas/intent_create_work_seed.json
defmodule AINovelStudio.Provider.LLMSchemas.CreateWorkSeed do
  use Ecto.Schema
  use InstructorLite.Instruction  # provides @llm_doc + json_schema/0 + validate_changeset/2

  @llm_doc """
  代表一本小说的最小初始设定。
  - genre: 必须是以下之一: 玄幻 / 都市 / 科幻 / 悬疑 / 其他。
  """
  @primary_key false
  embedded_schema do
    field :title, :string
    field :genre, Ecto.Enum, values: [:"玄幻", :"都市", :"科幻", :"悬疑", :"其他"]
    field :core_hook, :string
    embeds_many :initial_characters, Character, primary_key: false do
      field :name, :string
      field :role, :string
    end
  end
end
```

mix task 增量改动（`mix codegen.schemas`）：

1. 默认输出 persistence schema（§4.1 / §4.2 已有）。
2. 当 SSOT JSON Schema 文件名匹配 `intent_*.json` / `artifact_*.json` / `card_*.json` / `quality_finding_*.json`，**额外**输出一份 LLM I/O 的 `embedded_schema` 到 `apps/novel_provider/lib/provider/llm_schemas/`。
3. 派生时：
   - 跳过 `id / *_id (UUID) / timestamps` 等纯 DB 字段（在 SSOT 用 `"x-llm-io": false` 标注）。
   - 把 nested object 用 `embeds_one`，array of object 用 `embeds_many`，并按 `embedded_schema` 模板生成内部 module。
   - **JSON Schema `enum` 必须派生为 `Ecto.Enum, values: [...]`**，不能派生成 `:string`。spike 实测过，`field :foo, :string` 让 `instructor_lite` 派生出"任意 string"，模型自由发挥时 ex_json_schema 才在 Gateway 入口拦下，把可以前置约束的失败延迟成 schema_mismatch 事件。
   - 顶部生成 `@llm_doc` 注释，内容来自 JSON Schema 的 `description` 与 `enum` 提示，因为 `instructor_lite` 会把它作为 system prompt 的一部分发送给模型。
4. 一并生成 `mix codegen.schemas --reverse-check`：把 `embedded_schema` 经 `InstructorLite.JSONSchema.from_ecto_schema/1` 派生回 JSON Schema，再用 `ex_json_schema` 与 SSOT 做语义对齐 diff（属性集 / required / enum）。**任何漂移都阻塞 CI**。

### 4.5 ex_json_schema 边界（实测后明确）

不论 instructor_lite / langchain / 直连 Req 哪条路径返回，**Provider Gateway 入口必须再用 `ex_json_schema` 校验一次**：

- `instructor_lite` 的 changeset 校验是字段级的，不强制 `additionalProperties: false`；ex_json_schema 才能拦住"多余字段"。
- `langchain` / 直连 Req 拿到 string content，要先 `Jason.decode` 再 `ExJsonSchema.Validator.validate`，失败分别归一为 `:invalid_json` / `:schema_mismatch`（详见 [`07-provider.md`](./07-provider.md) §7.1）。
- **`Ecto.Enum` cast 完是 atom**（包括非 ASCII 中文 atom，`instructor_lite` 1.2 与 `instructor` 0.1 在 `for_type/1` 中都把 `Keyword.keys(mappings)` 的 atom 直接放进派生出的 `enum:` 数组）。Provider Gateway 出口在交给 `ex_json_schema` 校验或下游消费前，必须先把 atom 字段 `Atom.to_string/1`，否则会被判 schema_mismatch（spike 二跑实测命中过 6 次）。本仓 spike 用 `defp stringify(value) when is_atom(value), do: Atom.to_string(value)` 在 `seed_to_map/1` 里集中处理。

---

## 5. 前端 codegen：JSON Schema → Zod + TS

### 5.1 工具

[`json-schema-to-zod`](https://github.com/StefanTerdell/json-schema-to-zod) 或自定义脚本。

### 5.2 NPM script

```json
{
  "scripts": {
    "codegen:schemas": "node scripts/codegen-schemas.mjs"
  }
}
```

### 5.3 codegen-schemas.mjs

```js
import fs from "fs/promises";
import path from "path";
import { jsonSchemaToZod } from "json-schema-to-zod";

const SSOT_DIR = "../docs/design/schemas";
const TARGET_DIR = "src/generated/schemas";

async function main() {
  const files = await fs.readdir(SSOT_DIR);
  
  for (const file of files) {
    if (!file.endsWith(".json") || file.startsWith("_")) continue;
    
    const schema = JSON.parse(await fs.readFile(path.join(SSOT_DIR, file), "utf-8"));
    const tsCode = generateTS(schema, file);
    
    const outFile = path.join(TARGET_DIR, file.replace(".json", ".ts"));
    await fs.writeFile(outFile, tsCode);
    console.log(`✓ Generated ${outFile}`);
  }
}

function generateTS(schema, filename) {
  // jsonSchemaToZod 默认产出 `const schema = z.object(...)`。我们重命名为
  // `<TypeName>Schema` 并补上 type 别名。
  const rawZod = jsonSchemaToZod(schema, { module: "esm" });
  const typeName = pascalCase(filename.replace(".json", ""));
  const renamed = rawZod.replace(/\bconst\s+schema\b/, `const ${typeName}Schema`);

  return `// AUTO-GENERATED from ${schema.$id}
// Do not edit manually. Re-run \`pnpm codegen:schemas\` after JSON Schema changes.

import { z } from "zod";

${renamed}

export { ${typeName}Schema };
export type ${typeName} = z.infer<typeof ${typeName}Schema>;
`;
}

main();
```

### 5.4 生成示例

输入 `turn_result.json` →

```ts
// AUTO-GENERATED from https://design.local/schemas/turn_result.json
import { z } from "zod";

const TurnPhaseEnum = z.enum([
  "RECEIVED", "ROUTED", "READY_TO_EXECUTE", "EXECUTING", 
  "COMPLETED", "NEEDS_CLARIFICATION", "FAILED"
]);

const TurnResultSchema = z.object({
  turn_id: z.string().uuid(),
  workspace_id: z.string().uuid(),
  author_id: z.string().uuid(),
  intent_ref: z.string(),
  phase: TurnPhaseEnum,
  status: z.enum(["OK", "NEEDS_CLARIFICATION", "NEEDS_CONFIRMATION", "REJECTED", "CANCELLED", "FAILED"]),
  // ... etc
  ui_cards: z.array(CardSchema),
  schema_version: z.string(),
  domain_ext: z.record(z.unknown()).optional()
});

export { TurnResultSchema };
export type TurnResult = z.infer<typeof TurnResultSchema>;
```

---

## 6. Contract test

CI 必跑：

### 6.1 后端

```elixir
# apps/novel_persistence/test/contract/schema_consistency_test.exs
defmodule SchemaConsistencyTest do
  use ExUnit.Case
  
  test "Ecto schemas match JSON Schema SSOT" do
    schemas = Path.wildcard("docs/design/schemas/*.json")
    
    for schema_file <- schemas do
      json = File.read!(schema_file) |> Jason.decode!()
      module = file_to_module(schema_file)
      
      ecto_fields = module.__schema__(:fields)
      json_required = json["required"]
      
      for field <- json_required do
        assert String.to_atom(field) in ecto_fields,
          "JSON Schema requires #{field} but Ecto schema #{module} doesn't have it"
      end
    end
  end
end
```

### 6.2 前端

```ts
// frontend/tests/contract/schema.test.ts
import { TurnResultSchema } from "@/generated/schemas/turn_result";
import sampleTurnResult from "../../docs/design/schemas/examples/turn_result_minimal.json";

test("Zod schema accepts valid TurnResult fixture", () => {
  expect(() => TurnResultSchema.parse(sampleTurnResult)).not.toThrow();
});

test("Zod schema rejects missing required field", () => {
  const { turn_id, ...invalid } = sampleTurnResult;
  expect(() => TurnResultSchema.parse(invalid)).toThrow();
});
```

### 6.3 跨端一致性

最严格的 contract test：序列化 + 反序列化跨端不丢字段。

```elixir
test "round trip via JSON 同 frontend" do
  result = %TurnResult{...}
  json = Jason.encode!(result)
  
  # 通过 ex_json_schema 验证
  schema = ExJsonSchema.Schema.resolve(File.read!("docs/design/schemas/turn_result.json"))
  assert :ok = ExJsonSchema.Validator.validate(schema, Jason.decode!(json))
end
```

```ts
test("round trip via JSON 同 backend", async () => {
  const validJson = await fetch("/test/turn_result_fixture").then(r => r.json());
  const parsed = TurnResultSchema.parse(validJson);
  expect(parsed).toEqual(validJson);
});
```

---

## 7. CI 集成

```yaml
# .github/workflows/ci.yml
jobs:
  schema-consistency:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - name: Re-run codegen
        run: |
          mix codegen.schemas
          pnpm --filter frontend codegen:schemas
      - name: Verify no diff
        run: |
          git diff --exit-code apps/novel_persistence/lib/persistence/schemas/
          git diff --exit-code frontend/src/generated/schemas/
        # 如果 codegen 输出与已有不一致, CI 失败
      - name: Run contract tests
        run: |
          mix test --only contract
          pnpm --filter frontend test:contract
```

---

## 8. 演化纪律

- 改 JSON Schema → 立 ADR（Foundation 硬骨）→ re-run codegen → commit codegen 输出 → contract test pass
- 不允许手工编辑 `apps/novel_persistence/lib/persistence/schemas/*.ex`
- 不允许手工编辑 `frontend/src/generated/schemas/*.ts`
- 业务字段（如人物表的 `personality`）属于 Domain 自有，不走 SSOT codegen，可以手写

---

## 9. 当前 TBD

- 具体 codegen 工具实现（是否已有现成 Elixir 库 vs 自实现）
- Custom validation rules（JSON Schema draft-07 不能表达所有 ADR-0001 的约束，比如"phase=COMPLETED 必须有 next_action=null"）
- Migration 自动生成（schema 改动 → 自动生成 Ecto migration 草稿）
- Schema versioning（schema_version 字段如何向前兼容）
- Domain 扩展字段（domain_ext.*）的类型保证

以上 TBD 在 Phase 0 中期处理，不阻塞早期开发（早期可手写少量 schema 验证流程）。
