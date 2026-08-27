import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { RankingSession, makeIdea } from './store';

const client = new Anthropic();

const MODEL = process.env.IDEATION_MODEL ?? 'claude-opus-5';
export const BATCH_SIZE = 10;

// The `temperature` sampling parameter is removed on current Claude models, so
// variety comes from structure instead: each batch is generated through a
// different creative lens and is shown every previously generated title with a
// hard instruction not to overlap. This produces more *useful* spread than raw
// temperature (which mostly adds phrasing noise, not conceptual diversity).
//
// The full Oakline ideation skill (oakline/04-skills/ideation) is reference-first
// and research-backed (TubeLab/Apify outliers); these lenses are the lightweight
// stand-in for taste-calibration runs. Swap in the skill's angle taxonomy here
// if/when this app should mirror it exactly.
const LENSES = [
  'Contrarian takes — challenge a belief this audience holds as obvious truth',
  'Personal stories — moments of failure, change, or realization the client could tell first-person',
  'Tactical how-tos — specific, step-by-step wins the audience can apply today',
  'Industry myths — things "everyone knows" in this niche that are wrong or outdated',
  'Trends and shifts — what is changing right now in this space and what it means',
  'Behind the scenes — process, numbers, tools, and decisions usually kept private',
  'Audience pain points — the frustrations, fears, and stuck-points the audience actually has',
  'Hot takes and opinions — strong, defensible stances that invite debate',
  'Comparisons and frameworks — X vs Y, mental models, naming a pattern people feel but cannot articulate',
  'Curiosity gaps and questions — open questions, experiments, and "what would happen if" explorations',
];

// Formats from the Oakline ideation skill's structured-mode taxonomy, plus yap.
const FORMATS =
  'yap (direct-to-camera), green-screen reveal, ranking, tier list, bracket, split-screen, before/after board, scorecard, mirror-board, notes-app reveal, case-study teardown, reaction, listicle, whiteboard breakdown';

const IdeaBatchSchema = z.object({
  ideas: z
    .array(
      z.object({
        title: z.string().describe('A concise, specific content idea title (not clickbait, not generic)'),
        hook: z.string().describe('One sentence: the opening line or core tension that makes this worth talking about'),
        format: z.string().describe(`Suggested format, one of: ${FORMATS}`),
      }),
    )
    .min(1),
});

function batchPrompt(session: RankingSession, lens: string, count: number): string {
  const existingTitles = session.ideas.map((i) => i.title);
  const existing = existingTitles.length
    ? `\n\nIdeas already generated for this client (do NOT repeat or closely paraphrase any of these — every new idea must be conceptually distinct):\n${existingTitles.map((t) => `- ${t}`).join('\n')}`
    : '';

  return `You are generating content ideas for a client of a content agency. The client will review each idea and rate it love / like / dislike / hate, so the goal is a wide, diverse spread of ideas — including some risky ones — rather than 10 safe variations of the same thing. Their ratings become taste-calibration data for future ideation runs.

Client: ${session.clientName}
Client brief:
${session.brief}

Generate exactly ${count} content ideas through this specific creative lens:
${lens}

Rules:
- Every idea must be specific to THIS client and brief, not generic advice that fits anyone.
- Vary scope and tone within the batch: some broad, some narrow; some safe, some provocative.
- Vary formats across the batch (${FORMATS}).
- Titles are working titles the client reads on a card — clear and concrete, under 15 words.${existing}`;
}

/**
 * Generates ONE batch of ideas synchronously and returns them (they are not
 * saved here — the route handles persistence). One batch per HTTP request so
 * the whole run fits inside serverless execution limits; the frontend loops
 * until the session's generation target is reached. The lens rotates with the
 * batch number so consecutive batches take different creative angles.
 */
export async function generateBatch(session: RankingSession, count: number) {
  // Prefer the persisted monotonic counter; fall back to deriving from the
  // idea count for sessions created before the counter existed. A count-based
  // number would reuse a lens whenever a batch came back short.
  const batchNumber = session.generation.batches ?? Math.floor(session.ideas.length / BATCH_SIZE);
  const lens = LENSES[batchNumber % LENSES.length];

  const response = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    messages: [{ role: 'user', content: batchPrompt(session, lens, count) }],
    output_config: { format: zodOutputFormat(IdeaBatchSchema) },
  });

  const parsed = response.parsed_output;
  if (!parsed) throw new Error('model returned unparseable output');
  if (parsed.ideas.length === 0) throw new Error('model returned an empty batch');

  const shortLens = lens.split('—')[0].trim();
  return parsed.ideas.slice(0, count).map((idea) => makeIdea({ ...idea, angle: shortLens }));
}
