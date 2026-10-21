// AU10 CP1：消息渲染身份只取稳定来源（turn/client id；index 仅作最后兜底）。
// 不包含运行期才绑定的 agentRunId —— 否则 ack/恢复绑定一次就会换 key、整条消息 remount。
export interface MessageRenderIdentity {
  role: string;
  turnId?: string | null;
  clientMessageId?: string;
  turnResult?: { turn_id?: string | null } | null;
}

export function messageRenderKey(message: MessageRenderIdentity, index: number): string {
  const identity =
    message.clientMessageId ?? message.turnId ?? message.turnResult?.turn_id ?? String(index);
  return `${message.role}:${identity}`;
}
