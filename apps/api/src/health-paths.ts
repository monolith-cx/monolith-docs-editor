/**
 * Paths of the converter probe (EDIT-6.3), shared by the route, the probe, and the auth plugin
 * without pulling the converter module into the auth plugin.
 */

/** Where DocumentServer fetches the converter probe's sample: the API's own internal origin (allow-listed, EDIT-6.2). */
export const PROBE_SAMPLE_ROUTE = '/health/converter-sample.docx';

/** The converter probe itself: loopback callers only (the host watchdog through `docker compose exec`). */
export const PROBE_ROUTE = '/health/converter';
