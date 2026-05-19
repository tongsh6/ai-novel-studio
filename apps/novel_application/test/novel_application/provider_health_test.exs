defmodule NovelApplication.ProviderHealthTest do
  use ExUnit.Case, async: false

  describe "provider_health/0" do
    test "returns provider metadata when the configured provider is healthy" do
      old_provider = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :stub)

      try do
        assert {:ok, %{provider: :stub, model: nil}} = NovelApplication.provider_health()
      after
        Application.put_env(:novel_agent, :provider, old_provider)
      end
    end

    test "keeps provider metadata on disconnected health results" do
      old_provider = Application.get_env(:novel_agent, :provider)
      Application.put_env(:novel_agent, :provider, default: :nonexistent)

      try do
        assert {:error, %{provider: :nonexistent, model: nil, error: error}} =
                 NovelApplication.provider_health()

        assert error.message == "unknown provider: nonexistent"
      after
        Application.put_env(:novel_agent, :provider, old_provider)
      end
    end
  end
end
