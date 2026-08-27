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
  brief: string;
  createdAt: string;
  generation: GenerationStatus;
  ideas: Idea[];
}

const DATA_DIR = path.join(__dirname, '..', 'data');
const SESSIONS_DIR = path.join(DATA_DIR, 'sessions');
export const AUDIO_DIR = path.join(DATA_DIR, 'audio');

for (const dir of [DATA_DIR, SESSIONS_DIR, AUDIO_DIR]) {
  fs.mkdirSync(dir, { recursive: true });
}

function sessionPath(id: string): string {
  // ids are UUIDs we generate; the check guards against path traversal anyway
  if (!/^[a-zA-Z0-9-]+$/.test(id)) throw new Error('invalid session id');
  return path.join(SESSIONS_DIR, `${id}.json`);
}

export function createSession(clientName: string, brief: string): RankingSession {
  const session: RankingSession = {
    id: randomUUID(),
    clientName,
    brief,
    createdAt: new Date().toISOString(),
    generation: { status: 'idle', target: 0, generated: 0, error: null },
    ideas: [],
  };
  saveSession(session);
  return session;
}

export function loadSession(id: string): RankingSession | null {
  const file = sessionPath(id);
  if (!fs.existsSync(file)) return null;
  return JSON.parse(fs.readFileSync(file, 'utf8')) as RankingSession;
}

export function saveSession(session: RankingSession): void {
  const file = sessionPath(session.id);
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(session, null, 2));
  fs.renameSync(tmp, file);
}

export function listSessions(): RankingSession[] {
  return fs
    .readdirSync(SESSIONS_DIR)
    .filter((f) => f.endsWith('.json'))
    .map((f) => JSON.parse(fs.readFileSync(path.join(SESSIONS_DIR, f), 'utf8')) as RankingSession)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
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
