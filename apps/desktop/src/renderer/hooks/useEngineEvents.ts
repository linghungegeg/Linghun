import { useEffect, useReducer } from "react";
import type { EngineEvent } from "../../bridge/events";

type Task = Extract<EngineEvent, { type: "task_update" }>["task"];

export type Message =
  | { kind: "user"; id: string; text: string }
  | { kind: "assistant"; id: string; text: string }
  | { kind: "tool"; id: string; name: string; risk: "low" | "medium" | "high" }
  | { kind: "task"; id: string }
  | { kind: "system"; id: string; text: string };

type State = {
  messages: Message[];
  tasks: Record<string, Task>;
  running: boolean;
  changedFiles: string[];
  sessionId: string | null;
};

const initialState: State = {
  messages: [],
  tasks: {},
  running: false,
  changedFiles: [],
  sessionId: null,
};

function reducer(state: State, ev: EngineEvent): State {
  switch (ev.type) {
    case "session_start":
      return { ...state, sessionId: ev.sessionId };
    case "user_message":
      return {
        ...state,
        running: true,
        messages: [...state.messages, { kind: "user", id: ev.id, text: ev.text }],
      };
    case "assistant_delta": {
      const last = state.messages[state.messages.length - 1];
      if (last?.kind === "assistant" && last.id === ev.id) {
        const updated = [...state.messages];
        updated[updated.length - 1] = { ...last, text: last.text + ev.text };
        return { ...state, messages: updated };
      }
      return {
        ...state,
        messages: [...state.messages, { kind: "assistant", id: ev.id, text: ev.text }],
      };
    }
    case "tool_call":
      return {
        ...state,
        messages: [...state.messages, { kind: "tool", id: ev.id, name: ev.name, risk: ev.risk }],
      };
    case "task_update": {
      const tasks = { ...state.tasks, [ev.task.id]: ev.task };
      // 首次出现的 task 在对话流插入占位行，后续更新原地刷新
      const seen = state.tasks[ev.task.id] !== undefined;
      const messages = seen
        ? state.messages
        : [...state.messages, { kind: "task" as const, id: ev.task.id }];
      return { ...state, tasks, messages };
    }
    case "checkpoint":
      return { ...state, changedFiles: ev.files };
    case "done":
      return { ...state, running: false };
    case "error":
      return {
        ...state,
        running: false,
        messages: [
          ...state.messages,
          { kind: "system", id: `err-${Date.now()}`, text: ev.message },
        ],
      };
    default:
      return state;
  }
}

export function useEngineEvents(): State {
  const [state, dispatch] = useReducer(reducer, initialState);
  useEffect(() => window.linghunBridge.onEngineEvent(dispatch), []);
  return state;
}
