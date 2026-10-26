import { QueryClient } from "@tanstack/react-query";
import type { Channel } from "phoenix";
import { expect, it } from "vitest";
import { readingProjectionQuery, readingProjectionQueryKey } from "../readingProjectionQuery";

function source() {
  const state = { text: "原文。", failSecond: false, calls: [] as string[] };
  const channel = {
    push(event: string, _payload: unknown) {
      state.calls.push(event);
      const fail = event === "get_chapter_content" && state.failSecond;
      const result =
        event === "get_toc"
          ? {
              volumes: [
                {
                  id: "v",
                  title: "卷",
                  seq: 1,
                  chapters: [{ id: "chapter", title: "章", seq: 1 }],
                },
              ],
            }
          : {
              title: "章",
              scenes: [
                { title: "当前稿", content: state.text },
                { title: "历史场", content: "" },
              ],
            };
      const reply = {
        receive(status: string, callback: (value: unknown) => void) {
          if (status === (fail ? "error" : "ok"))
            queueMicrotask(() => callback(fail ? "读取失败" : result));
          return reply;
        },
      };
      return reply;
    },
  } as unknown as Channel;
  return { state, channel };
}

it("采纳hint失效缓存后重新读取当前正文，空历史场不混入阅读且不发送创作请求", async () => {
  const { state, channel } = source();
  const client = new QueryClient();
  const options = readingProjectionQuery(channel, "work");
  const first = await client.fetchQuery(options);
  expect(first.chaptersContent.chapter.scenes).toEqual([{ title: "当前稿", content: "原文。" }]);
  state.text = "新正文。\n新的分段。";
  expect((await client.fetchQuery(options)).chaptersContent.chapter.scenes[0].content).toBe(
    "原文。",
  );
  await client.invalidateQueries({ queryKey: readingProjectionQueryKey("work") });
  expect(client.getQueryState(readingProjectionQueryKey("work"))?.isInvalidated).toBe(true);
  const current = await client.fetchQuery(options);
  expect(current.chaptersContent.chapter.scenes[0].content).toBe(state.text);
  expect(client.getQueryState(readingProjectionQueryKey("work"))?.isInvalidated).toBe(false);
  expect(new Set(state.calls)).toEqual(new Set(["get_toc", "get_chapter_content"]));
  client.clear();
});

it("章节读取失败保留旧缓存并标error，重试成功才恢复，不用部分结果冒充最新", async () => {
  const { state, channel } = source();
  const client = new QueryClient();
  const options = readingProjectionQuery(channel, "work");
  const before = await client.fetchQuery(options);
  state.text = "失败期间不应混入的正文";
  state.failSecond = true;
  await client.invalidateQueries({ queryKey: readingProjectionQueryKey("work") });
  await expect(client.fetchQuery(options)).rejects.toThrow("读取失败");
  expect(client.getQueryData(readingProjectionQueryKey("work"))).toEqual(before);
  expect(client.getQueryState(readingProjectionQueryKey("work"))?.status).toBe("error");
  state.failSecond = false;
  const retried = await client.fetchQuery(options);
  expect(retried.chaptersContent.chapter.scenes[0].content).toBe(state.text);
  expect(client.getQueryState(readingProjectionQueryKey("work"))?.status).toBe("success");
  client.clear();
});
