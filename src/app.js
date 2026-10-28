const crypto = require('node:crypto');
const express = require('express');
const jwt = require('jsonwebtoken');

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  const hash = crypto.scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, storedHash) {
  const [salt, expectedHex] = storedHash.split(':');
  const actual = crypto.scryptSync(password, salt, 64);
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function createApp({ db, jwtSecret = process.env.JWT_SECRET || 'local-development-secret-change-me' }) {
  const app = express();
  app.use(express.json({ limit: '32kb' }));

  function issueToken(user) {
    return jwt.sign({ sub: String(user.id) }, jwtSecret, { expiresIn: '1h' });
  }

  function authenticate(req, res, next) {
    const header = req.get('authorization') || '';
    const [scheme, token] = header.split(' ');
    if (scheme !== 'Bearer' || !token) {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'A bearer token is required.' } });
    }
    try {
      const payload = jwt.verify(token, jwtSecret);
      const user = db.prepare('SELECT id, name, email, created_at AS createdAt FROM users WHERE id = ?').get(Number(payload.sub));
      if (!user) {
        return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'The token user no longer exists.' } });
      }
      req.user = user;
      return next();
    } catch {
      return res.status(401).json({ error: { code: 'UNAUTHORIZED', message: 'The bearer token is invalid or expired.' } });
    }
  }

  function validateText(value, field, maxLength) {
    if (typeof value !== 'string' || value.trim().length === 0 || value.trim().length > maxLength) {
      return `${field} must be a non-empty string of at most ${maxLength} characters.`;
    }
    return null;
  }

  function parseId(value) {
    if (!/^[1-9]\d*$/.test(value)) return null;
    const id = Number(value);
    return Number.isSafeInteger(id) ? id : null;
  }

  function getPost(postId) {
    return db.prepare(`
      SELECT p.id, p.author_id AS authorId, u.name AS authorName, p.title, p.body,
             p.created_at AS createdAt, p.updated_at AS updatedAt
      FROM posts p JOIN users u ON u.id = p.author_id WHERE p.id = ?
    `).get(postId);
  }

  app.get('/health', (req, res) => res.json({ status: 'ok' }));

  app.post('/api/auth/register', (req, res, next) => {
    const { name, email, password } = req.body || {};
    const errors = [];
    const nameError = validateText(name, 'name', 100);
    if (nameError) errors.push(nameError);
    if (typeof email !== 'string' || email.length > 254 || !EMAIL_PATTERN.test(email)) errors.push('email must be a valid email address.');
    if (typeof password !== 'string' || password.length < 10 || password.length > 128) errors.push('password must be between 10 and 128 characters.');
    if (errors.length) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: errors } });

    try {
      const result = db.prepare('INSERT INTO users (name, email, password_hash) VALUES (?, ?, ?)')
        .run(name.trim(), email.trim().toLowerCase(), hashPassword(password));
      const user = db.prepare('SELECT id, name, email, created_at AS createdAt FROM users WHERE id = ?').get(result.lastInsertRowid);
      return res.status(201).json({ data: { user, token: issueToken(user) } });
    } catch (error) {
      if (error.code === 'SQLITE_CONSTRAINT_UNIQUE') {
        return res.status(409).json({ error: { code: 'EMAIL_EXISTS', message: 'An account with this email already exists.' } });
      }
      return next(error);
    }
  });

  app.post('/api/auth/login', (req, res) => {
    const { email, password } = req.body || {};
    if (typeof email !== 'string' || typeof password !== 'string') {
      return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'email and password are required.' } });
    }
    const record = db.prepare('SELECT id, name, email, password_hash AS passwordHash, created_at AS createdAt FROM users WHERE email = ?').get(email.trim());
    if (!record || !verifyPassword(password, record.passwordHash)) {
      return res.status(401).json({ error: { code: 'INVALID_CREDENTIALS', message: 'Email or password is incorrect.' } });
    }
    const { passwordHash, ...user } = record;
    return res.json({ data: { user, token: issueToken(user) } });
  });

  app.get('/api/auth/me', authenticate, (req, res) => res.json({ data: req.user }));

  app.get('/api/posts', (req, res) => {
    const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 20, 1), 100);
    const offset = Math.max(Number.parseInt(req.query.offset, 10) || 0, 0);
    const posts = db.prepare(`
      SELECT p.id, p.author_id AS authorId, u.name AS authorName, p.title, p.body,
             p.created_at AS createdAt, p.updated_at AS updatedAt
      FROM posts p JOIN users u ON u.id = p.author_id
      ORDER BY p.created_at DESC, p.id DESC LIMIT ? OFFSET ?
    `).all(limit, offset);
    const total = db.prepare('SELECT COUNT(*) AS count FROM posts').get().count;
    return res.json({ data: posts, meta: { limit, offset, total } });
  });

  app.post('/api/posts', authenticate, (req, res) => {
    const errors = [validateText(req.body?.title, 'title', 200), validateText(req.body?.body, 'body', 20000)].filter(Boolean);
    if (errors.length) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: errors } });
    const result = db.prepare('INSERT INTO posts (author_id, title, body) VALUES (?, ?, ?)')
      .run(req.user.id, req.body.title.trim(), req.body.body.trim());
    return res.status(201).json({ data: getPost(Number(result.lastInsertRowid)) });
  });

  app.get('/api/posts/:postId', (req, res) => {
    const id = parseId(req.params.postId);
    if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'postId must be a positive integer.' } });
    const post = getPost(id);
    if (!post) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
    return res.json({ data: post });
  });

  app.patch('/api/posts/:postId', authenticate, (req, res) => {
    const id = parseId(req.params.postId);
    if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'postId must be a positive integer.' } });
    const post = getPost(id);
    if (!post) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
    if (post.authorId !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not own this resource.' } });
    const { title = post.title, body = post.body } = req.body || {};
    const errors = [validateText(title, 'title', 200), validateText(body, 'body', 20000)].filter(Boolean);
    if (errors.length) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: errors } });
    db.prepare("UPDATE posts SET title = ?, body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(title.trim(), body.trim(), id);
    return res.json({ data: getPost(id) });
  });

  app.delete('/api/posts/:postId', authenticate, (req, res) => {
    const id = parseId(req.params.postId);
    if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'postId must be a positive integer.' } });
    const post = getPost(id);
    if (!post) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
    if (post.authorId !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not own this resource.' } });
    db.prepare('DELETE FROM posts WHERE id = ?').run(id);
    return res.status(204).end();
  });

  app.get('/api/posts/:postId/comments', (req, res) => {
    const postId = parseId(req.params.postId);
    if (!postId) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'postId must be a positive integer.' } });
    if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(postId)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
    const comments = db.prepare(`
      SELECT c.id, c.post_id AS postId, c.author_id AS authorId, u.name AS authorName,
             c.body, c.created_at AS createdAt, c.updated_at AS updatedAt
      FROM comments c JOIN users u ON u.id = c.author_id
      WHERE c.post_id = ? ORDER BY c.created_at, c.id
    `).all(postId);
    return res.json({ data: comments });
  });

  app.post('/api/posts/:postId/comments', authenticate, (req, res) => {
    const postId = parseId(req.params.postId);
    if (!postId) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'postId must be a positive integer.' } });
    if (!db.prepare('SELECT 1 FROM posts WHERE id = ?').get(postId)) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Post not found.' } });
    const bodyError = validateText(req.body?.body, 'body', 5000);
    if (bodyError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: [bodyError] } });
    const result = db.prepare('INSERT INTO comments (post_id, author_id, body) VALUES (?, ?, ?)')
      .run(postId, req.user.id, req.body.body.trim());
    const comment = db.prepare(`
      SELECT c.id, c.post_id AS postId, c.author_id AS authorId, u.name AS authorName,
             c.body, c.created_at AS createdAt, c.updated_at AS updatedAt
      FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?
    `).get(result.lastInsertRowid);
    return res.status(201).json({ data: comment });
  });

  function findComment(commentId) {
    return db.prepare('SELECT id, author_id AS authorId, body FROM comments WHERE id = ?').get(commentId);
  }

  app.patch('/api/comments/:commentId', authenticate, (req, res) => {
    const id = parseId(req.params.commentId);
    if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'commentId must be a positive integer.' } });
    const comment = findComment(id);
    if (!comment) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Comment not found.' } });
    if (comment.authorId !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not own this resource.' } });
    const bodyError = validateText(req.body?.body, 'body', 5000);
    if (bodyError) return res.status(400).json({ error: { code: 'VALIDATION_ERROR', message: 'Request validation failed.', details: [bodyError] } });
    db.prepare("UPDATE comments SET body = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?")
      .run(req.body.body.trim(), id);
    const updated = db.prepare(`SELECT c.id, c.post_id AS postId, c.author_id AS authorId,
      u.name AS authorName, c.body, c.created_at AS createdAt, c.updated_at AS updatedAt
      FROM comments c JOIN users u ON u.id = c.author_id WHERE c.id = ?`).get(id);
    return res.json({ data: updated });
  });

  app.delete('/api/comments/:commentId', authenticate, (req, res) => {
    const id = parseId(req.params.commentId);
    if (!id) return res.status(400).json({ error: { code: 'INVALID_ID', message: 'commentId must be a positive integer.' } });
    const comment = findComment(id);
    if (!comment) return res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Comment not found.' } });
    if (comment.authorId !== req.user.id) return res.status(403).json({ error: { code: 'FORBIDDEN', message: 'You do not own this resource.' } });
    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    return res.status(204).end();
  });

  app.use((req, res) => res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Route not found.' } }));
  app.use((error, req, res, next) => {
    if (res.headersSent) return next(error);
    if (error instanceof SyntaxError && error.status === 400 && 'body' in error) {
      return res.status(400).json({ error: { code: 'INVALID_JSON', message: 'Request body must be valid JSON.' } });
    }
    console.error(error);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'An unexpected error occurred.' } });
  });

  return app;
}

module.exports = { createApp };