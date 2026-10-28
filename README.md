# Backend API Internship Project

This repository organizes the five-week backend assignment into a design deliverable and a runnable implementation:

- `openapi/ecommerce.yaml` and `docs/week-1-api-design.md` describe the Week 1 e-commerce API using OpenAPI 3.1.
- `src/` implements the Week 2 blog API with SQLite, registration/login, posts, and comments.
- `test/` contains integration tests for the Week 3 debugging and verification work.
- `scripts/benchmark.js` and `docs/performance-testing.md` provide a repeatable Week 4 load-measurement workflow. No benchmark results are claimed until it is run against a controlled environment.
- `.github/workflows/ci.yml` runs tests on pushes and pull requests as the Week 5 CI simulation.

The source assignment changes scope from an e-commerce API in Week 1 to a blog API in Week 2. This repository preserves that distinction instead of presenting the blog implementation as an e-commerce backend.

## Requirements

- Node.js 20 or newer
- npm

## Run locally

```sh
npm install
npm start
```

The API listens on `http://localhost:3000`. Set `PORT`, `DATABASE_PATH`, and `JWT_SECRET` to override the defaults. In production, the server refuses to start unless `JWT_SECRET` is at least 32 characters; use a unique, high-entropy secret.

## Verify

```sh
npm test
```

## API at a glance

| Method | Path | Access | Purpose |
| --- | --- | --- | --- |
| `POST` | `/api/auth/register` | Public | Create an account |
| `POST` | `/api/auth/login` | Public | Obtain a bearer token |
| `GET` | `/api/auth/me` | Authenticated | Read the current account |
| `GET`, `POST` | `/api/posts` | Public read, authenticated write | List or create posts |
| `GET`, `PATCH`, `DELETE` | `/api/posts/:postId` | Public read, owner write | Read, update, or delete a post |
| `GET`, `POST` | `/api/posts/:postId/comments` | Public read, authenticated write | List or add comments |
| `PATCH`, `DELETE` | `/api/comments/:commentId` | Comment owner | Update or delete a comment |

See [implementation and test notes](docs/week-2-to-5-implementation.md) for request examples and behavior.

## Repository map

```text
.
├── .github/workflows/ci.yml
├── docs/
├── openapi/ecommerce.yaml
├── scripts/benchmark.js
├── src/
└── test/
```