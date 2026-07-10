const CHANNEL = "spicebush-data-updated";

export function notifyDataUpdated(): void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.postMessage({ type: "updated", at: Date.now() });
    channel.close();
  } catch {
    // BroadcastChannel unavailable.
  }
}

export function subscribeDataUpdated(onUpdate: () => void): () => void {
  try {
    const channel = new BroadcastChannel(CHANNEL);
    channel.onmessage = () => onUpdate();
    return () => channel.close();
  } catch {
    return () => undefined;
  }
}
