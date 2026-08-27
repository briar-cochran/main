import { app } from './app';

const PORT = Number(process.env.PORT ?? 4100);
app.listen(PORT, () => {
  console.log(`\nIdeation ranking app → http://localhost:${PORT}\n`);
});
