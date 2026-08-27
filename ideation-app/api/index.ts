// Vercel serverless entry — every /api/* and /r/* request is rewritten here
// (see vercel.json) and handled by the shared Express app.
import { app } from '../src/app';

export default app;
