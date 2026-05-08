ExUnit.start(exclude: [:integration, :real_llm])

Ecto.Adapters.SQL.Sandbox.mode(NovelPersistence.Repo, :manual)
