# AI Instructions for Claude Code

Codex is the AI team lead for this repository. Human instructions always take priority. Claude Code must follow this file.

## Current Task

Continue the RAG chatbot preparation from the current working state.

The app already has:
- `POST /api/chat` in the NestJS backend
- frontend UI that sends a question and shows the answer
- LM Studio integration through OpenAI-compatible `chat/completions`
- working local model setup with `openai/gpt-oss-20b`

## Objective

Move from the current "single-turn local AI chat" state to the next RAG-ready phase.

## Current Decisions

- Keep using LM Studio for local verification.
- Keep the backend as the only place that calls the model API.
- Keep the provider abstraction simple for now.
- Do not reintroduce heavy response sanitization unless a model regresses.
- Do not change the model unless a concrete quality issue appears.

## Files To Inspect First

- `TODO.md`
- `README.md`
- `docker-compose.yml`
- `backend/src/app.service.ts`
- `backend/src/app.controller.ts`
- `frontend/src/app/app.component.ts`
- `frontend/src/app/app.component.html`
- `frontend/src/app/app.component.css`

## What Claude Should Do Next

1. Reconfirm the current chat flow and document the remaining RAG steps.
2. Prepare the RAG design in `TODO.md` or a dedicated design note if needed.
3. Keep the current chat flow stable.
4. If code changes are needed, keep them small and focused on the next RAG step.

## Non-Goals

- Do not add unrelated UI redesigns.
- Do not add streaming.
- Do not add multi-turn conversation history yet.
- Do not switch away from the current working model without reason.
- Do not touch unrelated files.

## Verification

Report back with:
- what was inspected
- what was changed
- what remains for the next RAG phase
- any blockers or open questions

If code is changed, verify the app still responds on `POST /api/chat` after the change.
