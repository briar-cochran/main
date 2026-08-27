import express from 'express';
import path from 'path';
import { timingSafeEqual } from 'crypto';
import { Rating, getStore, makeIdea } from './store';
import { BATCH_SIZE, generateBatch } from './generate';

export const app = express();
app.use(express.json({ limit: '5mb' }));

const PUBLIC_DIR = path.join(__dirname, '..', 'public');
app.use(express.static(PUBLIC_DIR));

// Client-specific capability URL — one session, no list, no admin controls.
app.get('/r/:id', (_req, res) => res.sendFile(path.join(PUBLIC_DIR, 'index.html')));

const RATINGS: Rating[] = ['love', 'like', 'dislike', 'hate'];
const MAX_IDEAS = 300;
// A generate-batch claim older than this is considered dead (crashed/timed-out
// invocation) and another tab may pick the work up.
const BATCH_CLAIM_MS = 120_000;

// Express 4 does not forward async handler rejections; without this wrapper a
// thrown store/API error hangs the request (and crashes the local process).
// Named route params are always plain strings in this app's routes; the cast
// narrows @types/express's string | string[] wildcard-param fallback.
type Handler = (req: express.Request<Record<string, string>>, res: express.Response) => Promise<unknown>;
const wrap = (fn: Handler): express.RequestHandler => (req, res, next) => {
  fn(req as express.Request<Record<string, string>>, res).catch(next);
};

// ---- Admin gate ----
// Set ADMIN_KEY in the environment to lock the admin surface: session
// listing/creation, raising generation targets, and exports. The key is
// accepted as an x-admin-key header or a ?key= query param (the export
// download links can't send headers). Per-idea endpoints stay open: the
// unguessable session UUID in the /r/<id> link is the client's capability.
function suppliedKey(req: express.Request): string {
  const header = req.headers['x-admin-key'];
  if (typeof header === 'string') return header;
  const query = req.query.key;
  return typeof query === 'string' ? query : '';
}

function isAdmin(req: express.Request): boolean {
  const key = process.env.ADMIN_KEY;
  if (!key) return true;
  const provided = Buffer.from(suppliedKey(req));
  const expected = Buffer.from(key);
  return provided.length === expected.length && timingSafeEqual(provided, expected);
}

function requireAdmin(req: express.Request, res: express.Response, next: express.NextFunction) {
  if (isAdmin(req)) return next();
  res.status(401).json({ error: 'admin key required' });
}

// ---- Sessions ----

app.get('/api/sessions', requireAdmin, wrap(async (_req, res) => {
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
}));

// Create a session. Ideas can be imported directly (e.g. output from the
// Oakline ideation skill) via `ideas: [{title, hook?, angle?, format?}]`,
// generated via the /generate endpoints, or both.
app.post('/api/sessions', requireAdmin, wrap(async (req, res) => {
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
}));

// The session as the ranking UI needs it. The internal brief is deliberately
// omitted — it's agency-written context, retrievable via the admin-gated
// export, and the link holder doesn't need it to rank.
app.get('/api/sessions/:id', wrap(async (req, res) => {
  const session = await getStore().loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  res.setHeader('Cache-Control', 'no-store');
  res.json({ ...session, brief: undefined });
}));

// Set (or raise) the generation target. Admin-only: the client link must not
// be a spend capability. Actual generation happens one batch at a time via
// /generate-batch, driven by whichever browser has the session open — this
// keeps every request inside serverless execution limits.
app.post('/api/sessions/:id/generate', requireAdmin, wrap(async (req, res) => {
  const store = getStore();
  const session = await store.loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });
  const count = Math.min(Math.max(Number(req.body?.count) || 100, 1), MAX_IDEAS);
  const target = Math.min(session.ideas.length + count, MAX_IDEAS);
  session.generation = { ...session.generation, status: 'running', target, generated: session.ideas.length, error: null };
  await store.saveSession(session);
  res.json({ ok: true, target });
}));

// Generate one batch synchronously. Returns the new ideas + progress; the
// frontend keeps calling until generated >= target. An 'error' status is
// resumable: calling again retries (that's the frontend's retry button).
app.post('/api/sessions/:id/generate-batch', wrap(async (req, res) => {
  const store = getStore();
  const session = await store.loadSession(req.params.id);
  if (!session) return res.status(404).json({ error: 'not found' });

  const remaining = session.generation.target - session.ideas.length;
  const resumable = session.generation.status === 'running' || session.generation.status === 'error';
  if (!resumable || remaining <= 0) {
    if (session.generation.status === 'running') {
      session.generation.status = 'done';
      session.generation.inFlightAt = null;
      await store.saveSession(session);
    }
    return res.json({ done: true, generation: session.generation, newIdeas: [] });
  }

  // Cheap in-flight claim so two open tabs (admin + client link) don't both
  // pay for the same batch. Not a lock — just shrinks the double-spend window
  // from the whole batch duration to the claim write.
  const now = Date.now();
  if (session.generation.inFlightAt && now - session.generation.inFlightAt < BATCH_CLAIM_MS) {
    return res.json({ busy: true, generation: session.generation, newIdeas: [] });
  }
  session.generation.status = 'running';
  session.generation.inFlightAt = now;
  await store.saveSession(session);

  try {
    const count = Math.min(BATCH_SIZE, remaining);
    const newIdeas = await generateBatch(session, count);

    // Re-load before saving so ratings posted while the batch generated
    // aren't clobbered by our stale copy.
    const fresh = (await store.loadSession(req.params.id)) ?? session;
    fresh.ideas.push(...newIdeas);
    const done = fresh.ideas.length >= fresh.generation.target;
    fresh.generation = {
      status: done ? 'done' : 'running',
      target: fresh.generation.target,
      generated: fresh.ideas.length,
      error: null,
      batches: (fresh.generation.batches ?? Math.floor(session.ideas.length / BATCH_SIZE)) + 1,
      inFlightAt: null,
    };
    await store.saveSession(fresh);
    res.json({ done, generation: fresh.generation, newIdeas });
  } catch (err) {
    // Re-load here too: saving the pre-batch snapshot would silently revert
    // every rating/reason the client recorded while the batch was generating.
    const fresh = (await store.loadSession(req.params.id).catch(() => null)) ?? session;
    fresh.generation = {
      ...fresh.generation,
      status: 'error',
      error: (err as Error).message,
      inFlightAt: null,
    };
    await store.saveSession(fresh);
    res.status(500).json({ error: (err as Error).message });
  }
}));

// ---- Ratings + reasons (the catalog data) ----

app.post('/api/sessions/:id/ideas/:ideaId/rating', wrap(async (req, res) => {
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
}));

app.post('/api/sessions/:id/ideas/:ideaId/reason', wrap(async (req, res) => {
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
}));

// Raw audio body (webm/mp4/ogg) saved alongside the transcript. The limit is
// 4mb because Vercel rejects serverless request bodies above ~4.5MB anyway —
// a 25mb limit here would be a lie in production. The frontend records
// speech-only memos (~24kbps opus), so 4mb ≈ over 20 minutes of audio.
app.post(
  '/api/sessions/:id/ideas/:ideaId/audio',
  express.raw({ type: ['audio/*', 'video/*'], limit: '4mb' }),
  wrap(async (req, res) => {
    const store = getStore();
    const session = await store.loadSession(req.params.id);
    if (!session) return res.status(404).json({ error: 'not found' });
    const idea = session.ideas.find((i) => i.id === req.params.ideaId);
    if (!idea) return res.status(404).json({ error: 'idea not found' });
    if (!Buffer.isBuffer(req.body) || req.body.length === 0) {
      return res.status(400).json({ error: 'empty audio body' });
    }

    // Normalize to the three formats MediaRecorder actually produces; the
    // stored mime is echoed back on playback, so never store it verbatim.
    const rawMime = String(req.headers['content-type'] ?? '');
    const mime = rawMime.includes('mp4') ? 'audio/mp4' : rawMime.includes('ogg') ? 'audio/ogg' : 'audio/webm';
    const ext = mime.split('/')[1];
    const filename = `${idea.id}.${ext}`;
    await store.saveAudio(filename, req.body, mime);

    if (idea.reason) {
      idea.reason.audioFile = filename;
    } else {
      idea.reason = { transcript: '', inputMethod: 'voice', audioFile: filename, recordedAt: new Date().toISOString() };
    }
    await store.saveSession(session);
    res.json({ ok: true, audioFile: filename });
  }),
);

app.get('/audio/:name', wrap(async (req, res) => {
  const audio = await getStore().getAudio(req.params.name);
  if (!audio) return res.status(404).end();
  res.setHeader('Content-Type', audio.mime);
  res.setHeader('Cache-Control', 'no-store');
  res.send(audio.data);
}));

// ---- Exports: the catalog the ideation skill consumes ----
// Admin-gated: the client link is for ranking, not for pulling the catalog
// (which includes the internal brief).

app.get('/api/sessions/:id/export', requireAdmin, wrap(async (req, res) => {
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
}));

// Manual JSONL download, shaped like the ideation skill's feedback-memory
// entries so the data won't need reshaping if we later decide to integrate.
// Deliberately NOT wired to the oakline vault — the app never writes there;
// this catalog stays isolated until integration is decided.
app.get('/api/sessions/:id/export.jsonl', requireAdmin, wrap(async (req, res) => {
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
}));

// Errors forwarded by wrap() land here as clean JSON 500s instead of hanging
// the request or killing the process.
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error(err);
  if (!res.headersSent) res.status(500).json({ error: err.message || 'internal error' });
});
