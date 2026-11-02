# Plan review — udoc-editor-service — attempt 2

Date: 2026-10-16. Reviewer: Sonnet (in-session subagent, fresh context). Read-only; checked against parent UDOC-1 and D2/D7/D11/D13/D14/D16, `apps/api/src`, `infrastructure/`, `ERRORS.md`, the registry, ROADMAP, the standalone-app banner, and the Platform plan and handoff.

## Verdict: PASS-WITH-NITS (0 High, 9 Medium, 7 Nit)

## Attempt-1 findings

Resolved: H1, H2, H3, M1, M2, M4, M5, M7, M8, M9, M11, N1, N2, N4, N6, N7, N8. Partially resolved: M3 (see N-M1), M6 (N-M2), M10 (N-M4), M12 (N-N2), N3 (Track A items covered by "re-baselined"; acceptable), N5 (N-M8).

## New findings

### Medium
- **N-M1** "Panel docked right" moved from UDOC-1.2's acceptance to EDIT-5.6 without a parent amendment; reporting "UDOC-1.2 done" at EDIT-2 would be false. Propose it as an amendment or keep UDOC-1.2 open until EDIT-5.6.
- **N-M2** `deliveryId` as an HMAC of the payload collides for two real status-1 events with the same users/actions (a reconnect), breaking D13's lock re-acquire; retry-body identity is unmeasured; the consumer secret in the id changes at rotation. Measure in EDIT-1.5; scope the id to statuses 2/6 or proven-unique fields; don't key it with the consumer secret.
- **N-M3** The callback `url` origin may be DocumentServer's public origin, not its internal one; the verified JWT's shape (header form wraps the body in `payload`) is unmeasured. Record both in EDIT-1.5; accept a configured set of origins.
- **N-M4** Estimate inconsistent: the child sums to ≈4.2–5.7 while EDIT-0.3, the parent table, and the Platform handoff propose 4–5.5.
- **N-M5** No CI exists in this repo (no workflow directory; DOC-DPP's verify workflow is planned). State that the plugin-deps check is enforced by the checkpoint verification list and the planted-import test until DOC-DPP lands, recorded as a deviation from the parent's "CI check".
- **N-M6** UDOC-1.6's acceptance (a signed notification reaches CRM) needs CRM's receiver (UDOC-3.3), but UDOC-3 depends on UDOC-1: circular, so close-out can never complete. Propose: a stub receiver on the `crm-dev` network proves reachability at UDOC-1.6; CRM's receiver is proven at UDOC-3.3.
- **N-M7** EDIT-2.8's legacy check "against the dev deployment" may have no environment. Primary evidence: the battery replaying both consumers' real request bodies; the dev deployment is additional.
- **N-M8** The drain check via the command service `info` needs a key the stateless service doesn't hold. Use DocumentServer's connection statistics if proven in EDIT-1.5, otherwise a maintenance window.
- **N-M9** The plugin's origin is unspecified ("consumer hostnames" or nginx); origin checks and `frame-ancestors` need one fixed origin per environment. Pick one and add it to the guide.

### Nit
- **N-N1** Dev/staging env files must set `EDITOR_ENV=dev` and the new secrets before EDIT-2 deploys; say whether the `/files/` fixture route and HSTS follow `EDITOR_ENV`.
- **N-N2** `EDITOR_NOTIFY_SECRET_<CONSUMER_ID>` is ambiguous for hyphenated ids; let `notificationSecretRef` name the variable or define normalization.
- **N-N3** Legacy `fileUrl`: say any public https host is accepted (legacy entries have no `fileHosts`); test that a legacy-only consumer sending `profile` is refused.
- **N-N4** `auth.ts:257-269` is wrong (the public-path block is `:69-82`); `storage.ts:79` is `:80`.
- **N-N5** nginx masking should also cover `/plugins/udoc-bridge/s/`.
- **N-N6** Resolving `callbackUrl` at config load makes a DNS blip a startup failure and doesn't protect delivery; warn at load, resolve and pin per delivery.
- **N-N7** EDIT-1.5 should cover how the built-in AI tab is disabled while the bridge plugin loads (`customization.plugins:false` kills both), per-status retry behaviour for 1 and 4, and where the throwaway probe plugin lives so it never ships.

## Parent coverage

| Parent | Result |
|---|---|
| UDOC-1.1 | Pass |
| UDOC-1.2 | Partial (N-M1, N-M2, N-M3; E1 and estimate amendments pending) |
| UDOC-1.3 | Pass |
| UDOC-1.4 | Pass |
| UDOC-1.5 | Pass (N-M5, N-M9) |
| UDOC-1.6 | Partial (N-M6) |
| UDOC-1.7 | Pass |

Doc state: `ERRORS.md` entries accurate; registry, ROADMAP, banner, and Platform handoff consistent; nothing overclaimed.

## Disposition (2026-10-16)

N-N4 confirmed (`auth.ts:69-82`; `storage.ts:80`). Every Medium and Nit applied to the plan, guidance, and the parent (two further proposed amendments: the panel item's placement, N-M1, and UDOC-1.6's stub receiver, N-M6). With a PASS-WITH-NITS verdict and every item applied, plan review is complete pending Josh's approval.
