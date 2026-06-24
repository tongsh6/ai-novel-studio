defmodule NovelWeb.Plugs.CORSPlugTest do
  use ExUnit.Case, async: true

  import Plug.Test
  import Plug.Conn

  alias NovelWeb.Plugs.CORSPlug

  defp call(conn), do: CORSPlug.call(conn, CORSPlug.init([]))

  test "reflects allowed Tauri webview origin and sets CORS headers" do
    conn =
      conn(:get, "/api/provider/health")
      |> put_req_header("origin", "tauri://localhost")
      |> call()

    assert get_resp_header(conn, "access-control-allow-origin") == ["tauri://localhost"]
    assert get_resp_header(conn, "access-control-allow-methods") != []
    refute conn.halted
  end

  test "short-circuits OPTIONS preflight from allowed origin with 204" do
    conn =
      conn(:options, "/api/provider/health")
      |> put_req_header("origin", "http://tauri.localhost")
      |> call()

    assert conn.status == 204
    assert conn.halted
    assert get_resp_header(conn, "access-control-allow-origin") == ["http://tauri.localhost"]
  end

  test "allows localhost origins on any port" do
    conn =
      conn(:get, "/api/provider/health")
      |> put_req_header("origin", "http://127.0.0.1:5769")
      |> call()

    assert get_resp_header(conn, "access-control-allow-origin") == ["http://127.0.0.1:5769"]
  end

  test "does not add CORS headers for a disallowed origin" do
    conn =
      conn(:get, "/api/provider/health")
      |> put_req_header("origin", "https://evil.example.com")
      |> call()

    assert get_resp_header(conn, "access-control-allow-origin") == []
    refute conn.halted
  end

  test "is a no-op when no origin header is present" do
    conn = conn(:get, "/api/provider/health") |> call()

    assert get_resp_header(conn, "access-control-allow-origin") == []
    refute conn.halted
  end
end
