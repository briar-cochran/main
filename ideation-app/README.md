# Ideation Ranking App

Tinder-style idea ranking for clients. Generate ~100 content ideas for a client,
send them a private link, and they swipe through each one
(**love / like / dislike / hate**). Right after every rating a microphone pops
up asking them to *"explain why in 1–3 sentences"* — voice is dictated live into
text and the raw audio is saved too. The output is a per-client **catalog** of
ideas + ratings + reasons that feeds the Oakline ideation skill's feedback
memory.

## Two modes

- **Admin home (`/`)** — create sessions, see progress, copy client links,
  download exports. Lock it by setting the `ADMIN_KEY` env var (the UI prompts
  for the key once and remembers it).
- **Client link (`/r/<session-id>`)** — what you send the client. Only their
  deck: rank → explain → done. No session list, no exports, no admin controls.
  The unguessable session UUID is the access control.

## Deploying to Vercel

The app is Vercel-ready: static UI from `public/`, one serverless function
(`api/index.ts`) wrapping the Express app, and Turso (libSQL) for storage —
serverless filesystems don't persist, so the local JSON-file backend is
dev-only.

1. Create a Turso database (`turso db create idea-ranker`) and grab its URL +
   auth token.
2. Import the repo in Vercel and set **Root Directory** to `ideation-app`.
3. Env vars:
   - `ANTHROPIC_API_KEY` — idea generation
   - `TURSO_DATABASE_URL` + `TURSO_AUTH_TOKEN` — storage
   - `ADMIN_KEY` — protects the admin home (recommended; client links stay open)
   - `IDEATION_MODEL` — optional model override
4. Deploy. Voice capture requires HTTPS, which Vercel provides by default.

> Generation runs one 10-idea batch per request (`maxDuration: 300` is set in
> `vercel.json`; on the Hobby plan lower it to 60 — a batch typically fits).
> Whichever browser has the session open pumps the next batch, so ranking can
> start while ideas are still generating. If the tab closes mid-generation,
> reopening the link resumes it.

## Local dev

```bash
cd ideation-app
npm install
npm run dev        # http://localhost:4100
```

Without `TURSO_DATABASE_URL` it stores everything in `ideation-app/data/`
(JSON files + audio). Generation needs Claude API credentials
(`ANTHROPIC_API_KEY`, or an `ant auth login` profile); everything else works
without them. Browsers only expose the microphone on `localhost` or HTTPS.

## How idea diversity works ("high temperature")

The `temperature` sampling parameter no longer exists on current Claude models
(the API rejects it), so variety is engineered structurally instead — which in
practice spreads ideas out *conceptually* rather than just rephrasing them:

- Ideas are generated in batches of 10, and **every batch uses a different
  creative lens** (contrarian takes, personal stories, tactical how-tos,
  industry myths, trends, behind-the-scenes, pain points, hot takes,
  frameworks, curiosity gaps) — see `LENSES` in `src/generate.ts`.
- Every batch is shown **all previously generated titles** with a hard
  instruction that new ideas must be conceptually distinct.
- The prompt explicitly asks for a spread including risky/provocative ideas,
  since the whole point is to learn where the client's taste boundaries are.
- Suggested formats follow the Oakline structured-mode taxonomy (yap,
  green-screen reveal, ranking, tier list, bracket, split-screen, mirror-board,
  notes-app reveal, …).

## Oakline ideation-skill integration

The ideation skill (`oakline/04-skills/ideation`) already reads per-client
feedback from `01-clients/{slug}/feedback/ideation-feedback.jsonl`
(SKILL.md, Inputs §3). This app exports that exact format:

- **`GET /api/sessions/:id/export.jsonl`** — one line per rated idea,
  `{at, channel: "idea-ranker", client: <slug>, feedback, id, type}` with
  `type` mapped love/like → `positive`, dislike/hate → `negative`, and the
  client's spoken "why" embedded in `feedback`. Append these lines to the
  client's `ideation-feedback.jsonl` and the next skill run picks them up.
- Sessions carry a **client slug** matching `01-clients/{slug}` so the export
  lands on the right client.
- Skill-generated ideas can be ranked directly: `POST /api/sessions` accepts
  `ideas: [{title, hook?, angle?, format?}]` (e.g. from a delivered
  `deliveries/ideation/{date}-ideas.md` batch) instead of / in addition to
  generating.

The built-in generator is the lightweight stand-in for taste-calibration runs;
the full skill is reference-first (TubeLab/Apify research). To mirror it
exactly, swap the skill's angle taxonomy into `LENSES` / `batchPrompt()` in
`src/generate.ts`.

## Catalog format (JSON export)

```json
{
  "client": "Faiez Rana",
  "clientSlug": "faiez-rana",
  "brief": "...",
  "summary": { "total": 100, "love": 18, "like": 41, "dislike": 27, "hate": 9, "unrated": 5 },
  "entries": [
    {
      "title": "Why quote transparency is HVAC's biggest trust lever",
      "hook": "...",
      "angle": "Contrarian takes",
      "format": "green-screen reveal",
      "rating": "love",
      "reason": "This is exactly the kind of thing my audience argues about in the comments.",
      "reasonMethod": "voice",
      "audioFile": "<idea-id>.webm"
    }
  ]
}
```

## API

| Method | Path | Auth | Purpose |
|---|---|---|---|
| GET | `/api/sessions` | admin | List session summaries |
| POST | `/api/sessions` | admin | Create session (`clientName`, `clientSlug?`, `brief`, `target?`, `ideas?`) |
| GET | `/api/sessions/:id` | link | Full session |
| POST | `/api/sessions/:id/generate` | link | Set/raise the generation target |
| POST | `/api/sessions/:id/generate-batch` | link | Generate one batch (frontend loops until target) |
| POST | `/api/sessions/:id/ideas/:ideaId/rating` | link | `{rating: love\|like\|dislike\|hate}` |
| POST | `/api/sessions/:id/ideas/:ideaId/reason` | link | `{transcript, inputMethod}` |
| POST | `/api/sessions/:id/ideas/:ideaId/audio` | link | Raw audio body → stored blob |
| GET | `/audio/:name` | link | Play back a saved voice memo |
| GET | `/api/sessions/:id/export` | link | Flat catalog JSON |
| GET | `/api/sessions/:id/export.jsonl` | link | Oakline `ideation-feedback.jsonl` lines |

"admin" = requires `x-admin-key` header when `ADMIN_KEY` is set; "link" =
anyone with the session UUID.
