# Monolith Docs AI Workspace

This directory holds the legacy initiatives that have not yet moved to Linear. Maintainers track new work in Linear and outside contributors use GitHub issues and pull requests (`CLAUDE.md` § Work Tracking); never start a new initiative here. A moved initiative stays here as frozen history.

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
- Reviews follow `iddp/config.json`: one opposing reviewer at checkpoints and phase close-outs, `codex` when Claude implemented and `sonnet` (a Claude subagent) when Codex implemented. No fallback, backup, panel or frontend extra reviewer; if the reviewer is unavailable or the review is inconclusive, stop and ask the repository owner. Any other provider only with the repository owner's explicit approval for that use.
- Doc sync is required before any commit and at every phase close-out. Update the initiative plan, `.ai/registry.yml`, and `ROADMAP.md` when reality changed.
- Commits always require explicit user approval. Do not auto-commit after a passing review.
- The repo does not use commit-ready stamps or approval stamp files in the active workflow.
- Do not recreate the old docs-based control-plane sprawl in this directory.
