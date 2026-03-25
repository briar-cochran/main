import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic();
const SERVER_URL = process.env.BRIDGE_URL ?? 'http://localhost:3333';

// ─── Bridge communication ─────────────────────────────────────────────────────

async function sendCommand(
  type: string,
  params: Record<string, unknown> = {},
): Promise<unknown> {
  const res = await fetch(`${SERVER_URL}/commands`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type, params }),
  });
  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Bridge error ${res.status}: ${body}`);
  }
  const data = await res.json() as { id: string; result: unknown };
  return data.result;
}

// ─── Tool definitions ─────────────────────────────────────────────────────────

const tools: Anthropic.Tool[] = [
  {
    name: 'clear_all_slides',
    description: 'Remove all existing slides/frames on the current page. Call this first when starting a new presentation.',
    input_schema: { type: 'object', properties: {} },
  },
  {
    name: 'create_slide',
    description: 'Create a new slide (1280×720px frame). Returns { nodeId, slideIndex }. Slides are indexed 0-based in creation order.',
    input_schema: {
      type: 'object',
      properties: {
        title: {
          type: 'string',
          description: 'Slide name shown in the layers panel',
        },
        backgroundColor: {
          type: 'string',
          description: 'Hex background color, e.g. "#1A1A2E"',
        },
      },
    },
  },
  {
    name: 'add_text',
    description: 'Add a text element to a slide. Canvas is 1280×720. x/y/width/height are in pixels.',
    input_schema: {
      type: 'object',
      required: ['slideIndex', 'text', 'x', 'y', 'width', 'height'],
      properties: {
        slideIndex: { type: 'number', description: '0-based slide index' },
        text: { type: 'string' },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        fontSize: { type: 'number', description: 'Font size in px (default 24)' },
        fontWeight: {
          type: 'string',
          enum: ['Regular', 'Medium', 'Semi Bold', 'Bold'],
          description: 'Default: Regular',
        },
        color: { type: 'string', description: 'Hex color, e.g. "#FFFFFF"' },
        textAlign: {
          type: 'string',
          enum: ['LEFT', 'CENTER', 'RIGHT'],
          description: 'Default: LEFT',
        },
      },
    },
  },
  {
    name: 'add_shape',
    description: 'Add a rectangle or ellipse to a slide. Use shapes for accent bars, decorative elements, highlights.',
    input_schema: {
      type: 'object',
      required: ['slideIndex', 'shape', 'x', 'y', 'width', 'height'],
      properties: {
        slideIndex: { type: 'number' },
        shape: { type: 'string', enum: ['rectangle', 'ellipse'] },
        x: { type: 'number' },
        y: { type: 'number' },
        width: { type: 'number' },
        height: { type: 'number' },
        color: { type: 'string', description: 'Hex fill color' },
        opacity: {
          type: 'number',
          description: '0–1, default 1',
        },
        cornerRadius: {
          type: 'number',
          description: 'Corner radius in px (rectangles only)',
        },
      },
    },
  },
  {
    name: 'set_background',
    description: 'Change the background fill of an existing slide.',
    input_schema: {
      type: 'object',
      required: ['slideIndex', 'color'],
      properties: {
        slideIndex: { type: 'number' },
        color: { type: 'string', description: 'Hex color' },
      },
    },
  },
  {
    name: 'get_slides_info',
    description: 'Return a list of current slides with their index, nodeId and name. Use to confirm slide creation.',
    input_schema: { type: 'object', properties: {} },
  },
];

// ─── Tool executor ────────────────────────────────────────────────────────────

async function executeTool(
  name: string,
  input: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case 'clear_all_slides':    return sendCommand('CLEAR_ALL', {});
    case 'create_slide':        return sendCommand('CREATE_SLIDE', input);
    case 'add_text':            return sendCommand('ADD_TEXT', input);
    case 'add_shape':           return sendCommand('ADD_SHAPE', input);
    case 'set_background':      return sendCommand('SET_BACKGROUND', input);
    case 'get_slides_info':     return sendCommand('GET_SLIDES_INFO', {});
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}

// ─── Agent ────────────────────────────────────────────────────────────────────

const SYSTEM_PROMPT = `You are a professional presentation designer. You create beautiful, polished slides in Figma using the tools provided.

Canvas: 1280 × 720 px per slide.

Design principles:
- Choose a cohesive 2–3 color palette and stick to it throughout
- Every slide needs a background color set via create_slide or set_background
- Add decorative shapes (accent bars, circles, rounded rects) before adding text — they appear behind text
- Use clear typographic hierarchy: large bold titles, smaller body text
- Keep slides clean — whitespace is good
- Use contrasting colors: light text on dark backgrounds, dark text on light backgrounds

Typical workflow for each slide:
1. create_slide (sets frame + background)
2. add_shape calls for decorative elements
3. add_text for title, then body/bullets

Always start by calling clear_all_slides to start fresh.
Create 4–6 slides unless the user specifies otherwise.
After finishing, call get_slides_info to confirm all slides were created.`;

export async function createPresentation(userPrompt: string): Promise<void> {
  console.log(`\n🎨  Prompt: "${userPrompt}"\n`);

  // Verify bridge is reachable
  try {
    const res = await fetch(`${SERVER_URL}/health`);
    if (!res.ok) throw new Error('not ok');
  } catch {
    throw new Error(
      `Bridge server is not running. Start it first:\n  cd server && npm run dev`,
    );
  }

  const messages: Anthropic.MessageParam[] = [
    { role: 'user', content: userPrompt },
  ];

  let iteration = 0;
  const MAX_ITERATIONS = 50; // guard against runaway loops

  while (iteration < MAX_ITERATIONS) {
    iteration++;
    process.stdout.write(`[turn ${iteration}] thinking…`);

    const response = await client.messages.create({
      model: 'claude-opus-4-6',
      max_tokens: 4096,
      thinking: { type: 'adaptive' },
      system: SYSTEM_PROMPT,
      tools,
      messages,
    });

    process.stdout.write('\r\x1b[K'); // clear "thinking…" line

    messages.push({ role: 'assistant', content: response.content });

    if (response.stop_reason === 'end_turn') {
      const finalText = response.content
        .filter((b): b is Anthropic.TextBlock => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
      console.log('\n✅  Done!');
      if (finalText) console.log('\n' + finalText);
      return;
    }

    if (response.stop_reason !== 'tool_use') {
      console.log(`\nStopped: ${response.stop_reason}`);
      return;
    }

    const toolCalls = response.content.filter(
      (b): b is Anthropic.ToolUseBlock => b.type === 'tool_use',
    );

    const toolResults: Anthropic.ToolResultBlockParam[] = [];

    for (const call of toolCalls) {
      const inputStr = JSON.stringify(call.input).slice(0, 100);
      process.stdout.write(`  → ${call.name}(${inputStr}…)\n`);

      try {
        const result = await executeTool(
          call.name,
          call.input as Record<string, unknown>,
        );
        process.stdout.write(`    ✓ ${JSON.stringify(result)}\n`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: JSON.stringify(result),
        });
      } catch (err) {
        const msg = (err as Error).message;
        process.stdout.write(`    ✗ ${msg}\n`);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: call.id,
          content: `Error: ${msg}`,
          is_error: true,
        });
      }
    }

    messages.push({ role: 'user', content: toolResults });
  }

  throw new Error('Exceeded max iterations — something may be wrong with the agent loop.');
}

// ─── CLI entry point ──────────────────────────────────────────────────────────

const prompt =
  process.argv.slice(2).join(' ') ||
  'Create a 5-slide presentation about the future of artificial intelligence';

createPresentation(prompt).catch((err) => {
  console.error('\n❌ ', err.message);
  process.exit(1);
});
