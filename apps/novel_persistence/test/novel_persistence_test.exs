defmodule NovelPersistenceTest do
  use ExUnit.Case
  doctest NovelPersistence

  test "greets the world" do
    assert NovelPersistence.hello() == :world
  end
end
