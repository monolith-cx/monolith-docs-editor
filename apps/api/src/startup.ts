/**
 * What stops the service from starting (E4). `server.ts` exits on any problem listed here; the
 * function is separate so the refusal itself is tested (EDIT-2 review attempt 2, Codex H1).
 */
import { config, configProblems, rawEditorEnv } from './config.js';
import { consumerProblems } from './consumers.js';

export function startupProblems(): string[] {
  return [...configProblems(config, rawEditorEnv), ...(config.strict ? consumerProblems() : [])];
}
