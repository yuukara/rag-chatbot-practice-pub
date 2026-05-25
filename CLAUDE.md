# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

A practice app for building a RAG chatbot. The Angular frontend sends a question to the NestJS backend, which calls an OpenAI-compatible `chat/completions` endpoint (LM Studio by default) and returns the answer. It is **single-turn** (no conversation history, no streaming).

A minimal **RAG** layer is implemented: at startup the backend ingests `backend/docs/` (chunk → embed → in-memory store), and each chat query retrieves the most similar chunks and injects them into the prompt. If the embedding model is unset / docs are missing / retrieval fails, it falls back to plain single-turn chat. See `TODO.md` for the build history, findings, and remaining refinement ideas.

## Project governance

`AI_INSTRUCTIONS.md` defines how to work in this repo and takes precedence over general assumptions. Key standing constraints (as of this writing):

- The backend is the **only** place that calls the model API. Never put API keys or provider config in the frontend.
- Keep provider-specific logic in the service layer (`app.service.ts`), not the controller.
- Keep the current chat flow stable; make small, focused changes toward the next RAG step.
- **Non-goals (do not add unless asked):** streaming, multi-turn conversation history, UI redesigns, switching away from the working model.

Always re-read `AI_INSTRUCTIONS.md` and `TODO.md` before starting — they hold the live task state and decisions.

## Architecture

Three services wired together by `docker-compose.yml` (frontend, backend, db):

```
browser :8080 → nginx (frontend) ──/api/ proxy──> backend :3000 → OpenAI-compatible API (LM Studio on host :1234)
                                                          │
                                                          └── pgvector (db service, PostgreSQL) for RAG chunk storage/search
```

- **frontend/** — Angular 21, single standalone component (`app.component.ts`) using signals. Posts questions to `/api/chat`, and manages knowledge docs via `/api/documents` (lists on load, uploads files, deletes by source). Built to static files and served by nginx (`nginx.conf`), which proxies `/api/` to `backend:3000`. The frontend never talks to the model directly.
- **backend/** — NestJS 11. `AppController`: `GET /api/message` (static placeholder) and `POST /api/chat` (`{ "message": string }` → `{ "message": string }`). `DocumentsController` (in `RagModule`): `GET /api/documents` (list sources), `POST /api/documents` (multipart `file`, `.md`/`.txt`, runtime ingest), `DELETE /api/documents/:source`. CORS is enabled and the server binds `0.0.0.0:3000` (`main.ts`). The RAG layer lives in `backend/src/rag/` (`RagModule`), imported by `AppModule`.

### Backend LLM call — important details

- `AppService.chat()` calls `chat/completions` with raw `fetch`, **not** the `openai` SDK (the package is a dependency but currently unused). It uses an `AbortController` timeout and a Japanese system prompt that asks for concise, final-answer-only output. Before the call it asks `RagService` for relevant chunks and, if any, appends them as a "参考情報" block to the system prompt (`buildSystemPrompt`).
- All provider config comes from environment variables with fallbacks: `OPENAI_BASE_URL`, `OPENAI_API_KEY`, `OPENAI_MODEL`, `OPENAI_MAX_TOKENS`, `OPENAI_TIMEOUT_MS`, plus RAG vars `OPENAI_EMBEDDING_MODEL`, `RAG_TOP_K`, `RAG_CHUNK_SIZE`, `RAG_CHUNK_OVERLAP`, `RAG_DOCS_DIR`, `RAG_RESET`, and `DATABASE_URL` (pgvector). These flow from `.env` → `docker-compose.yml` → the container. Switching between LM Studio and the real OpenAI API is meant to be a config change only.
- Backend runs inside Docker, so it reaches a model server on the host (Windows/WSL + Docker Desktop) via `host.docker.internal:1234`, **not** `localhost`.

### RAG layer (`backend/src/rag/`)

- `EmbeddingService` calls the OpenAI-compatible `/v1/embeddings` (same `OPENAI_BASE_URL`); disabled when `OPENAI_EMBEDDING_MODEL` is empty. `VectorStoreService` stores chunks in **pgvector** (PostgreSQL `chunks` table, `embedding vector(N)` + HNSW cosine index) using raw `pg` (node-postgres), no ORM; its methods (`ensureSchema`, `add`, `deleteBySource`, `listSources`, `search`) tolerate a missing table (return empty) so chat works before any ingest. `IngestService.ingestText(source, content)` is the shared ingest path (chunk via `chunk.util.ts` → embed → `ensureSchema(dim)` with dimension auto-detected from the vector → `deleteBySource` → `add`), reused by both startup and uploads. `RagService.retrieve()` embeds the query, runs a cosine-distance (`<=>`) search, and logs hit sources + scores.
- **Startup is non-destructive**: `OnModuleInit` re-ingests each bundled `docs/` file by source (delete+add), so `docs/` edits are reflected on rebuild while uploaded documents (different sources) persist across restarts in the `pgdata` volume. The table is dropped only when `RAG_RESET=true` (needed when the embedding dimension changes, e.g. 768↔1024). Uploaded originals are not retained — only their vectors.
- **Embedding model matters for retrieval quality.** `nomic-embed-text-v1.5` discriminates Japanese poorly (scores cluster ~0.6–0.72, relevant chunks rank low); `text-embedding-bge-m3` (1024-dim, no prefix needed) works well. Both chat and embedding models must be loaded in LM Studio.
- `docs/` is baked into the image (`Dockerfile` copies it into the runner), so changing docs requires a rebuild. Retrieval is always-on when enabled — there is no similarity threshold yet, so low-relevance chunks are still injected for off-topic questions (a noted refinement in `TODO.md`). If the DB is unreachable, ingest/retrieval fail gracefully and chat continues without RAG.

## Commands

Primary workflow is Docker Compose from the repo root:

```bash
docker compose up --build      # build + run all services (frontend, backend, db)
docker compose down            # stop/remove containers
curl http://localhost:8080/api/message   # check the API through nginx
# chat: POST http://localhost:8080/api/chat  body {"message": "..."}
# inspect stored vectors: docker compose exec db psql -U rag -d ragdb -c "SELECT source, chunk_index FROM chunks;"
```

Then open http://localhost:8080.

Running a service directly (without Docker):

```bash
# backend/  — dev server with watch on :3000
npm install && npm run start:dev
npm run build && npm run start:prod   # production build → node dist/main.js

# frontend/ — ng serve on 0.0.0.0:4200
npm install && npm start
npm run build                          # outputs to dist/frontend
```

Note: there is no proxy configured for `ng serve`, so `/api/*` calls only resolve in the Docker/nginx setup. There are currently **no test or lint scripts** in either package.

## Prerequisite for chat to work

LM Studio (or another OpenAI-compatible server) must be running on the host with models loaded: a **chat model** (e.g. `openai/gpt-oss-20b`, set as `OPENAI_MODEL`) and, for RAG, an **embedding model** (e.g. `text-embedding-bge-m3`, set as `OPENAI_EMBEDDING_MODEL`). The default endpoint is `http://host.docker.internal:1234/v1`. Without a reachable chat model, `POST /api/chat` returns a 500 ("AI からの応答を取得できませんでした。"). To check loaded model IDs from inside the container: `docker compose exec backend sh -c "wget -qO- http://host.docker.internal:1234/v1/models"`.
