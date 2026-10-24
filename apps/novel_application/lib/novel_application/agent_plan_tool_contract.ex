defmodule NovelApplication.AgentPlanToolContract do
  @moduledoc "B26：计划工具输入单一真源，判断同批计划与独立起草共用。"
  @draft_tool_name "agent_plan_draft"
  def tool(tool_name \\ @draft_tool_name) do
    %{
      name: tool_name,
      description: "Return the complete AgentPlan structure for this AgentRun.",
      input_schema: schema()
    }
  end

  def schema do
    %{
      type: "object",
      required: ["plan", "author_reasoning", "reason_codes", "confidence"],
      additionalProperties: false,
      properties: %{
        author_reasoning: %{
          type: "string",
          minLength: 1,
          description: "本响应的作者可见计划说明原文，content 为空时的叙事来源"
        },
        plan: %{
          type: "object",
          required: ["steps"],
          additionalProperties: false,
          properties: %{
            steps: %{
              type: "array",
              minItems: 1,
              items: %{
                type: "object",
                required: [
                  "step_id",
                  "kind",
                  "description",
                  "success_criteria",
                  "target_tool_ref"
                ],
                additionalProperties: false,
                properties: %{
                  step_id: %{type: "string", minLength: 1},
                  kind: %{type: "string", enum: ["explore", "act"]},
                  description: %{type: "string", minLength: 1},
                  success_criteria: %{type: "array", items: %{type: "string"}},
                  depends_on: %{type: "array", items: %{type: "string"}},
                  target_tool_ref: %{type: "string", minLength: 1},
                  write_intent: %{type: "string", enum: ["none", "tentative"]},
                  risk_hint: %{type: "string", enum: ["low", "medium", "high"]},
                  authoring_intent: %{
                    anyOf: [
                      %{type: "string", enum: ["none", "continuation", "rewrite"]},
                      %{type: "null"}
                    ]
                  },
                  target_chapter: %{anyOf: [%{type: "string"}, %{type: "null"}]},
                  target_chapter_ref: %{anyOf: [%{type: "string"}, %{type: "null"}]},
                  requested_chapter_raw: %{anyOf: [%{type: "string"}, %{type: "null"}]},
                  target_word_count: %{anyOf: [%{type: "integer"}, %{type: "null"}]},
                  exploration_query: %{anyOf: [%{type: "string"}, %{type: "null"}]}
                }
              }
            }
          }
        },
        reason_codes: %{type: "array", items: %{type: "string"}},
        confidence: %{type: "number", minimum: 0, maximum: 1}
      }
    }
  end
end
