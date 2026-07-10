export const MAX_QUEUED_INPUTS = 20;

export type QueuedInputItem = {
  id: string;
  text: string;
};

export type QueuedInputState = {
  items: QueuedInputItem[];
  nextId: number;
};

export function createQueuedInputState(): QueuedInputState {
  return { items: [], nextId: 1 };
}

export function enqueueQueuedInput(
  state: QueuedInputState,
  text: string,
): { state: QueuedInputState; item?: QueuedInputItem; full: boolean } {
  const normalized = text.trim();
  if (!normalized) return { state, full: false };
  if (state.items.length >= MAX_QUEUED_INPUTS) return { state, full: true };
  const item = { id: `queued-input-${state.nextId}`, text: normalized };
  return {
    state: { items: [...state.items, item], nextId: state.nextId + 1 },
    item,
    full: false,
  };
}

export function shiftQueuedInput(
  state: QueuedInputState,
): { state: QueuedInputState; item?: QueuedInputItem } {
  const [item, ...items] = state.items;
  return { state: { ...state, items }, item };
}

export function takeLatestQueuedInput(
  state: QueuedInputState,
  expectedId?: string,
): { state: QueuedInputState; item?: QueuedInputItem } {
  const item = state.items.at(-1);
  if (!item || (expectedId && item.id !== expectedId)) return { state };
  return { state: { ...state, items: state.items.slice(0, -1) }, item };
}

export class QueuedInputQueue {
  private state = createQueuedInputState();
  private draining = false;

  get items(): QueuedInputItem[] {
    return this.state.items;
  }

  enqueue(text: string): { item?: QueuedInputItem; full: boolean } {
    const result = enqueueQueuedInput(this.state, text);
    this.state = result.state;
    return { item: result.item, full: result.full };
  }

  takeLatest(expectedId?: string): QueuedInputItem | undefined {
    const result = takeLatestQueuedInput(this.state, expectedId);
    this.state = result.state;
    return result.item;
  }

  async drain(
    isBusy: () => boolean,
    dispatch: (item: QueuedInputItem) => Promise<void>,
    onChange: () => void = () => undefined,
  ): Promise<void> {
    if (this.draining || isBusy()) return;
    this.draining = true;
    try {
      while (!isBusy() && this.state.items.length > 0) {
        const next = shiftQueuedInput(this.state);
        this.state = next.state;
        if (!next.item) break;
        onChange();
        try {
          await dispatch(next.item);
        } catch (error) {
          this.state = { ...this.state, items: [next.item, ...this.state.items] };
          onChange();
          throw error;
        }
      }
    } finally {
      this.draining = false;
      onChange();
    }
  }
}
