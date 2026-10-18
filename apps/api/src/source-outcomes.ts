/**
 * What the source route did for a conversion's source fetch (EDIT-3), and a way to stop it.
 * DocumentServer only reports "download failed" (-4) when the source route refuses or cuts a
 * fetch, so the route records why under the conversion's id, and the conversion turns that into its
 * named error. When a conversion ends for any reason it aborts its source fetch, so DocumentServer's
 * download fails at once and its converter is free for the next request (found by battery E3b: a
 * timed-out conversion's source kept DocumentServer busy and queued the conversions after it).
 *
 * In-process and short-lived: an entry exists only while its conversion request is running (one API
 * instance per environment, as the rate limiter already requires).
 */
export type SourceOutcome = 'served' | 'refused' | 'too_large' | 'unavailable' | 'busy';

interface Slot {
  outcome: SourceOutcome | 'pending';
  abort: AbortController;
}

const slots = new Map<string, Slot>();

/** Opens a slot for a conversion; only an open slot accepts an outcome or hands out a signal. */
export function expectSource(id: string): void {
  slots.set(id, { outcome: 'pending', abort: new AbortController() });
}

/** Whether a conversion is still running: its source token is admitted only then. */
export function sourceActive(id: string): boolean {
  return slots.has(id);
}

/** The signal that stops the source fetch of a running conversion; undefined for anything else. */
export function sourceSignal(id: string | undefined): AbortSignal | undefined {
  return id ? slots.get(id)?.abort.signal : undefined;
}

export function recordSource(id: string | undefined, outcome: SourceOutcome): void {
  const slot = id ? slots.get(id) : undefined;
  if (slot) slot.outcome = outcome;
}

/** Reads a conversion's outcome so far. */
export function peekSource(id: string): SourceOutcome | 'pending' | undefined {
  return slots.get(id)?.outcome;
}

/** Ends a conversion's slot: aborts its source fetch if one is running, and forgets it. */
export function endSource(id: string): void {
  slots.get(id)?.abort.abort();
  slots.delete(id);
}
