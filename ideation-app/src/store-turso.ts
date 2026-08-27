import { createClient, Client } from '@libsql/client';
import { RankingSession, Store, newSession } from './store';

/**
 * Turso/libSQL backend for Vercel (serverless has no persistent filesystem).
 * Sessions are stored as JSON documents; audio memos as blobs.
 *
 * Env: TURSO_DATABASE_URL, TURSO_AUTH_TOKEN
 */
export class TursoStore implements Store {
  private db: Client;
  private ready: Promise<void>;

  constructor() {
    this.db = createClient({
      url: process.env.TURSO_DATABASE_URL!,
      authToken: process.env.TURSO_AUTH_TOKEN,
    });
    this.ready = this.migrate();
  }

  private async migrate(): Promise<void> {
    await this.db.batch(
      [
        `CREATE TABLE IF NOT EXISTS ranking_sessions (
          id TEXT PRIMARY KEY,
          created_at TEXT NOT NULL,
          data TEXT NOT NULL
        )`,
        `CREATE TABLE IF NOT EXISTS ranking_audio (
          name TEXT PRIMARY KEY,
          mime TEXT NOT NULL,
          data BLOB NOT NULL
        )`,
      ],
      'write',
    );
  }

  async createSession(fields: { clientName: string; clientSlug: string; brief: string }): Promise<RankingSession> {
    const session = newSession(fields);
    await this.saveSession(session);
    return session;
  }

  async loadSession(id: string): Promise<RankingSession | null> {
    await this.ready;
    const rs = await this.db.execute({ sql: 'SELECT data FROM ranking_sessions WHERE id = ?', args: [id] });
    if (rs.rows.length === 0) return null;
    return JSON.parse(rs.rows[0].data as string) as RankingSession;
  }

  async saveSession(session: RankingSession): Promise<void> {
    await this.ready;
    await this.db.execute({
      sql: `INSERT INTO ranking_sessions (id, created_at, data) VALUES (?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET data = excluded.data`,
      args: [session.id, session.createdAt, JSON.stringify(session)],
    });
  }

  async listSessions(): Promise<RankingSession[]> {
    await this.ready;
    const rs = await this.db.execute('SELECT data FROM ranking_sessions ORDER BY created_at DESC');
    return rs.rows.map((r) => JSON.parse(r.data as string) as RankingSession);
  }

  async saveAudio(name: string, data: Buffer, mime: string): Promise<void> {
    await this.ready;
    await this.db.execute({
      sql: `INSERT INTO ranking_audio (name, mime, data) VALUES (?, ?, ?)
            ON CONFLICT(name) DO UPDATE SET mime = excluded.mime, data = excluded.data`,
      args: [name, mime, data],
    });
  }

  async getAudio(name: string): Promise<{ data: Buffer; mime: string } | null> {
    await this.ready;
    const rs = await this.db.execute({ sql: 'SELECT mime, data FROM ranking_audio WHERE name = ?', args: [name] });
    if (rs.rows.length === 0) return null;
    const row = rs.rows[0];
    // libsql may hand BLOBs back as ArrayBuffer or Uint8Array depending on
    // transport; Buffer.from(ArrayBuffer) on a Uint8Array would misread it.
    const raw = row.data as ArrayBuffer | Uint8Array;
    const data = raw instanceof Uint8Array ? Buffer.from(raw.buffer, raw.byteOffset, raw.byteLength) : Buffer.from(raw);
    return { data, mime: row.mime as string };
  }
}
