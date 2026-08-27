import Anthropic from '@anthropic-ai/sdk';
import { z } from 'zod';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import { RankingSession, loadSession, makeIdea, saveSession } from './store';

const client = new Anthropic();

const MODEL = process.env.IDEATION_MODEL ?? 'claude-opus-5';

// The `temperature` sampling parameter is removed on current Claude models, so
// variety comes from structure instead: each batch is generated through a
// different creative lens and is shown every previously generated title with a
// hard instruction not to overlap. This produces more *useful* spread than raw
// temperature (which mostly adds phrasing noise, not conceptual diversity).
//
// When the Oakland ideation skill is wired in, its angle taxonomy / prompt
// structure should replace or extend these lenses — see ideation-app/README.md.
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

const IdeaBatchSchema = z.object({
  ideas: z.array(
    z.object({
      title: z.string().describe('A concise, specific content idea title (not clickbait, not generic)'),
      hook: z.string().describe('One sentence: the opening line or core tension that makes this worth talking about'),
      format: z.string().describe('Suggested format, e.g. "talking head", "story post", "listicle", "tutorial"'),
    }),
  ),
});

function batchPrompt(session: RankingSession, lens: string, count: number, existingTitles: string[]): string {
  const existing = existingTitles.length
    ? `\n\nIdeas already generated for this client (do NOT repeat or closely paraphrase any of these — every new idea must be conceptually distinct):\n${existingTitles.map((t) => `- ${t}`).join('\n')}`
    : '';

  return `You are generating content ideas for a client of a content agency. The client will review each idea and rate it love / like / dislike / hate, so the goal is a wide, diverse spread of ideas — including some risky ones — rather than 10 safe variations of the same thing.

Client: ${session.clientName}
Client brief:
${session.brief}

Generate exactly ${count} content ideas through this specific creative lens:
${lens}

Rules:
- Every idea must be specific to THIS client and brief, not generic advice that fits anyone.
- Vary scope and tone within the batch: some broad, some narrow; some safe, some provocative.
- Titles are working titles the client reads on a card — clear and concrete, under 15 words.${existing}`;
}

/**
 * Generates ideas for a session in the background, saving progress after each
 * batch so the UI can poll. Diversity strategy: one batch per creative lens,
 * cycling through lenses until `total` is reached, with cross-batch dedup
 * pressure via the accumulated title list.
 */
export async function generateIdeas(sessionId: string, total: number): Promise<void> {
  const batchSize = 10;
  let session = loadSession(sessionId);
  if (!session) throw new Error('session not found');

  session.generation = { status: 'running', target: total, generated: 0, error: null };
  saveSession(session);

  try {
    let generated = 0;
    let lensIndex = 0;
    while (generated < total) {
      const count = Math.min(batchSize, total - generated);
      const lens = LENSES[lensIndex % LENSES.length];
      lensIndex++;

      // Reload each iteration so ratings happening in parallel aren't clobbered.
      session = loadSession(sessionId)!;
      const existingTitles = session.ideas.map((i) => i.title);

      const response = await client.messages.parse({
        model: MODEL,
        max_tokens: 16000,
        messages: [{ role: 'user', content: batchPrompt(session, lens, count, existingTitles) }],
        output_config: { format: zodOutputFormat(IdeaBatchSchema) },
      });

      const parsed = response.parsed_output;
      if (!parsed) throw new Error('model returned unparseable output');

      const shortLens = lens.split('—')[0].trim();
      session = loadSession(sessionId)!;
      for (const idea of parsed.ideas.slice(0, count)) {
        session.ideas.push(makeIdea({ ...idea, angle: shortLens }));
      }
      generated = session.ideas.length >= total ? total : session.ideas.length;
      session.generation = { status: 'running', target: total, generated: session.ideas.length, error: null };
      saveSession(session);
    }

    session = loadSession(sessionId)!;
    session.generation = { status: 'done', target: total, generated: session.ideas.length, error: null };
    saveSession(session);
  } catch (err) {
    const s = loadSession(sessionId);
    if (s) {
      s.generation = {
        status: 'error',
        target: total,
        generated: s.ideas.length,
        error: (err as Error).message,
      };
      saveSession(s);
    }
  }
}
