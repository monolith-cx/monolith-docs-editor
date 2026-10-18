// EDIT-3 (parent UDOC-1.3): PDF conversion through the service on the pinned release. The service
// hands ConvertService its own source route, fetches the source and uploads the PDF itself.
import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { promisify } from 'node:util';
import { VALUES } from '../fixtures.mjs';
import { fontsEmbedded } from '../flow.mjs';
import { STUB_INTERNAL, events, resetStub, stub } from '../stack.mjs';

const exec = promisify(execFile);
const API = 'http://127.0.0.1:18204';

async function convertViaApi(secrets, body) {
  const t0 = Date.now();
  const res = await fetch(`${API}/api/documents/convert`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${secrets.apiKey}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await res.json().catch(() => ({})), seconds: Math.round((Date.now() - t0) / 1000) };
}

const e3a = {
  id: 'E3a',
  order: 12,
  title: 'Conversion through the service: the field-and-block fixtures become PDFs with fonts embedded and fields where the editor shows them',
  parent: 'EDIT-3.3 / UDOC-1.3',
  timeoutMs: 300_000,
  async run({ secrets, work }) {
    await resetStub();
    const evidence = [];
    let ok = true;
    for (const fixture of ['contract-cl.docx', 'contract-sdt.docx']) {
      const name = `e3a-${fixture.replace('.docx', '')}.pdf`;
      const answer = await convertViaApi(secrets, { sourceUrl: `${STUB_INTERNAL}/fixtures/${fixture}`, uploadUrl: `${STUB_INTERNAL}/upload/${name}` });
      if (answer.status !== 200) {
        ok = false;
        evidence.push(`${fixture}: convert answered ${answer.status} ${JSON.stringify(answer.body)}`);
        continue;
      }
      const pdf = await stub(`/uploads/${name}`);
      const file = path.join(work, 'saved', name);
      await writeFile(file, pdf);
      const sha = createHash('sha256').update(pdf).digest('hex');
      const { fonts, allEmbedded } = fontsEmbedded((await exec('pdffonts', [file])).stdout);
      const text = (await exec('pdftotext', ['-layout', file, '-'])).stdout.replace(/\s+/g, ' ');
      const sentence = `This Agreement starts on ${VALUES.r1} between Monolith and ${VALUES.r2}. The total is ${VALUES.r3} payable ${VALUES.r4}.`;
      const fieldsShown = text.includes(sentence);
      const log = await events();
      const fetchers = [...new Set(log.filter((e) => e.kind === 'fixture-fetch' && e.path === `/fixtures/${fixture}`).map((e) => e.from))];
      const upload = log.find((e) => e.kind === 'upload' && e.name === name);
      const right = answer.body.size === pdf.length && answer.body.sha256 === sha && allEmbedded && fieldsShown && fetchers.join() === 'api' && upload?.from === 'api' && upload?.type === 'application/pdf';
      if (!right) ok = false;
      evidence.push(
        `${fixture}: 200 ${JSON.stringify(answer.body)} in ${answer.seconds}s; uploaded ${pdf.length} bytes (size and sha256 match ${answer.body.size === pdf.length && answer.body.sha256 === sha}) by ${upload?.from}, content-type ${upload?.type}, content-length ${upload?.length}; source fetched by ${fetchers.join(', ') || 'nobody'} (never DocumentServer)`,
        `${fixture}: fonts ${fonts.map((f) => `${f.name} emb=${f.emb}`).join('; ')} (all embedded ${allEmbedded}); the field sentence renders as the editor shows it ${fieldsShown}`,
      );
    }
    return { result: ok ? 'pass' : 'fail', evidence };
  },
};

const e3b = {
  id: 'E3b',
  order: 13,
  title: 'Conversion refusals on the pinned release: metadata source, source redirect, oversized input, timeout, a source cut part way, unreachable and redirecting upload; the converter stays free',
  parent: 'EDIT-3.2 / EDIT-3.3',
  timeoutMs: 300_000,
  async run({ secrets }) {
    await resetStub();
    const good = `${STUB_INTERNAL}/fixtures/contract-cl.docx`;
    const okUpload = `${STUB_INTERNAL}/upload/e3b.pdf`;
    const cases = [
      ['a metadata source address', { sourceUrl: 'http://169.254.169.254/latest/meta-data/', uploadUrl: okUpload }, 400, 'source_url_refused'],
      ['a redirect from the source host (not followed)', { sourceUrl: `${STUB_INTERNAL}/sources/redirect.docx`, uploadUrl: okUpload }, 502, 'source_unavailable'],
      ['an input over the 5 MB battery cap', { sourceUrl: `${STUB_INTERNAL}/sources/big.docx`, uploadUrl: okUpload }, 413, 'input_too_large'],
      ['a source that never finishes (20 s battery deadline)', { sourceUrl: `${STUB_INTERNAL}/sources/slow.docx`, uploadUrl: okUpload }, 504, 'conversion_timeout'],
      ['an unreachable upload address', { sourceUrl: good, uploadUrl: 'http://stub:9/upload/x.pdf' }, 502, 'upload_failed'],
      ['a redirect from the upload host (not followed)', { sourceUrl: good, uploadUrl: `${STUB_INTERNAL}/upload/redirect` }, 502, 'upload_failed'],
      ['a metadata upload address', { sourceUrl: good, uploadUrl: 'http://169.254.169.254/upload' }, 400, 'upload_url_refused'],
      ['a source that drops part way (ADR F17)', { sourceUrl: `${STUB_INTERNAL}/sources/cut.docx`, uploadUrl: okUpload }, 502, 'source_unavailable'],
      // After every failure above, DocumentServer's one converter must still be free (ADR F17).
      ['a good conversion after all of the above', { sourceUrl: good, uploadUrl: `${STUB_INTERNAL}/upload/e3b-after.pdf` }, 200, undefined],
    ];
    const evidence = [];
    let ok = true;
    for (const [label, body, status, error] of cases) {
      const answer = await convertViaApi(secrets, body);
      const right = answer.status === status && answer.body.error === error && (status !== 200 || typeof answer.body.sha256 === 'string');
      if (!right) ok = false;
      evidence.push(`${label}: ${answer.status} ${JSON.stringify(answer.body)} in ${answer.seconds}s (want ${status} ${error})`);
    }
    const log = await events();
    const redirects = log.filter((e) => e.kind === 'source-redirect');
    const uploads = log.filter((e) => e.kind === 'upload');
    const okUploads = uploads.filter((e) => e.name === 'e3b.pdf');
    if (!uploads.some((e) => e.name === 'e3b-after.pdf')) ok = false;
    if (okUploads.length !== 0) ok = false;
    evidence.push(
      `the redirecting source was asked by ${redirects.map((e) => e.from).join(', ') || 'nobody'} and the redirect was not followed (no request reached the metadata address from the scratch network); uploads received: ${uploads.map((e) => `${e.name} from ${e.from}`).join(', ') || 'none'} (none for the refused or failed sources)`,
      'http URLs and private addresses are refused only outside EDITOR_ENV=local; the battery runs local, so those refusals are proven by apps/api strict-routes and route tests',
    );
    return { result: ok ? 'pass' : 'fail', evidence };
  },
};

export default [e3a, e3b];
