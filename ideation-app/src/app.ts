import express from 'express';
import cors from 'cors';
import path from 'path';
import { Rating, getStore, makeIdea } from './store';
import { BATCH_SIZE, generateBatch } from './generate';

export const app = express();
app.use(cors());
app.use(express.json({ limit: '5mb' }));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Client-specific capability URL — one session, no list, no admin controls.
app.get('/r/:id', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const RATINGS: Rating[] = ['love', 'like', 'dislike', 'hate'];
const MAX_IDEAS = 300;

// ---- Admin gate ----
// Set ADMIN_KEY in the environment to lock session listing/creation (the
// admin home). Per-session endpoints stay open: the unguessable session UUID
// in the /r/<id> link is the client's capability.
function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  const key = process.env.ADMIN_KEY;
  if (!key) return next();
  if (req.headers['x-admin-key'] === key) return next();
  res.status(401).json({ error: 'admin key required' });
}

// ---- Sessions ----

app.get('/api/sessions', requireAdmin, async (_req, res) => {
  const sessions = await getStore().listSessions();
  res.json(
    sessions.map((s) => ({
      id: s.id,
      clientName: s.clientName,
      clientSlug: s.clientSlug,
      createdAt: s.createdAt,
      generation: s.generation,
      total: s.ideas.length,
      rated: s.ideas.filter((i) => i.rating).length,
    })),
  );
});

// Create a session. Ideas can be imported directly (e.g. output from the
// Oakline ideation skill) via `ideas: [{title, hook?, angle?, format?}]`,
// generated via the /generate endpoints, or both.
app.post('/api/sessions', requireAdmin, async (req, res) => {
  const { clientName, clientSlug, brief, ideas, target } = req.body as {
    clientName?: string;
    clientSlug?: string;
    brief?: string;
    target?: number;
    ideas?: Array<{ title: string; hook?: string; angle?: string; format?: string }>;
  };
  if (!clientName?.trim()) return res.status(400).json({ error: 'clientName is required' });

  const store = getStore();
  const session = await store.createSession({
    clientName: clientName.trim(),
    clientSlug: (clientSlug ?? '').trim().toLowerCase().replace(/\s+/g, '-'),
    brief: (brief ?? '').trim(),
  });
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
  }
  if (target) {
    const t = Math.min(Math.max(Number(target), 1), MAX_IDEAS);
    session.generation = { status: 'running', target: t, generated: session.ideas.length, error: null };
  }
  await store.saveSession(session);
  res.json(session);
});

app.get('/api/sessions/:id', async (req, res) => {
  const session = await getStore().loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  res.json(session);
});

// Set (or raise) the generation target. Actual generation happens one batch
// at a time via /generate-batch, driven by whichever browser has the session
// open — this keeps every request inside serverless execution limits.
app.post('/api/sessions/:id/generate', async (req, res) => {
  const store = getStore();
  const session = await store.loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  const count = Math.min(Math.max(Number(req.body?.count) || 100, 1), MAX_IDEAS);
  const target = Math.min(session.ideas.length + count, MAX_IDEAS);
  session.generation = { status: 'running', target, generated: session.ideas.length, error: null };
  await store.saveSession(session);
  res.json({ ok: true, target });
});

// Generate one batch synchronously. Returns the new ideas + progress; the
// frontend keeps calling until generated >= target.
app.post('/api/sessions/:id/generate-batch', async (req, res) => {
  const store = getStore();
  const session = await store.loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });

  const remaining = session.generation.target - session.ideas.length;
  if (session.generation.status !== 'running' || remaining <= 0) {
    if (session.generation.status === 'running') {
      session.generation.status = 'done';
      await store.saveSession(session);
    }
    return res.json({ done: true, generation: session.generation, newIdeas: [] });
  }

  try {
    const count = Math.min(BATCH_SIZE, remaining);
    const newIdeas = await generateBatch(session, count);

    // Re-load before saving so ratings posted while the batch generated
    // aren't clobbered by our stale copy.
    const fresh = (await store.loadSession(req.params.id))!;
    fresh.ideas.push(...newIdeas);
    const done = fresh.ideas.length >= fresh.generation.target;
    fresh.generation = {
      status: done ? 'done' : 'running',
      target: fresh.generation.target,
      generated: fresh.ideas.length,
      error: null,
    };
    await store.saveSession(fresh);
    res.json({ done, generation: fresh.generation, newIdeas });
  } catch (err) {
    session.generation.status = 'error';
    session.generation.error = (err as Error).message;
    await store.saveSession(session);
    res.status(500).json({ error: (err as Error).message });
  }
});

// ---- Ratings + reasons (the catalog data) ----

app.post('/api/sessions/:id/ideas/:ideaId/rating', async (req, res) => {
  const store = getStore();
  const session = await store.loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  const idea = session.ideas.find((i) => i.id === req.params.ideaId);
  if (!idea) return res.status(404).json({ error: 'idea not found' });

  const rating = req.body?.rating as Rating;
  if (!RATINGS.includes(rating)) return res.status(400).json({ error: 'rating must be love|like|dislike|hate' });

  idea.rating = rating;
  idea.ratedAt = new Date().toISOString();
  await store.saveSession(session);
  res.json({ ok: true });
});

app.post('/api/sessions/:id/ideas/:ideaId/reason', async (req, res) => {
  const store = getStore();
  const session = await store.loadSession(req.params.id);
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
  await store.saveSession(session);
  res.json({ ok: true });
});

// Raw audio body (webm/mp4/etc.) saved alongside the transcript.
app.post(
  '/api/sessions/:id/ideas/:ideaId/audio',
  express.raw({ type: ['audio/*', 'video/*'], limit: '25mb' }),
  async (req, res) => {
    const store = getStore();
    const session = await store.loadSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'not found' });
    const idea = session.ideas.find((i) => i.id === req.params.ideaId);
    if (!idea) return res.status(404).json({ error: 'idea not found' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'empty audio body' });
    }

    const mime = String(req.headers['content-type'] ?? 'audio/webm');
    const ext = mime.includes('mp4') ? 'mp4' : mime.includes('ogg') ? 'ogg' : 'webm';
    const filename = `${idea.id}.${ext}`;
    await store.saveAudio(filename, req.body, mime);

    if (idea.reason) {
      idea.reason.audioFile = filename;
    } else {
      idea.reason = { transcript: '', inputMethod: 'voice', audioFile: filename, recordedAt: new Date().toISOString() };
    }
    await store.saveSession(session);
    res.json({ ok: true, audioFile: filename });
  },
);

app.get('/audio/:name', async (req, res) => {
  const audio = await getStore().getAudio(req.params.name);
  if (!audio) return res.status(404).end();
  res.setHeader('Content-Type', audio.mime);
  res.send(audio.data);
});

// ---- Exports: the catalog the ideation skill consumes ----

app.get('/api/sessions/:id/export', async (req, res) => {
  const session = await getStore().loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });

  res.json({
    client: session.clientName,
    clientSlug: session.clientSlug,
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

// Manual JSONL download, shaped like the ideation skill's feedback-memory
// entries so the data won't need reshaping if we later decide to integrate.
// Deliberately NOT wired to the oakline vault — the app never writes there;
// this catalog stays isolated until integration is decided.
app.get('/api/sessions/:id/export.jsonl', async (req, res) => {
  const session = await getStore().loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });

  const clientSlug = session.clientSlug || session.clientName.toLowerCase().replace(/\s+/g, '-');
  const lines = session.ideas
    .filter((i) => i.rating)
    .map((i) => {
      const verdict: string = i.rating === 'love' || i.rating === 'like' ? 'positive' : 'negative';
      const reason = i.reason?.transcript ? ` Client's why: ${i.reason.transcript}` : '';
      return JSON.stringify({
        at: i.ratedAt,
        channel: 'idea-ranker',
        client: clientSlug,
        feedback: `[idea-ranker ${i.rating!.toUpperCase()}] "${i.title}" (angle: ${i.angle}${i.format ? `, format: ${i.format}` : ''}).${reason}`,
        id: i.id.replace(/-/g, '').slice(0, 16),
        type: verdict,
      });
    });

  res.setHeader('Content-Type', 'application/x-ndjson');
  res.setHeader(
    'Content-Disposition',
    `attachment; filename="${clientSlug}-ideation-feedback.jsonl"`,
  );
  res.send(lines.join('\n') + (lines.length ? '\n' : ''));
});
