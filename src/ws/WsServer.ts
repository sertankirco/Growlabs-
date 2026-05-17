import { Server as HttpServer, IncomingMessage } from 'http';
import { Socket } from 'net';
import { buildHandshakeResponse } from './WsFrame';
import { WsConnection } from './WsConnection';
import { ServerMessage, ClientMessage, Channel } from './types';
import { UnifiedContext } from '../context/UnifiedContext';
import { LiveMatchOrchestrator } from '../match/LiveMatchOrchestrator';
import { MatchState } from '../events/types';
import { PgSubscriber } from '../db/PgSubscriber';

// ── WsServer ──────────────────────────────────────────────────────────────────
//
// HTTP sunucusunun 'upgrade' olayını yakalayarak WebSocket bağlantısı kurar.
// Aynı port üzerinde HTTP (REST) ve WS birlikte çalışır.
//
// Kanal sistemi:
//   "market"           — tüm oyuncu fiyat güncellemeleri
//   "match:<matchId>"  — belirli bir maçın eventleri
//   "wallet:<userId>"  — kişisel cüzdan güncellemeleri
//   "leaderboard"      — sıralama değişiklikleri
//
// EventPipeline → WsServer bağlantısı GameContext.pipeline.on(...) üzerinden
// kurulur; bu sayede HTTP handler'lar pipeline'ı doğrudan çağırabilir ve WS
// otomatik olarak tüm aboneleri bildirir.

const HEARTBEAT_INTERVAL = 30_000;   // 30 sn ping döngüsü

export class WsServer {
  private readonly connections = new Map<string, WsConnection>();
  private heartbeatTimer?: ReturnType<typeof setInterval>;

  constructor(private readonly ctx: UnifiedContext) {}

  // ── HTTP sunucusuna bağlan ─────────────────────────────────────────────────

  attach(httpServer: HttpServer): void {
    httpServer.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      this.handleUpgrade(req, socket, head);
    });
    this.startHeartbeat();
  }

  // In-memory modda çağrılır. Pg modunda wirePgSubscriber() tercih edilir.
  wireEventPipeline(): void {
    this.wireMatchEvents(this.ctx.pipeline as any);
  }

  // PgSubscriber üzerinden cross-process fan-out
  wirePgSubscriber(subscriber: PgSubscriber): void {
    subscriber.on('wc2026_events', (data: any) => {
      this.handleMatchEventFanout(data);
    });
  }

  wireOrchestrator(orchestrator: LiveMatchOrchestrator): void {
    orchestrator.on('match_upcoming', ({
      matchId, homeTeam, awayTeam, startsInMs,
    }: { matchId: string; homeTeam: string; awayTeam: string; startsInMs: number }) => {
      // Tüm bağlı istemcilere gönder — abonelik gerektirmez
      for (const conn of this.connections.values()) {
        conn.send({
          type: 'MATCH_UPCOMING', matchId, homeTeam, awayTeam,
          startsInMs, wsChannel: `match:${matchId}`, timestamp: Date.now(),
        });
      }
    });

    orchestrator.on('match_kick_off', ({ matchState }: { matchState: MatchState }) => {
      this.broadcast(`match:${matchState.matchId}`, {
        type: 'MATCH_STATUS', matchId: matchState.matchId, status: 'KICK_OFF',
        homeTeam: matchState.homeTeam, awayTeam: matchState.awayTeam,
        homeScore: matchState.homeScore, awayScore: matchState.awayScore,
        minute: 0, timestamp: Date.now(),
      });
    });

    orchestrator.on('match_half_time', ({ matchState }: { matchState: MatchState }) => {
      this.broadcast(`match:${matchState.matchId}`, {
        type: 'MATCH_STATUS', matchId: matchState.matchId, status: 'HALF_TIME',
        homeTeam: matchState.homeTeam, awayTeam: matchState.awayTeam,
        homeScore: matchState.homeScore, awayScore: matchState.awayScore,
        minute: 45, timestamp: Date.now(),
      });
    });

    orchestrator.on('match_full_time', ({ matchState }: { matchState: MatchState }) => {
      this.broadcast(`match:${matchState.matchId}`, {
        type: 'MATCH_STATUS', matchId: matchState.matchId, status: 'FULL_TIME',
        homeTeam: matchState.homeTeam, awayTeam: matchState.awayTeam,
        homeScore: matchState.homeScore, awayScore: matchState.awayScore,
        minute: 90, timestamp: Date.now(),
      });
      // Maç bitince tüm kullanıcılara güncel leaderboard push et
      this.pushLeaderboard();
    });

    orchestrator.on('match_aborted', ({ matchId }: { matchId: string }) => {
      this.broadcast(`match:${matchId}`, {
        type: 'MATCH_STATUS', matchId, status: 'ABORTED',
        homeTeam: '', awayTeam: '', homeScore: 0, awayScore: 0,
        minute: 0, timestamp: Date.now(),
      });
    });

    // Coin kredisi sonrası leaderboard push — throttle: 2sn'de bir maksimum
    let leaderboardTimer: ReturnType<typeof setTimeout> | null = null;
    orchestrator.on('users_credited', () => {
      if (leaderboardTimer) return;
      leaderboardTimer = setTimeout(() => {
        leaderboardTimer = null;
        this.pushLeaderboard();
      }, 2000);
    });
  }

  private pushLeaderboard(): void {
    this.ctx.wallet.getLeaderboard().then(entries => {
      const top10 = entries.slice(0, 10).map((e, i) => ({
        rank:      i + 1,
        userId:    e.userId,
        available: e.available,
      }));
      this.broadcast('leaderboard', {
        type: 'LEADERBOARD_UPDATE', top10, timestamp: Date.now(),
      });
    }).catch(() => {});
  }

  // ── Bağlantı yönetimi ─────────────────────────────────────────────────────

  getConnectionCount(): number { return this.connections.size; }

  broadcast(channel: Channel, msg: ServerMessage): number {
    let sent = 0;
    for (const conn of this.connections.values()) {
      if (conn.isSubscribed(channel) && conn.send(msg)) sent++;
    }
    return sent;
  }

  broadcastToUser(userId: string, msg: ServerMessage): boolean {
    const channel = `wallet:${userId}`;
    let sent = false;
    for (const conn of this.connections.values()) {
      if (conn.userId === userId || conn.isSubscribed(channel)) {
        if (conn.send(msg)) sent = true;
      }
    }
    return sent;
  }

  // ── Kapatma ───────────────────────────────────────────────────────────────

  close(): void {
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer);
    for (const conn of this.connections.values()) conn.close();
    this.connections.clear();
  }

  // ── HTTP Upgrade handshake ────────────────────────────────────────────────

  private handleUpgrade(req: IncomingMessage, socket: Socket, _head: Buffer): void {
    const key = req.headers['sec-websocket-key'];
    if (!key || req.headers.upgrade?.toLowerCase() !== 'websocket') {
      socket.write('HTTP/1.1 400 Bad Request\r\n\r\n');
      socket.destroy();
      return;
    }

    socket.write(buildHandshakeResponse(key));

    const conn = new WsConnection(
      socket,
      (c, msg)  => this.handleMessage(c, msg),
      (c)       => this.handleDisconnect(c),
    );

    this.connections.set(conn.id, conn);

    conn.send({
      type:         'CONNECTED',
      connectionId: conn.id,
      serverTime:   Date.now(),
      message:      '⚽ World Cup 2026 Exchange — Bağlantı kuruldu',
    });
  }

  // ── İstemci mesajı işleme ─────────────────────────────────────────────────

  private handleMessage(conn: WsConnection, msg: ClientMessage): void {
    switch (msg.type) {
      case 'SUBSCRIBE': {
        conn.subscribe(msg.channel);
        // wallet kanalı için userId'yi bağlantıya kaydet
        if (msg.channel.startsWith('wallet:') && msg.userId) {
          conn.userId = msg.userId;
        }
        conn.send({ type: 'SUBSCRIBED', channel: msg.channel });
        break;
      }
      case 'UNSUBSCRIBE': {
        conn.unsubscribe(msg.channel);
        break;
      }
      case 'PING': {
        conn.send({ type: 'PONG', timestamp: Date.now() });
        break;
      }
    }
  }

  private handleDisconnect(conn: WsConnection): void {
    this.connections.delete(conn.id);
  }

  // ── EventPipeline / PgSubscriber ortak fan-out mantığı ───────────────────────
  //
  // wireMatchEvents(): EventEmitter'a (in-memory pipeline) bağlanır
  // wirePgSubscriber(): PgSubscriber'a (cross-process Pg modu) bağlanır
  // Her iki durumda da handleMatchEventFanout() aynı iş akışını çalıştırır.

  private wireMatchEvents(emitter: { on: Function }): void {
    if (typeof emitter?.on !== 'function') return;
    emitter.on('match_event', (data: any) => this.handleMatchEventFanout(data));
  }

  private handleMatchEventFanout(data: {
    matchId:        string;
    event:          any;
    reward:         any;
    affectedUsers:  string[];
    newMarketPrice: number;
    oldPrice:       number;
    playerName:     string;
  }): void {
    // 1. Maç kanalı
    this.broadcast(`match:${data.matchId}`, {
      type:      'MATCH_EVENT',
      matchId:   data.matchId,
      event:     data.event,
      reward:    data.reward,
      timestamp: Date.now(),
    });

    // 2. Piyasa kanalı
    const pct = data.oldPrice > 0
      ? Math.round(((data.newMarketPrice - data.oldPrice) / data.oldPrice) * 10000) / 100
      : 0;

    this.broadcast('market', {
      type:      'MARKET_UPDATE',
      playerId:  data.event.playerId,
      name:      data.playerName,
      oldPrice:  data.oldPrice,
      newPrice:  data.newMarketPrice,
      changePct: pct,
      trend:     pct > 0.5 ? 'UP' : pct < -0.5 ? 'DOWN' : 'STABLE',
      timestamp: Date.now(),
    });

    // 3. Etkilenen kullanıcılara cüzdan güncellemesi
    for (const userId of (data.affectedUsers ?? [])) {
      Promise.all([
        this.ctx.wallet.getAvailable(userId),
        this.ctx.wallet.getWallet(userId),
      ]).then(([available, snap]) => {
        this.broadcastToUser(userId, {
          type:      'WALLET_UPDATE',
          userId,
          available,
          balance:   snap.balance,
          delta:     data.reward.coins,
          reason:    `${data.event.type}@${data.event.minute}' ${data.event.playerId}`,
          timestamp: Date.now(),
        });
      }).catch(() => { /* kullanıcı yoksa geç */ });
    }
  }

  // ── Heartbeat ─────────────────────────────────────────────────────────────

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      for (const [id, conn] of this.connections) {
        if (!conn.isAlive) { this.connections.delete(id); }
      }
    }, HEARTBEAT_INTERVAL);
    this.heartbeatTimer.unref?.(); // Node.js event loop'u bloke etme
  }
}
