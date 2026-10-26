// Thin typed wrapper over Trystero. Everything network-specific lives here so
// the rest of the game never touches WebRTC or the signaling strategy.
//
// Signaling runs over public Nostr relays (free, no server of ours). Once peers
// connect, game data flows directly peer-to-peer, end-to-end encrypted. The
// room code doubles as the signaling password, so relay operators can't read
// session descriptions for a room without knowing its code.

import { getRelaySockets, joinRoom, selfId, type DataPayload, type MessageAction, type Room } from 'trystero';

import { APP_ID } from './protocol';

export type Handler<T> = (data: T, peerId: string) => void;

/** Optional TURN relay for strict NATs, configured at build time (see README). */
function turnConfig(): RTCIceServer[] | undefined {
  const urls = process.env.NEXT_PUBLIC_TURN_URLS;
  if (!urls) return undefined;
  return [
    {
      urls: urls.split(',').map((u) => u.trim()),
      username: process.env.NEXT_PUBLIC_TURN_USERNAME,
      credential: process.env.NEXT_PUBLIC_TURN_CREDENTIAL,
    },
  ];
}

export class NetRoom {
  readonly selfId = selfId;
  readonly code: string;
  private room: Room;
  private actions = new Map<string, MessageAction<DataPayload>>();
  private closed = false;

  onPeerJoin: ((peerId: string) => void) | null = null;
  onPeerLeave: ((peerId: string) => void) | null = null;
  onError: ((message: string) => void) | null = null;

  constructor(code: string) {
    this.code = code;
    this.room = joinRoom(
      {
        appId: APP_ID,
        password: `ghoul-duel:${code}`,
        turnConfig: turnConfig(),
        relayConfig: { warnOnRelayFailure: false },
      },
      `room-${code}`,
      {
        onJoinError: (details) => {
          const msg = String(details.error ?? 'connection failed');
          console.warn('[net] join error', details);
          this.onError?.(msg);
        },
      },
    );
    this.room.onPeerJoin = (id) => this.onPeerJoin?.(id);
    this.room.onPeerLeave = (id) => this.onPeerLeave?.(id);
  }

  private action(name: string): MessageAction<DataPayload> {
    let a = this.actions.get(name);
    if (!a) {
      a = this.room.makeAction<DataPayload>(name);
      this.actions.set(name, a);
    }
    return a;
  }

  /** Send to one peer, a list of peers, or everyone (target omitted). */
  send<T>(name: string, data: T, target?: string | string[]): void {
    if (this.closed) return;
    this.action(name)
      .send(data as unknown as DataPayload, target ? { target } : undefined)
      .catch((err: unknown) => console.warn(`[net] send ${name} failed`, err));
  }

  on<T>(name: string, handler: Handler<T>): void {
    const a = this.action(name);
    a.onMessage = (data, ctx) => {
      if (!this.closed) handler(data as unknown as T, ctx.peerId);
    };
  }

  peers(): string[] {
    return Object.keys(this.room.getPeers());
  }

  async ping(peerId: string): Promise<number | null> {
    try {
      return await Promise.race([
        this.room.ping(peerId),
        new Promise<null>((r) => setTimeout(() => r(null), 3000)),
      ]);
    } catch {
      return null;
    }
  }

  /** How many signaling relays we're connected to (0 = offline / blocked). */
  relayCount(): number {
    try {
      const sockets = getRelaySockets() as Record<string, WebSocket>;
      return Object.values(sockets).filter((s) => s.readyState === WebSocket.OPEN).length;
    } catch {
      return -1;
    }
  }

  leave(): void {
    if (this.closed) return;
    this.closed = true;
    this.room.onPeerJoin = null;
    this.room.onPeerLeave = null;
    this.room.leave().catch(() => {});
  }
}
