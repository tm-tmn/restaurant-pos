import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { InjectDataSource } from '@nestjs/typeorm';
import { OnGatewayConnection, WebSocketGateway, WebSocketServer } from '@nestjs/websockets';
import { Client } from 'pg';
import type { Server, Socket } from 'socket.io';
import { DataSource } from 'typeorm';
import { resolveUser } from '../auth/auth.guard';
import { corsOrigins } from '../common/cors';

export type Topic = 'orders' | 'kitchen' | 'queue';
const TOPICS = new Set<Topic>(['orders', 'kitchen', 'queue']);
const UUID = /^[0-9a-f-]{36}$/i;

/**
 * ช่องทาง real-time ของพนักงาน (WebSocket ที่ /socket.io)
 *  - ต่อด้วยโทเค็นเดียวกับ API (handshake auth.token) แล้วเข้าห้องของสาขาตัวเอง
 *  - ส่งแค่สัญญาณ "หัวข้อนี้เปลี่ยน" ไม่ส่งข้อมูลจริง หน้าจอดึงข้อมูลใหม่ผ่าน REST ที่ตรวจสิทธิ์/RLS ตามปกติ
 *    → ต่อให้เซสชันถูกเพิกถอนระหว่างทาง ก็ไม่ได้ข้อมูลอะไรเพิ่ม
 */
// อ่าน CORS_ORIGINS ตอนมีคำขอ (decorator ถูกประเมินก่อนโหลด .env)
@WebSocketGateway({
  cors: { origin: (origin: string | undefined, cb: (err: Error | null, ok?: boolean) => void) => cb(null, !origin || corsOrigins().includes(origin)) },
  serveClient: false,
})
export class RealtimeGateway implements OnGatewayConnection {
  @WebSocketServer() server: Server;
  private readonly log = new Logger('Realtime');

  constructor(
    private readonly jwt: JwtService,
    @InjectDataSource() private readonly ds: DataSource,
  ) {}

  async handleConnection(socket: Socket) {
    try {
      const token = typeof socket.handshake.auth?.token === 'string' ? socket.handshake.auth.token : undefined;
      const user = await resolveUser(this.jwt, this.ds, token);
      await socket.join(`b:${user.branchId}`);
      socket.emit('ready', { branchId: user.branchId });
    } catch {
      socket.emit('auth_error');
      socket.disconnect(true);
    }
  }

  /** แจ้งเครื่องทุกเครื่องของสาขา */
  publish(branchId: string, topics: Topic[]) {
    this.server?.to(`b:${branchId}`).emit('changed', { topics });
  }

  get connections() {
    return this.server?.engine?.clientsCount ?? 0;
  }

  warn(msg: string) {
    this.log.warn(msg);
  }
}

/**
 * ฟัง NOTIFY ช่อง pos_events จาก PostgreSQL (ส่งโดย trigger เมื่อ commit) แล้วกระจายผ่าน gateway
 * รวมสัญญาณของสาขาเดียวกันที่มาติดกันภายใน 100ms เป็นครั้งเดียว (ลดการโหลดซ้ำตอนแก้หลายรายการ)
 * ต้องต่อฐานข้อมูลแบบ session (ตรง หรือ pooler แบบ session) — pooler แบบ transaction ไม่รองรับ LISTEN
 */
@Injectable()
export class RealtimeListener implements OnModuleInit, OnModuleDestroy {
  private client: Client | null = null;
  private stopped = false;
  private retryMs = 1000;
  private readonly pending = new Map<string, Set<Topic>>();
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly log = new Logger('RealtimeListener');

  constructor(private readonly gateway: RealtimeGateway) {}

  onModuleInit() {
    void this.connect();
  }

  async onModuleDestroy() {
    this.stopped = true;
    if (this.flushTimer) clearTimeout(this.flushTimer);
    await this.client?.end().catch(() => undefined);
  }

  private async connect() {
    if (this.stopped) return;
    const client = new Client({ connectionString: process.env.DATABASE_URL });
    client.on('notification', (msg) => this.onNotify(msg.payload));
    client.on('error', (e) => this.reconnect(client, e));
    client.on('end', () => this.reconnect(client));
    try {
      await client.connect();
      await client.query('LISTEN pos_events');
      this.client = client;
      this.retryMs = 1000;
      this.log.log('ฟังการเปลี่ยนแปลงจากฐานข้อมูลแล้ว (pos_events)');
    } catch (e) {
      this.reconnect(client, e as Error);
    }
  }

  private reconnect(client: Client, err?: Error) {
    if (this.stopped || (this.client && this.client !== client)) return;
    this.client = null;
    client.removeAllListeners();
    void client.end().catch(() => undefined);
    this.log.warn(`หลุดจากช่องแจ้งเตือน${err ? `: ${err.message}` : ''} — ต่อใหม่ใน ${this.retryMs / 1000} วินาที (ระหว่างนี้หน้าจอยังโหลดเองเป็นระยะ)`);
    setTimeout(() => void this.connect(), this.retryMs);
    this.retryMs = Math.min(this.retryMs * 2, 30_000);
  }

  private onNotify(payload: string | undefined) {
    if (!payload) return;
    let msg: { b?: unknown; t?: unknown };
    try {
      msg = JSON.parse(payload);
    } catch {
      return;
    }
    if (typeof msg.b !== 'string' || !UUID.test(msg.b) || typeof msg.t !== 'string') return;
    const set = this.pending.get(msg.b) ?? new Set<Topic>();
    for (const t of msg.t.split(',')) if (TOPICS.has(t as Topic)) set.add(t as Topic);
    if (set.size === 0) return;
    this.pending.set(msg.b, set);
    this.flushTimer ??= setTimeout(() => this.flush(), 100);
  }

  private flush() {
    this.flushTimer = null;
    for (const [branchId, topics] of this.pending) this.gateway.publish(branchId, [...topics]);
    this.pending.clear();
  }
}
