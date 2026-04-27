defmodule NovelApplicationTest do
  use ExUnit.Case

  test "application module loads" do
    assert Code.ensure_loaded?(NovelApplication)
  end
end
