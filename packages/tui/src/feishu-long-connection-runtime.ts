import * as Lark from "@larksuiteoapi/node-sdk";
import {
  feishuBridgeAdapter,
  feishuReceiveMessageToBridgeEvent,
  type FeishuReceiveMessageEvent,
} from "./remote-inbound-bridge-runtime.js";
import type { RemoteInboundMessage } from "./tui-data-types.js";

export type FeishuLongConnectionOptions = {
  appId: string;
  appSecret: string;
  onMessage: (message: RemoteInboundMessage) => Promise<void> | void;
  nowMs?: () => number;
};

export type FeishuLongConnectionHandle = {
  close: () => void;
};

export async function startFeishuLongConnection(
  options: FeishuLongConnectionOptions,
): Promise<FeishuLongConnectionHandle> {
  if (!options.appId) throw new Error("Feishu long connection missing appId");
  if (!options.appSecret) throw new Error("Feishu long connection missing appSecret");
  const wsClient = new Lark.WSClient({
    appId: options.appId,
    appSecret: options.appSecret,
    loggerLevel: Lark.LoggerLevel.error,
  });
  const dispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": async (data: FeishuReceiveMessageEvent) => {
      const event = feishuReceiveMessageToBridgeEvent(data, options.nowMs?.() ?? Date.now());
      await options.onMessage(feishuBridgeAdapter(event));
    },
  });
  await wsClient.start({ eventDispatcher: dispatcher });
  return {
    close: () => wsClient.close({ force: true }),
  };
}
