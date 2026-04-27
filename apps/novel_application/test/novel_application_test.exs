defmodule NovelApplicationTest do
  use ExUnit.Case
  doctest NovelApplication

  test "greets the world" do
    assert NovelApplication.hello() == :world
  end
end
