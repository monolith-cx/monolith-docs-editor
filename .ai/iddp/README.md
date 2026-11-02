# IDDP Policy

This repo uses a lightweight Initiative-Driven Development Protocol.

## Rules

- These rules apply only to legacy initiatives not yet moved to Linear; new work follows `CLAUDE.md` § Work Tracking, and no new `.ai/` initiative is started.
- Checkpoint work stops for review before coding continues past the checkpoint boundary.
- Checkpoint and phase close-out reviews: one opposing reviewer, `codex` when Claude implemented and `sonnet` (a Claude subagent) when Codex implemented (`opposing_review` in `config.json`). No fallback, backup, panel or frontend extra reviewer: if the selected reviewer is unavailable or the review is inconclusive, stop and ask the repository owner. Any other provider only with the repository owner's explicit approval for that use.
- Doc sync is required before any commit and at every phase close-out.
- Refresh `.ai/handoffs/<initiative-id>.md` after checkpoint or phase-close doc sync, or manually via `/initiative handoff`.
- Every commit requires explicit user approval.
- Commit-ready stamps and approval stamp files are not part of the active workflow.

## Enforcement

- `scripts/validate-ai-workspace.mjs` validates the active `.ai` workspace shape.
- `.githooks/pre-commit` blocks commits when the repo regresses to the retired docs-based control plane.
