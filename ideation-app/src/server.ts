import express from 'express';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import {
  AUDIO_DIR,
  Rating,
  createSession,
  listSessions,
  loadSession,
  makeIdea,
  saveSession,
} from './store';
import { generateIdeas } from './generate';

const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));
app.use('/audio', express.static(AUDIO_DIR));

const RATINGS: Rating[] = ['love', 'like', 'dislike', 'hate'];

// ---- Sessions ----

app.get('/api/sessions', (_req, res) => {
  res.json(
    listSessions().map((s) => ({
      id: s.id,
      clientName: s.clientName,
      createdAt: s.createdAt,
      generation: s.generation,
      total: s.ideas.length,
      rated: s.ideas.filter((i) => i.rating).length,
    })),
  );
});

// Create a session. Ideas can be imported directly (e.g. output from the
// Oakland ideation skill) via `ideas: [{title, hook?, angle?, format?}]`,
// generated via the /generate endpoint, or both.
app.post('/api/sessions', (req, res) => {
  const { clientName, brief, ideas } = req.body as {
    clientName?: string;
    brief?: string;
    ideas?: Array<{ title: string; hook?: string; angle?: string; format?: string }>;
  };
  if (!clientName?.trim()) return res.status(400).json({ error: 'clientName is required' });

  const session = createSession(clientName.trim(), (brief ?? '').trim());
  if (Array.isArray(ideas)) {
    for (const idea of ideas) {
      if (!idea?.title) continue;
      session.ideas.push(
        makeIdea({
          title: String(idea.title),
          hook: String(idea.hook ?? ''),
          angle: String(idea.angle ?? 'imported'),
          format: String(idea.format ?? ''),
        }),
      );
    }
    saveSession(session);
  }
  res.json(session);
});

app.get('/api/sessions/:id', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  res.json(session);
});

// Kick off background generation; poll GET /api/sessions/:id for progress.
app.post('/api/sessions/:id/generate', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  if (session.generation.status === 'running') {
    return res.status(409).json({ error: 'generation already running' });
  }
  const count = Math.min(Math.max(Number(req.body?.count) || 100, 1), 300);
  const total = session.ideas.length + count;

  void generateIdeas(session.id, total);
  res.json({ ok: true, target: total });
});

// ---- Ratings + reasons (the catalog data) ----

app.post('/api/sessions/:id/ideas/:ideaId/rating', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  const idea = session.ideas.find((i) => i.id === req.params.ideaId);
  if (!idea) return res.status(404).json({ error: 'idea not found' });

  const rating = req.body?.rating as Rating;
  if (!RATINGS.includes(rating)) return res.status(400).json({ error: 'rating must be love|like|dislike|hate' });

  idea.rating = rating;
  idea.ratedAt = new Date().toISOString();
  saveSession(session);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/ideas/:ideaId/reason', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  const idea = session.ideas.find((i) => i.id === req.params.ideaId);
  if (!idea) return res.status(404).json({ error: 'idea not found' });

  const { transcript, inputMethod } = req.body as { transcript?: string; inputMethod?: string };
  const method = ['voice', 'typed', 'skipped'].includes(inputMethod ?? '') ? inputMethod : 'typed';

  idea.reason = {
    transcript: String(transcript ?? '').trim(),
    inputMethod: method as 'voice' | 'typed' | 'skipped',
    audioFile: idea.reason?.audioFile ?? null,
    recordedAt: new Date().toISOString(),
  };
  saveSession(session);
  res.json({ ok: true });
});

// Raw audio body (webm/mp4/etc.) saved alongside the transcript.
app.post(
  '/api/sessions/:id/ideas/:ideaId/audio',
  express.raw({ type: ['audio/*', 'video/*'], limit: '25mb' }),
  (req, res) => {
    const session = loadSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'not found' });
    const idea = session.ideas.find((i) => i.id === req.params.ideaId);
    if (!idea) return res.status(404).json({ error: 'idea not found' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'empty audio body' });
    }

    const mime = req.headers['content-type'] ?? 'audio/webm';
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';
    const filename = `${idea.id}.${ext}`;
    fs.writeFileSync(path.join(AUDIO_DIR, filename), req.body);

    if (idea.reason) {
      idea.reason.audioFile = filename;
    } else {
      idea.reason = { transcript: '', inputMethod: 'voice', audioFile: filename, recordedAt: new Date().toISOString() };
    }
    saveSession(session);
    res.json({ ok: true, audioFile: filename });
  },
);

// ---- Export: the flat catalog the ideation skill will consume ----

app.get('/api/sessions/:id/export', (req, res) => {
  const session = loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });

  res.json({
    client: session.clientName,
    brief: session.brief,
    exportedAt: new Date().toISOString(),
    summary: {
      total: session.ideas.length,
      love: session.ideas.filter((i) => i.rating === 'love').length,
      like: session.ideas.filter((i) => i.rating === 'like').length,
      dislike: session.ideas.filter((i) => i.rating === 'dislike').length,
      hate: session.ideas.filter((i) => i.rating === 'hate').length,
      unrated: session.ideas.filter((i) => !i.rating).length,
    },
    entries: session.ideas.map((i) => ({
      title: i.title,
      hook: i.hook,
      angle: i.angle,
      format: i.format,
      rating: i.rating,
      reason: i.reason?.transcript || null,
      reasonMethod: i.reason?.inputMethod ?? null,
      audioFile: i.reason?.audioFile ?? null,
    })),
  });
});

const PORT = Number(process.env.PORT ?? 4100);
app.listen(PORT, () => {
  console.log(`\nIdeation ranking app → http://localhost:${PORT}\n`);
});
