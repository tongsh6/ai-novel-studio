defmodule V2Verification.Spike.StructuredOutput.Schemas.Character do
  use Ecto.Schema

  @primary_key false
  embedded_schema do
    field :name, :string
    field :role, :string
  end
end

defmodule V2Verification.Spike.StructuredOutput.Schemas.CreateWorkSeed do
  use Ecto.Schema
  use Instructor

  alias V2Verification.Spike.StructuredOutput.Schemas.Character

  @llm_doc """
  代表一本小说的最小初始设定。

  - `title`: 简短标题。
  - `genre`: 必须是以下之一: 玄幻 / 都市 / 科幻 / 悬疑 / 其他。
  - `core_hook`: 一句话核心钩子。
  - `initial_characters`: 至少 1 个初始角色，每个有 name 和 role。
  """
  @primary_key false
  embedded_schema do
    field :title, :string
    field :genre, Ecto.Enum, values: [:"玄幻", :"都市", :"科幻", :"悬疑", :"其他"]
    field :core_hook, :string
    embeds_many :initial_characters, Character
  end
end

defmodule V2Verification.Spike.StructuredOutput.JsonSchema do
  @schema %{
    "type" => "object",
    "additionalProperties" => false,
    "required" => ["title", "genre", "core_hook", "initial_characters"],
    "properties" => %{
      "title" => %{"type" => "string", "minLength" => 1},
      "genre" => %{"type" => "string", "enum" => ["玄幻", "都市", "科幻", "悬疑", "其他"]},
      "core_hook" => %{"type" => "string", "minLength" => 1},
      "initial_characters" => %{
        "type" => "array",
        "minItems" => 1,
        "items" => %{
          "type" => "object",
          "additionalProperties" => false,
          "required" => ["name", "role"],
          "properties" => %{
            "name" => %{"type" => "string", "minLength" => 1},
            "role" => %{"type" => "string", "minLength" => 1}
          }
        }
      }
    }
  }

  def get, do: @schema

  def resolved do
    ExJsonSchema.Schema.resolve(@schema)
  end

  def validate(payload) do
    case ExJsonSchema.Validator.validate(resolved(), payload) do
      :ok -> :ok
      {:error, errors} -> {:error, {:schema_mismatch, errors}}
    end
  end
end
