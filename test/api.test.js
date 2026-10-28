const assert = require('node:assert/strict');
const { afterEach, beforeEach, test } = require('node:test');
const request = require('supertest');
const { createApp } = require('../src/app');
const { initializeDatabase } = require('../src/db');

const JWT_SECRET = 'test-secret-with-enough-entropy-for-suite';
let db;
let app;
let alice;
let bob;

async function register(name, email) {
  const response = await request(app).post('/api/auth/register').send({
    name,
    email,
    password: 'correct horse battery staple',
  });
  return response.body.data;
}

function bearer(token) {
  return { Authorization: `Bearer ${token}` };
}

beforeEach(async () => {
  db = initializeDatabase(':memory:');
  app = createApp({ db, jwtSecret: JWT_SECRET });
  alice = await register('Alice', 'alice@example.test');
  bob = await register('Bob', 'bob@example.test');
});

afterEach(() => db.close());

test('registers safely, rejects duplicate email, and authenticates login', async () => {
  assert.equal(alice.user.name, 'Alice');
  assert.equal('password' in alice.user, false);
  assert.equal(db.prepare('SELECT password_hash FROM users WHERE id = ?').get(alice.user.id).password_hash.includes(':'), true);

  const duplicate = await request(app).post('/api/auth/register').send({
    name: 'Another Alice',
    email: 'ALICE@example.test',
    password: 'correct horse battery staple',
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.error.code, 'EMAIL_EXISTS');

  const login = await request(app).post('/api/auth/login').send({
    email: 'alice@example.test',
    password: 'correct horse battery staple',
  });
  assert.equal(login.status, 200);
  assert.equal(login.body.data.user.id, alice.user.id);
  assert.equal('passwordHash' in login.body.data.user, false);
});

test('validates registrations and requires a valid bearer token', async () => {
  const invalid = await request(app).post('/api/auth/register').send({ name: ' ', email: 'bad', password: 'short' });
  assert.equal(invalid.status, 400);
  assert.equal(invalid.body.error.code, 'VALIDATION_ERROR');

  const anonymous = await request(app).post('/api/posts').send({ title: 'No token', body: 'No access' });
  assert.equal(anonymous.status, 401);

  const currentUser = await request(app).get('/api/auth/me').set(bearer(alice.token));
  assert.equal(currentUser.status, 200);
  assert.equal(currentUser.body.data.email, 'alice@example.test');
});

test('supports post create, list, read, update, and owner-only delete', async () => {
  const created = await request(app).post('/api/posts').set(bearer(alice.token))
    .send({ title: ' First post ', body: ' A body ' });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.title, 'First post');
  const postId = created.body.data.id;

  const listed = await request(app).get('/api/posts?limit=1&offset=0');
  assert.equal(listed.status, 200);
  assert.equal(listed.body.meta.total, 1);
  assert.equal(listed.body.data[0].id, postId);

  const read = await request(app).get(`/api/posts/${postId}`);
  assert.equal(read.status, 200);
  assert.equal(read.body.data.authorName, 'Alice');

  const denied = await request(app).patch(`/api/posts/${postId}`).set(bearer(bob.token))
    .send({ title: 'Takeover' });
  assert.equal(denied.status, 403);

  const updated = await request(app).patch(`/api/posts/${postId}`).set(bearer(alice.token))
    .send({ title: 'Updated title' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.title, 'Updated title');

  const deleted = await request(app).delete(`/api/posts/${postId}`).set(bearer(alice.token));
  assert.equal(deleted.status, 204);
  assert.equal((await request(app).get(`/api/posts/${postId}`)).status, 404);
});

test('supports comment CRUD and cascades comments when the post is deleted', async () => {
  const post = await request(app).post('/api/posts').set(bearer(alice.token))
    .send({ title: 'Discussion', body: 'Post body' });
  const postId = post.body.data.id;

  const created = await request(app).post(`/api/posts/${postId}/comments`).set(bearer(bob.token))
    .send({ body: ' First comment ' });
  assert.equal(created.status, 201);
  assert.equal(created.body.data.body, 'First comment');
  const commentId = created.body.data.id;

  const listed = await request(app).get(`/api/posts/${postId}/comments`);
  assert.equal(listed.body.data.length, 1);

  const denied = await request(app).patch(`/api/comments/${commentId}`).set(bearer(alice.token))
    .send({ body: 'Unauthorized edit' });
  assert.equal(denied.status, 403);

  const updated = await request(app).patch(`/api/comments/${commentId}`).set(bearer(bob.token))
    .send({ body: 'Updated comment' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.data.body, 'Updated comment');

  const deleted = await request(app).delete(`/api/comments/${commentId}`).set(bearer(bob.token));
  assert.equal(deleted.status, 204);
  assert.equal((await request(app).get(`/api/posts/${postId}/comments`)).body.data.length, 0);

  await request(app).post(`/api/posts/${postId}/comments`).set(bearer(bob.token)).send({ body: 'Cascade me' });
  await request(app).delete(`/api/posts/${postId}`).set(bearer(alice.token));
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM comments').get().count, 0);
});

test('returns stable errors for invalid IDs, missing resources, malformed JSON, and invalid fields', async () => {
  const invalidId = await request(app).get('/api/posts/not-a-number');
  assert.equal(invalidId.status, 400);
  assert.equal(invalidId.body.error.code, 'INVALID_ID');

  const missing = await request(app).get('/api/posts/12345');
  assert.equal(missing.status, 404);
  assert.equal(missing.body.error.code, 'NOT_FOUND');

  const invalidPost = await request(app).post('/api/posts').set(bearer(alice.token))
    .send({ title: '', body: 'Body' });
  assert.equal(invalidPost.status, 400);
  assert.equal(invalidPost.body.error.code, 'VALIDATION_ERROR');

  const malformed = await request(app).post('/api/posts').set(bearer(alice.token))
    .set('Content-Type', 'application/json').send('{bad json');
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error.code, 'INVALID_JSON');
});