defmodule NovelAgent.Provider.Strata.LocalModelsTest do
  use ExUnit.Case, async: false

  alias NovelAgent.Provider.Strata
  alias NovelAgent.Provider.Strata.LocalModels

  setup do
    old_env = System.get_env("NOVEL_STRATA_MODELS_DIR")
    old_config = Application.get_env(:novel_agent, Strata)
    System.delete_env("NOVEL_STRATA_MODELS_DIR")

    dir =
      Path.join(
        System.tmp_dir!(),
        "strata_local_models_test_#{System.unique_integer([:positive, :monotonic])}"
      )

    File.mkdir_p!(dir)

    on_exit(fn ->
      File.rm_rf(dir)

      if old_env do
        System.put_env("NOVEL_STRATA_MODELS_DIR", old_env)
      else
        System.delete_env("NOVEL_STRATA_MODELS_DIR")
      end

      if old_config do
        Application.put_env(:novel_agent, Strata, old_config)
      else
        Application.delete_env(:novel_agent, Strata)
      end
    end)

    {:ok, dir: dir}
  end

  describe "list/1 discovery" do
    test "parses installed Strata profiles into local model entries", %{dir: dir} do
      write_profile(dir, "strata-q2_0.json", %{
        "model_name" => "qwen3.8-flash-next-q2_0",
        "host" => "127.0.0.1",
        "port" => 8081
      })

      write_profile(dir, "strata-iq3_s.json", %{
        "model_name" => "qwen3.8-flash-next-iq3_s",
        "port" => 8082
      })

      assert [iq3, q2] = LocalModels.list(install_dir: dir, probe: fn _url -> false end)

      assert iq3 == %{
               id: "qwen3.8-flash-next-iq3_s",
               label: "qwen3.8-flash-next-iq3_s",
               endpoint: "http://127.0.0.1:8082/v1",
               host: "127.0.0.1",
               port: 8082,
               running: false,
               config: "strata-iq3_s.json"
             }

      assert q2 == %{
               id: "qwen3.8-flash-next-q2_0",
               label: "qwen3.8-flash-next-q2_0",
               endpoint: "http://127.0.0.1:8081/v1",
               host: "127.0.0.1",
               port: 8081,
               running: false,
               config: "strata-q2_0.json"
             }
    end

    test "marks a profile running only when its /models endpoint responds", %{dir: dir} do
      write_profile(dir, "strata-q2_0.json", %{
        "model_name" => "qwen3.8-flash-next-q2_0",
        "port" => 8081
      })

      write_profile(dir, "strata-iq3_s.json", %{
        "model_name" => "qwen3.8-flash-next-iq3_s",
        "port" => 8082
      })

      test_pid = self()

      probe = fn url ->
        send(test_pid, {:probe, url})
        url == "http://127.0.0.1:8082/v1/models"
      end

      models = LocalModels.list(install_dir: dir, probe: probe)

      assert Enum.map(models, &{&1.id, &1.running}) == [
               {"qwen3.8-flash-next-iq3_s", true},
               {"qwen3.8-flash-next-q2_0", false}
             ]

      assert_receive {:probe, "http://127.0.0.1:8081/v1/models"}
      assert_receive {:probe, "http://127.0.0.1:8082/v1/models"}
    end

    test "skips malformed profiles without raising", %{dir: dir} do
      File.write!(Path.join(dir, "strata-broken.json"), "{not json")
      write_profile(dir, "strata-missing-model.json", %{"port" => 8081})
      write_profile(dir, "strata-bad-port.json", %{"model_name" => "bad-port", "port" => "8081"})
      write_profile(dir, "strata-range-port.json", %{"model_name" => "range", "port" => 70_000})
      write_profile(dir, "strata-zero-port.json", %{"model_name" => "zero", "port" => 0})
      write_profile(dir, "not-a-profile.json", %{"model_name" => "ignored", "port" => 8081})
      File.mkdir_p!(Path.join(dir, "strata-directory.json"))
      write_profile(dir, "strata-good.json", %{"model_name" => "good", "port" => 8081})

      assert [%{id: "good", running: false}] =
               LocalModels.list(install_dir: dir, probe: fn _url -> false end)
    end

    test "deduplicates by model id and orders running profiles first, then by id", %{dir: dir} do
      write_profile(dir, "strata-a-dup.json", %{"model_name" => "m-dup", "port" => 9001})
      write_profile(dir, "strata-b-dup.json", %{"model_name" => "m-dup", "port" => 9002})
      write_profile(dir, "strata-c-idle.json", %{"model_name" => "m-idle", "port" => 9003})
      write_profile(dir, "strata-d-run.json", %{"model_name" => "m-run", "port" => 9004})
      write_profile(dir, "strata-e-run.json", %{"model_name" => "m-aaa-run", "port" => 9005})

      probe = fn url ->
        url in ["http://127.0.0.1:9004/v1/models", "http://127.0.0.1:9005/v1/models"]
      end

      models = LocalModels.list(install_dir: dir, probe: probe)

      assert Enum.map(models, &{&1.id, &1.running}) == [
               {"m-aaa-run", true},
               {"m-run", true},
               {"m-dup", false},
               {"m-idle", false}
             ]

      # 同 id 只留按文件名扫描顺序的第一条，且保留其 endpoint/config。
      duplicate = Enum.find(models, &(&1.id == "m-dup"))
      assert duplicate.config == "strata-a-dup.json"
      assert duplicate.port == 9001
      assert Enum.uniq(Enum.map(models, & &1.id)) == Enum.map(models, & &1.id)
    end

    test "returns [] for missing or non-directory install dirs", %{dir: dir} do
      missing = Path.join(dir, "does-not-exist")
      assert LocalModels.list(install_dir: missing, probe: fn _url -> true end) == []

      file_path = Path.join(dir, "not-a-dir")
      File.write!(file_path, "x")
      assert LocalModels.list(install_dir: file_path, probe: fn _url -> true end) == []
    end

    test "isolates probe failures per profile", %{dir: dir} do
      write_profile(dir, "strata-boom.json", %{"model_name" => "m-boom", "port" => 9001})
      write_profile(dir, "strata-ok.json", %{"model_name" => "m-ok", "port" => 9002})

      probe = fn
        "http://127.0.0.1:9001/v1/models" -> raise "probe boom"
        _url -> true
      end

      assert Enum.map(LocalModels.list(install_dir: dir, probe: probe), &{&1.id, &1.running}) ==
               [{"m-ok", true}, {"m-boom", false}]
    end

    test "resolves install dir priority: opts > env > application config", %{dir: dir} do
      opts_dir = Path.join(dir, "opts")
      env_dir = Path.join(dir, "env")
      config_dir = Path.join(dir, "config")
      Enum.each([opts_dir, env_dir, config_dir], &File.mkdir_p!/1)

      write_profile(opts_dir, "strata-opts.json", %{"model_name" => "from-opts", "port" => 9101})
      write_profile(env_dir, "strata-env.json", %{"model_name" => "from-env", "port" => 9102})

      write_profile(config_dir, "strata-config.json", %{
        "model_name" => "from-config",
        "port" => 9103
      })

      put_models_dir(config_dir)
      put_env_dir(env_dir)
      probe = fn _url -> false end

      assert [%{id: "from-env"}] = LocalModels.list(probe: probe)
      assert [%{id: "from-opts"}] = LocalModels.list(install_dir: opts_dir, probe: probe)

      System.delete_env("NOVEL_STRATA_MODELS_DIR")
      assert [%{id: "from-config"}] = LocalModels.list(probe: probe)
    end

    test "Strata adapter delegates discovery to this module", %{dir: dir} do
      write_profile(dir, "strata-q2_0.json", %{
        "model_name" => "qwen3.8-flash-next-q2_0",
        "port" => 8081
      })

      probe = fn _url -> true end

      assert Code.ensure_loaded?(Strata)
      assert function_exported?(Strata, :local_models, 0)
      assert function_exported?(Strata, :local_models, 1)

      assert Strata.local_models(install_dir: dir, probe: probe) ==
               LocalModels.list(install_dir: dir, probe: probe)

      assert [%{id: "qwen3.8-flash-next-q2_0", running: true}] =
               Strata.local_models(install_dir: dir, probe: probe)
    end
  end

  defp write_profile(dir, name, attrs) do
    File.write!(Path.join(dir, name), Jason.encode!(attrs))
  end

  defp put_models_dir(dir) do
    old_config = Application.get_env(:novel_agent, Strata, [])
    Application.put_env(:novel_agent, Strata, Keyword.put(old_config, :models_dir, dir))
    on_exit(fn -> Application.put_env(:novel_agent, Strata, old_config) end)
  end

  defp put_env_dir(dir) do
    old_env = System.get_env("NOVEL_STRATA_MODELS_DIR")
    System.put_env("NOVEL_STRATA_MODELS_DIR", dir)

    on_exit(fn ->
      if old_env do
        System.put_env("NOVEL_STRATA_MODELS_DIR", old_env)
      else
        System.delete_env("NOVEL_STRATA_MODELS_DIR")
      end
    end)
  end
end
