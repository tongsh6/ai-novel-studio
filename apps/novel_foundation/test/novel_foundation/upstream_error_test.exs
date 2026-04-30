defmodule NovelFoundation.UpstreamErrorTest do
  use ExUnit.Case, async: true

  alias NovelFoundation.UpstreamError

  describe "new/3" do
    test "creates error struct with correct defaults" do
      err = UpstreamError.new(:timeout, "timed out", "lmstudio")

      assert err.type == :timeout
      assert err.message == "timed out"
      assert err.provider == "lmstudio"
      assert err.retryable == true
      assert err.details == %{}
    end

    test "sets non-retryable for :auth" do
      err = UpstreamError.new(:auth, "unauthorized", "anthropic")
      assert err.retryable == false
    end

    test "sets non-retryable for :content_filter" do
      err = UpstreamError.new(:content_filter, "blocked", "anthropic")
      assert err.retryable == false
    end
  end

  describe "new/4 with details" do
    test "includes details map" do
      err = UpstreamError.new(:invalid_response, "bad json", "lmstudio", %{status: 500})

      assert err.details.status == 500
      assert err.type == :invalid_response
    end
  end

  describe "retryable?/1" do
    test "retryable errors" do
      assert UpstreamError.retryable?(:connection_refused)
      assert UpstreamError.retryable?(:timeout)
      assert UpstreamError.retryable?(:rate_limit)
      assert UpstreamError.retryable?(:provider_internal)
    end

    test "non-retryable errors" do
      refute UpstreamError.retryable?(:invalid_response)
      refute UpstreamError.retryable?(:model_not_loaded)
      refute UpstreamError.retryable?(:auth)
      refute UpstreamError.retryable?(:content_filter)
      refute UpstreamError.retryable?(:parse)
    end
  end

  describe "to_error_tuple/1" do
    test "converts to {:error, map}" do
      err = UpstreamError.new(:timeout, "timed out", "lmstudio")
      assert {:error, map} = UpstreamError.to_error_tuple(err)
      assert map.type == :timeout
      assert map.message == "timed out"
      assert map.provider == "lmstudio"
      assert map.retryable == true
    end
  end
end
