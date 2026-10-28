const { createApp } = require('./app');
const { initializeDatabase } = require('./db');

const jwtSecret = process.env.JWT_SECRET;
if (process.env.NODE_ENV === 'production' && (!jwtSecret || jwtSecret.length < 32)) {
  throw new Error('Production requires a JWT_SECRET of at least 32 characters.');
}

const db = initializeDatabase(process.env.DATABASE_PATH || './data/blog.sqlite');
const app = createApp({ db, jwtSecret });
const port = Number(process.env.PORT) || 3000;

const server = app.listen(port, () => {
  console.log(`Blog API listening on http://localhost:${port}`);
});

function shutdown() {
  server.close(() => {
    db.close();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);