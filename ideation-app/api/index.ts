// Vercel serverless entry — /api/* and /audio/* requests are rewritten here
// (see vercel.json) and handled by the shared Express app; /r/* rewrites to
// the static index.html, so the Express /r/:id route only serves local dev.
import { app } from '../src/app';

export default app;
