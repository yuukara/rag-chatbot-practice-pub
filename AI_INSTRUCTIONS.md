# AI Instructions for Claude Code

Codex is the AI team lead for this repository. Human instructions always take priority. Claude Code must follow this file.

## Current State

The app is a working **single-turn RAG chatbot** (no streaming, no conversation history).

- `POST /api/chat` (NestJS) calls an OpenAI-compatible `chat/completions` (LM Studio) and injects retrieved context when available.
- RAG layer in `backend/src/rag/`: embeddings via `/v1/embeddings`, char-based chunking, retrieval, and prompt injection.
- Vector storage in **pgvector** (the `db` PostgreSQL service): `chunks` table with an HNSW cosine index, dimension auto-detected from the embedding model.
- Document management: `GET / POST / DELETE /api/documents` (upload `.md` / `.txt` at runtime). The frontend has a "ナレッジ文書" section that lists, uploads, and deletes documents.
- Knowledge sources: bundled `backend/docs/` (ingested at startup) plus uploaded documents (persist across restarts via the `pgdata` volume).
- Models: chat `openai/gpt-oss-20b`, embedding `text-embedding-bge-m3` (1024-dim, chosen for Japanese retrieval quality).

## Objective

The "RAG-ready" milestone is reached. Continue with incremental quality and robustness improvements (see `TODO.md`), keeping the existing flow stable.

## Current Decisions

- Keep using LM Studio for local verification.
- Keep the backend as the only place that calls the model API; keep the provider abstraction env-switchable.
- Embedding model is `text-embedding-bge-m3` (nomic discriminated Japanese poorly — a concrete quality issue). The chat model is unchanged.
- Vector store is pgvector accessed via raw `pg` (no ORM). Startup re-ingests only the bundled `docs/`; set `RAG_RESET=true` to rebuild the table when the embedding dimension changes.
- Do not reintroduce heavy response sanitization unless a model regresses.

## Files To Inspect First

- `TODO.md`, `README.md`, `CLAUDE.md`
- `docker-compose.yml`
- `backend/src/app.service.ts`, `backend/src/app.controller.ts`
- `backend/src/rag/` (`embedding.service.ts`, `vector-store.service.ts`, `ingest.service.ts`, `rag.service.ts`, `documents.controller.ts`)
- `frontend/src/app/app.component.ts` / `.html` / `.css`

## What Claude Should Do Next (candidates — see TODO.md)

1. Similarity threshold: skip injecting low-relevance chunks for off-topic questions.
2. Incremental `docs/` re-ingest (content hash) instead of re-embedding bundled docs on every startup.
3. Chunking that respects heading/paragraph boundaries.

Keep changes small and focused, and keep the chat flow stable.

## Non-Goals

- Do not add unrelated UI redesigns.
- Do not add streaming.
- Do not add multi-turn conversation history yet.
- Do not switch away from the current chat model without reason.
- Do not touch unrelated files.

## Verification

Report back with:
- what was inspected
- what was changed
- what remains
- any blockers or open questions

After code changes, verify `POST /api/chat` still responds; if the RAG layer was touched, also verify document upload (`POST /api/documents`) and retrieval still work.
