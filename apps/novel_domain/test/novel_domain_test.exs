defmodule NovelDomainTest do
  use ExUnit.Case
  doctest NovelDomain

  test "greets the world" do
    assert NovelDomain.hello() == :world
  end
end
