defmodule NovelWeb.OriginPolicyTest do
  use ExUnit.Case, async: true

  alias NovelWeb.OriginPolicy

  test "accepts exact Tauri and dev origins" do
    for origin <- [
          "tauri://localhost",
          "http://tauri.localhost",
          "https://tauri.localhost",
          "http://127.0.0.1:5768",
          "http://localhost:5768",
          "http://127.0.0.1:5769",
          "http://localhost:5769"
        ] do
      assert OriginPolicy.allowed_origin?(origin), origin
      assert OriginPolicy.allowed_uri?(URI.parse(origin)), origin
    end
  end

  test "rejects suffix spoofing, wrong scheme/port/host, null and malformed origins" do
    for origin <- [
          "https://localhost.example.invalid",
          "http://127.0.0.1.example.invalid",
          "https://tauri.localhost.example.invalid",
          "http://localhost:9999",
          "https://127.0.0.1:5768",
          "ftp://127.0.0.1:5768",
          "null",
          "tauri://localhost:5768",
          "",
          "not a uri"
        ] do
      refute OriginPolicy.allowed_origin?(origin), origin
      refute OriginPolicy.allowed_uri?(URI.parse(origin)), origin
    end
  end

  test "header string with path is rejected even if URI host/port match" do
    refute OriginPolicy.allowed_origin?("http://127.0.0.1:5768/path")
  end

  test "non-string values are rejected" do
    refute OriginPolicy.allowed_origin?(nil)
    refute OriginPolicy.allowed_origin?(["tauri://localhost"])
    refute OriginPolicy.allowed_uri?(nil)
  end
end
