/**
 * Strongly typed, lightweight EventEmitter with zero external dependencies.
 */

export type EventListener<T extends unknown[]> = (...args: T) => void;

export class TypedEventEmitter<Events extends { [K in keyof Events]: unknown[] }> {
  private readonly listeners = new Map<keyof Events, Set<EventListener<unknown[]>>>();

  on<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void {
    let set = this.listeners.get(event);
    if (!set) {
      set = new Set();
      this.listeners.set(event, set);
    }
    const genericListener = listener as EventListener<unknown[]>;
    set.add(genericListener);

    return () => this.off(event, listener);
  }

  off<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): void {
    const set = this.listeners.get(event);
    if (!set) return;
    set.delete(listener as EventListener<unknown[]>);
    if (set.size === 0) {
      this.listeners.delete(event);
    }
  }

  once<K extends keyof Events>(event: K, listener: EventListener<Events[K]>): () => void {
    const onceWrapper = (...args: Events[K]) => {
      this.off(event, onceWrapper);
      listener(...args);
    };
    return this.on(event, onceWrapper);
  }

  emit<K extends keyof Events>(event: K, ...args: Events[K]): void {
    const set = this.listeners.get(event);
    if (!set || set.size === 0) return;

    const snapshot = Array.from(set);
    for (const listener of snapshot) {
      try {
        listener(...args);
      } catch (err) {
        console.error(`Unhandled error in event listener for "${String(event)}":`, err);
      }
    }
  }

  listenerCount<K extends keyof Events>(event: K): number {
    return this.listeners.get(event)?.size ?? 0;
  }

  removeAllListeners<K extends keyof Events>(event?: K): void {
    if (event !== undefined) {
      this.listeners.delete(event);
    } else {
      this.listeners.clear();
    }
  }
}
