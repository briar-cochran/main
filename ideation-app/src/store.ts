import fs from 'fs';
import path from 'path';
import { randomUUID } from 'crypto';

export type Rating = 'love' | 'like' | 'dislike' | 'hate';

export interface Reason {
  transcript: string;
  inputMethod: 'voice' | 'typed' | 'skipped';
  audioFile: string | null;
  recordedAt: string;
}

export interface Idea {
  id: string;
  title: string;
  hook: string;
  angle: string;
  format: string;
  rating: Rating | null;
  ratedAt: string | null;
  reason: Reason | null;
}

export interface GenerationStatus {
  status: 'idle' | 'running' | 'done' | 'error';
  target: number;
  generated: number;
  error: string | null;
}

export interface RankingSession {
  id: string;
  clientName: string;
  clientSlug: string; // matches oakline 01-clients/{slug}
  brief: string;
  createdAt: string;
  generation: GenerationStatus;
  ideas: Idea[];
}

export interface Store {
  createSession(fields: { clientName: string; clientSlug: string; brief: string }): Promise<RankingSession>;
  loadSession(id: string): Promise<RankingSession | null>;
  saveSession(session: RankingSession): Promise<void>;
  listSessions(): Promise<RankingSession[]>;
  saveAudio(name: string, data: Buffer, mime: string): Promise<void>;
  getAudio(name: string): Promise<{ data: Buffer; mime: string } | null>;
}

export function newSession(fields: { clientName: string; clientSlug: string; brief: string }): RankingSession {
  return {
    id: randomUUID(),
    clientName: fields.clientName,
    clientSlug: fields.clientSlug,
    brief: fields.brief,
    createdAt: new Date().toISOString(),
    generation: { status: 'idle', target: 0, generated: 0, error: null },
    ideas: [],
  };
}

export function makeIdea(fields: { title: string; hook: string; angle: string; format: string }): Idea {
  return {
    id: randomUUID(),
    title: fields.title,
    hook: fields.hook,
    angle: fields.angle,
    format: fields.format,
    rating: null,
    ratedAt: null,
    reason: null,
  };
}

// ---- Local filesystem backend (dev / self-hosted) ----

class FileStore implements Store {
  private sessionsDir: string;
  private audioDir: string;

  constructor(dataDir: string) {
    this.sessionsDir = path.join(dataDir, 'sessions');
    this.audioDir = path.join(dataDir, 'audio');
    fs.mkdirSync(this.sessionsDir, { recursive: true });
    fs.mkdirSync(this.audioDir, { recursive: true });
  }

  private sessionPath(id: string): string {
    if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('invalid session id');
    return path.join(this.sessionsDir, `${id}.json`);
  }

  async createSession(fields: { clientName: string; clientSlug: string; brief: string }): Promise<RankingSession> {
    const session = newSession(fields);
    await this.saveSession(session);
    return session;
  }

  async loadSession(id: string): Promise<RankingSession | null> {
    const file = this.sessionPath(id);
    if (!fs.existsSync(file)) return null;
    return JSON.parse(fs.readFileSync(file, 'utf8')) as RankingSession;
  }

  async saveSession(session: RankingSession): Promise<void> {
    const file = this.sessionPath(session.id);
    fs.writeFileSync(`${file}.tmp`, JSON.stringify(session, null, 2));
    fs.renameSync(`${file}.tmp`, file);
  }

  async listSessions(): Promise<RankingSession[]> {
    return fs
      .readdirSync(this.sessionsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => JSON.parse(fs.readFileSync(path.join(this.sessionsDir, f), 'utf8')) as RankingSession)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async saveAudio(name: string, data: Buffer, mime: string): Promise<void> {
    if (!/^[a-zA-Z0-9.-]+$/.test(name)) throw new Error('invalid audio name');
    fs.writeFileSync(path.join(this.audioDir, name), data);
    fs.writeFileSync(path.join(this.audioDir, `${name}.mime`), mime);
  }

  async getAudio(name: string): Promise<{ data: Buffer; mime: string } | null> {
    if (!/^[a-zA-Z0-9.-]+$/.test(name)) return null;
    const file = path.join(this.audioDir, name);
    if (!fs.existsSync(file)) return null;
    const mimeFile = `${file}.mime`;
    const mime = fs.existsSync(mimeFile) ? fs.readFileSync(mimeFile, 'utf8') : 'audio/webm';
    return { data: fs.readFileSync(file), mime };
  }
}

// ---- Backend selection ----
// TURSO_DATABASE_URL set → Turso/libSQL (Vercel + production).
// Otherwise → local JSON files under ideation-app/data/ (dev).

let store: Store | null = null;

export function getStore(): Store {
  if (store) return store;
  if (process.env.TURSO_DATABASE_URL) {
    // Lazy require so local dev doesn't need the module resolved at import time.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { TursoStore } = require('./store-turso');
    store = new TursoStore() as Store;
  } else {
    store = new FileStore(path.join(__dirname, '..', 'data'));
  }
  return store;
}
