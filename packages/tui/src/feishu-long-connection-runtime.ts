import * as Lark from "@larksuiteoapi/node-sdk";
import {
  type FeishuReceiveMessageEvent,
  feishuBridgeAdapter,
  feishuReceiveMessageToBridgeEvent,
} from "./remote-inbound-bridge-runtime.js";
import type { RemoteInboundMessage } from "./tui-data-types.js";

export type FeishuLongConnectionOptions = {
  appId: string;
  appSecret: string;
  onMessage: (message: RemoteInboundMessage) => Promise<void> | void;
  nowMs?: () => number;
};

export type FeishuLongConnectionHandle = {
  close: () => Promise<void>;
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
  const onMessage = async (data: FeishuReceiveMessageEvent) => {
    const event = feishuReceiveMessageToBridgeEvent(data, options.nowMs?.() ?? Date.now());
    await options.onMessage(feishuBridgeAdapter(event));
  };
  const dispatcher = new Lark.EventDispatcher({}).register({
    "im.message.receive_v1": onMessage,
  } as Record<string, (data: unknown) => Promise<void>>);
  await wsClient.start({ eventDispatcher: dispatcher });
  let closed = false;
  let closePromise: Promise<void> | undefined;
  return {
    close: async () => {
      if (closed) {
        await closePromise;
        return;
      }
      closed = true;
      dispatcher.handles.delete("im.message.receive_v1");
      try {
        wsClient.close({ force: true });
        closePromise = Promise.resolve();
      } catch (error) {
        closePromise = Promise.reject(error);
        throw error;
      }
      await closePromise;
    },
  };
}
