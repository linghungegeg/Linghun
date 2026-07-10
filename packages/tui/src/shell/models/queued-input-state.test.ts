import { describe, expect, it } from "vitest";
import {
  createQueuedInputState,
  enqueueQueuedInput,
  MAX_QUEUED_INPUTS,
  QueuedInputQueue,
  shiftQueuedInput,
  takeLatestQueuedInput,
} from "./queued-input-state.js";

describe("queued input state", () => {
  it("queues normalized inputs and drains them in order", () => {
    const first = enqueueQueuedInput(createQueuedInputState(), " first ");
    const second = enqueueQueuedInput(first.state, "second");
    const shifted = shiftQueuedInput(second.state);

    expect(shifted.item).toMatchObject({ text: "first" });
    expect(shiftQueuedInput(shifted.state).item).toMatchObject({ text: "second" });
  });

  it("takes only the expected latest input for editing", () => {
    const first = enqueueQueuedInput(createQueuedInputState(), "first");
    const second = enqueueQueuedInput(first.state, "second");

    expect(takeLatestQueuedInput(second.state, first.item?.id)).toEqual({ state: second.state });
    expect(takeLatestQueuedInput(second.state, second.item?.id)).toMatchObject({
      state: { items: [{ text: "first" }] },
      item: { text: "second" },
    });
  });

  it("rejects blank and over-capacity inputs without changing state", () => {
    let state = createQueuedInputState();
    expect(enqueueQueuedInput(state, "   ")).toEqual({ state, full: false });
    for (let index = 0; index < MAX_QUEUED_INPUTS; index += 1) {
      state = enqueueQueuedInput(state, `message ${index}`).state;
    }

    expect(enqueueQueuedInput(state, "overflow")).toEqual({ state, full: true });
  });

  it("drains automatically in order and includes inputs queued during dispatch", async () => {
    const queue = new QueuedInputQueue();
    const dispatched: string[] = [];
    queue.enqueue("first");
    queue.enqueue("second");

    await queue.drain(
      () => false,
      async (item) => {
        dispatched.push(item.text);
        if (item.text === "first") queue.enqueue("third");
      },
    );

    expect(dispatched).toEqual(["first", "second", "third"]);
    expect(queue.items).toEqual([]);
  });

  it("keeps queued inputs untouched while work is busy", async () => {
    const queue = new QueuedInputQueue();
    queue.enqueue("wait");

    await queue.drain(
      () => true,
      async () => {
        throw new Error("must not dispatch");
      },
    );

    expect(queue.items).toHaveLength(1);
  });

  it("restores the current input when dispatch fails", async () => {
    const queue = new QueuedInputQueue();
    queue.enqueue("retry me");

    await expect(
      queue.drain(
        () => false,
        async () => {
          throw new Error("dispatch failed");
        },
      ),
    ).rejects.toThrow("dispatch failed");
    expect(queue.items.map((item) => item.text)).toEqual(["retry me"]);
  });
});
