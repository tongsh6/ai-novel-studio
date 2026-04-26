defmodule Persistence.SchemaDriftTest do
  use ExUnit.Case, async: true

  test "all Ecto mirrors are in sync with JSON SSOT" do
    assert :ok = Persistence.SchemaDrift.check()
  end
end
