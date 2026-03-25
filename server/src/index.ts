import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';

const app = express();
app.use(cors());
app.use(express.json());

interface Command {
  id: string;
  type: string;
  params: Record<string, unknown>;
  status: 'pending' | 'processing' | 'done' | 'error';
  result?: unknown;
  error?: string;
}

const commandQueue: Command[] = [];
const pendingResolvers = new Map<
  string,
  { resolve: (r: unknown) => void; reject: (e: Error) => void }
>();

// Agent posts a command and waits for the plugin to execute it
app.post('/commands', async (req, res) => {
  const command: Command = {
    id: randomUUID(),
    type: req.body.type,
    params: req.body.params ?? {},
    status: 'pending',
  };
  commandQueue.push(command);
  console.log(`[queue] +${command.type} (${command.id.slice(0, 8)})`);

  try {
    const result = await new Promise<unknown>((resolve, reject) => {
      pendingResolvers.set(command.id, { resolve, reject });
      setTimeout(() => {
        if (pendingResolvers.has(command.id)) {
          pendingResolvers.delete(command.id);
          reject(new Error('Command timed out after 30s'));
        }
      }, 30_000);
    });
    res.json({ id: command.id, result });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Plugin polls for the next pending command
app.get('/commands/next', (_req, res) => {
  const pending = commandQueue.find((c) => c.status === 'pending');
  if (pending) {
    pending.status = 'processing';
    console.log(`[poll] dispatching ${pending.type} (${pending.id.slice(0, 8)})`);
    res.json(pending);
  } else {
    res.json(null);
  }
});

// Plugin reports execution result
app.post('/commands/:id/result', (req, res) => {
  const { id } = req.params;
  const { result, error } = req.body as { result?: unknown; error?: string };

  const command = commandQueue.find((c) => c.id === id);
  if (command) {
    command.status = error ? 'error' : 'done';
    command.result = result;
    command.error = error;
  }

  const resolver = pendingResolvers.get(id);
  if (resolver) {
    pendingResolvers.delete(id);
    if (error) {
      console.log(`[result] ✗ ${id.slice(0, 8)}: ${error}`);
      resolver.reject(new Error(error));
    } else {
      console.log(`[result] ✓ ${id.slice(0, 8)}`);
      resolver.resolve(result);
    }
  }

  res.json({ ok: true });
});

app.get('/health', (_req, res) => res.json({ ok: true }));

const PORT = Number(process.env.PORT ?? 3333);
app.listen(PORT, () => {
  console.log(`\nFigma Slides Agent bridge server → http://localhost:${PORT}\n`);
});
