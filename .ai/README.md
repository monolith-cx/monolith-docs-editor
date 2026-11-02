# Monolith Docs AI Workspace

This directory is the active home for AI operational state in this repo.

## Layout

- `registry.yml` — machine-readable initiative index
- `initiatives/active/` — in-progress initiatives
- `initiatives/planning/` — planned initiatives
- `initiatives/complete/` — completed initiatives
- `initiatives/archive/` — absorbed, superseded, or historical initiative references
- `handoffs/` — one live handoff per initiative
- `backlog.yml` — optional atomic task backlog
- `iddp/` — review and commit-gating files

## Rules

- Keep initiative execution truth in each initiative `plan.md`.
- Keep durable initiative-specific decisions in each initiative `guidance.md`.
- Use `ROADMAP.md` for the high-level human-readable summary.
- Keep `.ai/registry.yml` in sync when initiative lane, status, blockers, or parent/child relationships change.
- This workflow does not use a repo-level current file, session ledger, or repo-global handoff file.
- Initiative handoffs live under `.ai/handoffs/<initiative-id>.md` when present. Keep one current handoff per initiative, not timestamped snapshots.
- `/initiative checkpoint`, `/initiative phase-close`, and `/initiative handoff` own handoff refresh.
- Manual reviews can be triggered at any time.
- Stop coding at checkpoint boundaries and run the checkpoint review before continuing.
- Reviews follow `.ai/iddp/config.json` (since 2026-11-02): one opposing reviewer at checkpoints and phase close-outs, chosen by who implemented (`opposing_review`: Claude's work is reviewed by Codex, Codex's by Sonnet). No fallback, backup, panel, or extra frontend reviewer; any other provider only with the owner's explicit approval for that use.
- Doc sync is required before any commit and at every phase close-out. Update the initiative plan, `.ai/registry.yml`, and `ROADMAP.md` when reality changed.
- Commits always require explicit user approval. Do not auto-commit after a passing review.
- The repo does not use commit-ready stamps or approval stamp files in the active workflow.
- Do not recreate the old docs-based control-plane sprawl in this directory.
