defmodule NovelPersistence.ProviderFactProjectionTest do
  use ExUnit.Case, async: true

  alias NovelCommon.Contracts.{ProviderOutput, ProviderRun}
  alias NovelPersistence.ProviderFactProjection

  test "equivalent JSON representations remove private payloads recursively" do
    private = "private-material-must-not-survive"

    metadata = %{
      api_key: private,
      public: %{
        accepted: true,
        "System-Prompt": private,
        refs: [%{tag: "kept", content: private, chain_of_thought: private}]
      }
    }

    run = run(metadata)
    attrs = ProviderFactProjection.run_attrs(run, %{})

    assert attrs.metadata == %{
             "public" => %{"accepted" => true, "refs" => [%{"tag" => "kept"}]}
           }

    json_metadata = metadata |> Jason.encode!() |> Jason.decode!()
    replayed = ProviderFactProjection.run_attrs(%{run | metadata: json_metadata}, %{})
    assert replayed == attrs
    refute Jason.encode!(attrs) =~ private
    assert run.metadata == metadata
  end

  test "output summaries bind real text bytes without treating tool arguments as response text" do
    run = run(%{})

    output = %ProviderOutput{
      provider_run_ref: run.provider_run_id,
      provider_call_ref: run.provider_call_ref,
      status: :ok,
      content: %{
        text: "hello",
        tool_calls: [%{name: "inspect_history", arguments: %{text: "private-argument"}}]
      }
    }

    attrs = ProviderFactProjection.output_attrs(output, run, %{})

    assert attrs.content_summary["content_sha256"] ==
             "2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824"

    refute Map.has_key?(attrs.content_summary, "text")
    refute Jason.encode!(attrs) =~ "private-argument"

    tool_only = %{output | content: Map.delete(output.content, :text)}
    tool_attrs = ProviderFactProjection.output_attrs(tool_only, run, %{})
    refute Map.has_key?(tool_attrs.content_summary, "content_sha256")
    assert tool_attrs.content_summary["native_tool_call_count"] == 1
  end

  defp run(metadata) do
    %ProviderRun{
      provider_run_id: "prun-projection",
      provider_call_ref: "pcall-projection",
      purpose: :other,
      execution_mode: :event_stream,
      status: :initialized,
      provider_id: "projection-provider",
      model: "projection-model",
      owner_refs: %{},
      metadata: metadata
    }
  end
end
