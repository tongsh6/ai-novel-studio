defmodule NovelAgent.Provider.Strata.LocalModels do
  @moduledoc """
  Strata 本机模型发现（SU01-strata-local-models）。

  Strata（strata-engine）是「一进程一模型」：每个可运行的模型由本机安装目录下一个
  `strata-*.json` profile 描述（`model_name` / `host` / `port`）。单个端点
  `GET /v1/models` 天然只能返回当前引擎自己的模型，因此本模块直接读 profile 配置，
  再对每个 profile 的 `GET /models` 做一次真实探活，回答「本机装了哪些 Strata 模型、
  现在哪些在运行」。发现源是产品真实配置数据，不扫端口、不硬编码模型名/端口。

  ## 发现目录（优先级从高到低）

    1. `opts[:install_dir]`（单测/内部注入）
    2. `System.get_env("NOVEL_STRATA_MODELS_DIR")`（运维覆盖，优先级高于应用配置，
       便于不重编译换目录）
    3. `Application.get_env(:novel_agent, NovelAgent.Provider.Strata)[:models_dir]`
       （产品配置；test 环境注入确定目录，见 `config/test.exs`）
    4. 平台默认（与 Strata 应用自身默认一致）：
       - POSIX：`$XDG_DATA_HOME/strata/install`（默认 `~/.local/share/strata/install`）
       - Windows：`%LOCALAPPDATA%/Strata/install`（默认 `~/AppData/Local/Strata/install`）

  ## 诚实边界

  - `running` 只证明该 profile 端点的 `GET /models` 可达（2xx），不证明模型权重/引擎
    健康，也不证明回复质量。
  - 目录不存在/不可读、单个 profile 读取/解析失败、探活失败都只跳过该项（或标
    `running: false`）：本机发现是可选增强，失败返回 `[]` 让上层回退既有实时
    `/models` 列表，绝不 raise、绝不阻断既有 provider 流程。
  """

  alias NovelAgent.Provider.HTTP

  @default_host "127.0.0.1"
  @probe_receive_timeout 800
  @probe_connect_timeout 500
  @probe_timeout 4_000
  @max_concurrency 4

  @typedoc "本机发现出的一个 Strata profile 模型（只含非 secret 的本地配置元数据）"
  @type model :: %{
          id: String.t(),
          label: String.t(),
          endpoint: String.t(),
          host: String.t(),
          port: pos_integer(),
          running: boolean(),
          config: String.t()
        }

  @doc """
  列出本机 Strata 安装目录里的 profile 模型并对每个端点探活。

  可注入：

    - `:install_dir` — 覆盖发现目录（单测/内部注入）
    - `:probe` — 一元函数 `endpoint <> "/models" -> boolean()`，覆盖真实 HTTP 探活
      （单测确定性；注入替身抛错也只让该项 `running: false`）
  """
  @spec list(keyword()) :: [model()]
  def list(opts \\ []) do
    install_dir = install_dir(opts)
    probe = probe_fun(opts)

    install_dir
    |> profile_entries()
    |> Task.async_stream(&probe_entry(&1, probe),
      max_concurrency: @max_concurrency,
      timeout: @probe_timeout,
      on_timeout: :kill_task
    )
    |> Enum.flat_map(fn
      {:ok, model} -> [model]
      _failure -> []
    end)
    |> dedupe_by_id()
    |> sort_models()
  rescue
    # 本机发现是可选增强：任何未预料的读取/解析/探活异常都降级为空列表，绝不 raise。
    _error -> []
  catch
    _kind, _reason -> []
  end

  # ── 发现目录解析 ────────────────────────────────

  defp install_dir(opts) do
    Keyword.get(opts, :install_dir) ||
      env_install_dir() ||
      configured_install_dir() ||
      platform_install_dir()
  end

  defp env_install_dir do
    System.get_env("NOVEL_STRATA_MODELS_DIR")
    |> non_empty_string()
  end

  defp configured_install_dir do
    case Application.get_env(:novel_agent, NovelAgent.Provider.Strata, []) do
      config when is_list(config) ->
        config
        |> Keyword.get(:models_dir)
        |> non_empty_string()

      _other ->
        nil
    end
  end

  # 与 Strata 应用自身的默认安装目录保持一致；取不到用户主目录时诚实降级为 nil。
  defp platform_install_dir do
    case :os.type() do
      {:win32, _} ->
        base = System.get_env("LOCALAPPDATA") || Path.expand("~/AppData/Local")
        Path.join(base, "Strata/install")

      _posix ->
        base = System.get_env("XDG_DATA_HOME") || Path.expand("~/.local/share")
        Path.join(base, "strata/install")
    end
  rescue
    _error -> nil
  end

  # ── profile 解析 ────────────────────────────────

  defp profile_entries(install_dir) do
    install_dir
    |> profile_files()
    |> Enum.flat_map(fn path ->
      case read_profile(path) do
        nil -> []
        entry -> [entry]
      end
    end)
  end

  defp profile_files(install_dir) when is_binary(install_dir) do
    case File.ls(install_dir) do
      {:ok, names} ->
        names
        |> Enum.sort()
        |> Enum.filter(&profile_file_name?/1)
        |> Enum.map(&Path.join(install_dir, &1))
        |> Enum.filter(&File.regular?/1)

      {:error, _reason} ->
        # 目录不存在 / 不可读 / 不是目录 → 安静返回空列表。
        []
    end
  end

  defp profile_files(_install_dir), do: []

  defp profile_file_name?(name) when is_binary(name) do
    String.starts_with?(name, "strata-") and String.ends_with?(name, ".json")
  end

  defp profile_file_name?(_name), do: false

  defp read_profile(path) do
    with {:ok, content} <- File.read(path),
         {:ok, profile} when is_map(profile) <- Jason.decode(content),
         {:ok, entry} <- model_from_profile(profile) do
      Map.put(entry, :config, Path.basename(path))
    else
      _malformed -> nil
    end
  end

  defp model_from_profile(profile) when is_map(profile) do
    model_name = non_empty_string(Map.get(profile, "model_name"))
    port = Map.get(profile, "port")

    if is_binary(model_name) and valid_port?(port) do
      host = non_empty_string(Map.get(profile, "host")) || @default_host

      {:ok,
       %{
         id: model_name,
         label: model_name,
         endpoint: "http://#{host}:#{port}/v1",
         host: host,
         port: port
       }}
    else
      :error
    end
  end

  defp model_from_profile(_profile), do: :error

  defp valid_port?(port), do: is_integer(port) and port >= 1 and port <= 65_535

  # ── 探活 ────────────────────────────────────────

  defp probe_entry(entry, probe) do
    Map.put(entry, :running, probe_running?(probe, entry.endpoint <> "/models"))
  end

  # 探活可注入替身：替身自身抛错/超时只意味着「这个 profile 现在不可用」，
  # 不能拖垮整次发现。
  defp probe_running?(probe, url) do
    case probe.(url) do
      true -> true
      {:ok, status, _body} when status in 200..299 -> true
      _other -> false
    end
  rescue
    _error -> false
  catch
    _kind, _reason -> false
  end

  defp probe_fun(opts) do
    case Keyword.get(opts, :probe) do
      probe when is_function(probe, 1) -> probe
      _other -> &default_probe/1
    end
  end

  defp default_probe(url) do
    case HTTP.get(url,
           receive_timeout: @probe_receive_timeout,
           connect_timeout: @probe_connect_timeout
         ) do
      {:ok, status, _body} when status in 200..299 -> true
      _failure -> false
    end
  end

  # ── 去重与确定性排序 ────────────────────────────

  defp dedupe_by_id(models), do: Enum.uniq_by(models, & &1.id)

  # 运行中的 profile 优先（作者先看到可立刻使用的模型），其次按 id 升序保证确定性。
  defp sort_models(models) do
    Enum.sort_by(models, fn model -> {if(model.running, do: 0, else: 1), model.id} end)
  end

  defp non_empty_string(value) when is_binary(value) do
    case String.trim(value) do
      "" -> nil
      trimmed -> trimmed
    end
  end

  defp non_empty_string(_value), do: nil
end
