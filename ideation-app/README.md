# Ideation Ranking App

Tinder-style idea ranking for clients. Generate ~100 content ideas for a client,
have them swipe through each one (**love / like / dislike / hate**), and right
after every rating a microphone pops up asking them to *"explain why in 1–3
sentences"*. Voice is dictated live into text and the raw audio is saved too.
The output is a per-client **catalog** of ideas + ratings + reasons that the
ideation skill can later be tuned against.

## Run it

```bash
cd ideation-app
npm install
npm run dev        # http://localhost:4100
```

Idea generation calls the Claude API, so credentials must be available
(`ANTHROPIC_API_KEY`, or an `ant auth login` profile). Everything else —
ranking, voice capture, export — works without a key.

> Voice notes: live dictation uses the Web Speech API (Chrome and Safari;
> other browsers fall back to typing, and the audio recording still saves).
> Browsers only expose the microphone on `localhost` or HTTPS.

## Flow

1. **New session** — enter the client's name and a brief (niche, audience,
   goals, voice). The richer the brief, the better the ideas.
2. **Generate** — ideas stream in in batches of 10 while the client can already
   start ranking; no waiting for all 100.
3. **Rank** — swipe (right = love, up = like, down = dislike, left = hate),
   tap the buttons, or use keys 1–4.
4. **Explain** — after each rating the mic overlay opens, records, and dictates
   into an editable text box. Save & next, or skip.
5. **Export** — when done (or any time), `GET /api/sessions/:id/export` returns
   the flat catalog JSON.

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

## Wiring in the Oakland ideation skill

The Oakland repo wasn't accessible from this session, so generation currently
uses the built-in lens prompts above. Two integration paths, both already
supported:

1. **Import ideas** the skill generated elsewhere:
   `POST /api/sessions` with
   `{"clientName": "...", "brief": "...", "ideas": [{"title": "...", "hook": "...", "angle": "...", "format": "..."}]}`.
2. **Replace the prompt** — swap `LENSES` / `batchPrompt()` in
   `src/generate.ts` with the skill's own angle taxonomy and prompt structure,
   keeping the batch + dedup mechanics for diversity.

Eventually the skill should consume the export (below) so per-client taste
data feeds back into generation.

## Catalog format (export)

```json
{
  "client": "Acme Fitness",
  "brief": "...",
  "summary": { "total": 100, "love": 18, "like": 41, "dislike": 27, "hate": 9, "unrated": 5 },
  "entries": [
    {
      "title": "Why progressive overload is overrated for beginners",
      "hook": "...",
      "angle": "Contrarian takes",
      "format": "talking head",
      "rating": "love",
      "reason": "This is exactly the kind of thing my audience argues about in the comments.",
      "reasonMethod": "voice",
      "audioFile": "<idea-id>.webm"
    }
  ]
}
```

Raw data lives in `ideation-app/data/`:

- `data/sessions/<id>.json` — the full session (ideas, ratings, reasons)
- `data/audio/<ideaId>.webm` — raw voice memos (gitignored)

## API

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/sessions` | List session summaries |
| POST | `/api/sessions` | Create session (optionally with imported ideas) |
| GET | `/api/sessions/:id` | Full session (also the generation-progress poll) |
| POST | `/api/sessions/:id/generate` | Generate `{count}` more ideas in the background |
| POST | `/api/sessions/:id/ideas/:ideaId/rating` | `{rating: love\|like\|dislike\|hate}` |
| POST | `/api/sessions/:id/ideas/:ideaId/reason` | `{transcript, inputMethod}` |
| POST | `/api/sessions/:id/ideas/:ideaId/audio` | Raw audio body → saved file |
| GET | `/api/sessions/:id/export` | Flat catalog JSON |
