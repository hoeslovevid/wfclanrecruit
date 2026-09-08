// Delivery, as opposed to storage.
//
// A message is durable the moment store.js writes it; this is only the tap on
// the shoulder that says a new one is there. So it lives entirely in memory,
// like presence.js and ratelimit.js, with the same two caveats: single
// instance, and it resets on restart. A restart costs nothing here - the client
// reconnects and re-reads the thread, which is the same path it takes on first
// load.
//
// Server-Sent Events rather than WebSockets, because the traffic is one-way in
// the direction that matters. Sending a message is an ordinary POST; only
// delivery needs a push. SSE is plain HTTP, so it needs no upgrade handshake to
// survive a proxy, and it reconnects on its own.

// Browsers cap same-origin connections, and a signed-in user with the site open
// in several tabs holds one stream per tab. This is per user rather than global
// so one person cannot starve everyone else.
export const STREAMS_PER_USER = 4;

// Proxies drop a connection that goes quiet. A comment line is ignored by
// EventSource and costs two bytes, so it is cheaper than being disconnected.
export const PING_MS = 25 * 1000;

const byUser = new Map();

export function subscribe(userId, send) {
  if (!userId) return () => {};
  const streams = byUser.get(userId) || new Set();
  // Drop the oldest rather than refusing the newest: the tab in front of the
  // person is the one that should work.
  if (streams.size >= STREAMS_PER_USER) {
    const oldest = streams.values().next().value;
    streams.delete(oldest);
    try {
      oldest.close();
    } catch {
      /* already gone */
    }
  }
  const stream = { send, close: () => {} };
  stream.close = () => {
    const set = byUser.get(userId);
    if (!set) return;
    set.delete(stream);
    if (!set.size) byUser.delete(userId);
  };
  streams.add(stream);
  byUser.set(userId, streams);
  return stream.close;
}

// Never throws: one dead socket must not take down the send that noticed it.
export function publish(userId, event, data) {
  const streams = byUser.get(userId);
  if (!streams) return 0;
  let delivered = 0;
  for (const stream of [...streams]) {
    try {
      stream.send(event, data);
      delivered += 1;
    } catch {
      stream.close();
    }
  }
  return delivered;
}

export function listenerCount(userId) {
  return byUser.get(userId)?.size || 0;
}

export function reset() {
  byUser.clear();
}
