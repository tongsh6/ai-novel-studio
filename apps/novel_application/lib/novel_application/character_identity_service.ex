defmodule NovelApplication.CharacterIdentityService do
  @moduledoc """
  角色身份归并用例层（AU12）。

  name 不是身份主键——合并只能由作者从档案侧显式发起（真重名/别名/改名是
  三种创作意图，机器不自动判定）。本服务是 web 的用例边界（比照
  AssumptionService 口径，直连持久层），事务语义见 CharacterMergeRepo。
  """

  alias NovelPersistence.CharacterMergeRepo

  @type merged_dto :: %{
          target: %{
            id: String.t(),
            name: String.t(),
            aliases: [String.t()],
            role: String.t() | nil,
            narrative_role: String.t() | nil,
            summary: String.t() | nil,
            status: String.t()
          },
          superseded_ref: String.t()
        }

  @spec merge(String.t(), String.t(), String.t(), String.t()) ::
          {:ok, merged_dto()} | {:error, term()}
  def merge(work_id, source_ref, target_ref, keep_name)
      when is_binary(work_id) and is_binary(source_ref) and is_binary(target_ref) do
    case CharacterMergeRepo.merge(work_id, source_ref, target_ref, normalize_keep_name(keep_name)) do
      {:ok, %{target: target, superseded_ref: superseded_ref}} ->
        {:ok, %{target: to_dto(target), superseded_ref: superseded_ref}}

      {:error, reason} ->
        {:error, reason}
    end
  end

  defp normalize_keep_name("source"), do: "source"
  defp normalize_keep_name(_), do: "target"

  defp to_dto(character) do
    %{
      id: to_string(Map.get(character, :id)),
      name: Map.get(character, :name),
      aliases: Map.get(character, :aliases) || [],
      role: Map.get(character, :role),
      narrative_role: Map.get(character, :narrative_role),
      summary: Map.get(character, :summary),
      status: Map.get(character, :status)
    }
  end
end
