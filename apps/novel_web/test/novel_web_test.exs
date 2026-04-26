defmodule NovelWebTest do
  use ExUnit.Case
  doctest NovelWeb

  test "greets the world" do
    assert NovelWeb.hello() == :world
  end
end
