import 'dotenv/config';
import { createPool, migrate, ensureAccount } from './db.js';
import { createApp } from './app.js';

const db = createPool();
await migrate(db);
await ensureAccount(db);
const port = Number(process.env.PORT || 3001);
createApp(db).listen(port, () => console.log(`Mundo Curioso Analytics API en http://localhost:${port}`));
