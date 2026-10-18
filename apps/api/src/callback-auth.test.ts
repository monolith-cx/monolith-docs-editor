import jwt from 'jsonwebtoken';
import { describe, expect, it } from 'vitest';
import { checkCallback } from './callback-auth.js';

const secret = 's'.repeat(40);
const origins = ['http://onlyoffice', 'https://app.example.com'];
const body = { key: 'crm.d1.e1', status: 2, url: 'https://app.example.com/cache/files/data/x/output.docx?md5=a&expires=1', users: ['u1'], lastsave: '2026-10-18T00:00:00.000Z' };
const check = (over: Partial<Parameters<typeof checkCallback>[0]>) =>
  checkCallback({ authorization: undefined, body: { ...body }, secret, allowedUrlOrigins: origins, requireToken: true, ...over });

describe('DocumentServer callback verification (EDIT-2.4)', () => {
  it('accepts the header form whose claims wrap the body in payload (as measured, ADR F2)', () => {
    const res = check({ authorization: `Bearer ${jwt.sign({ payload: body }, secret)}` });
    expect(res).toMatchObject({ ok: true, verified: true, callback: { key: 'crm.d1.e1', status: 2, lastsave: body.lastsave } });
  });

  it('accepts a flat body token', () => {
    expect(check({ body: { ...body, token: jwt.sign(body, secret) } })).toMatchObject({ ok: true });
  });

  it('refuses a missing token when required, a wrong secret, and alg none', () => {
    expect(check({})).toMatchObject({ ok: false, reason: 'missing_token' });
    expect(check({ authorization: `Bearer ${jwt.sign({ payload: body }, 'other'.repeat(10))}` })).toMatchObject({ ok: false, reason: 'invalid_token' });
    const none = `${Buffer.from('{"alg":"none","typ":"JWT"}').toString('base64url')}.${Buffer.from(JSON.stringify({ payload: body })).toString('base64url')}.`;
    expect(check({ authorization: `Bearer ${none}` })).toMatchObject({ ok: false, reason: 'invalid_token' });
  });

  it("refuses the editor page's own config token, in either form", () => {
    const pageToken = jwt.sign({ document: { key: 'crm.d1.e1' }, editorConfig: {}, key: 'crm.d1.e1', status: 2 }, secret);
    expect(check({ authorization: `Bearer ${pageToken}` })).toMatchObject({ ok: false, reason: 'config_token' });
    expect(check({ body: { ...body, token: pageToken } })).toMatchObject({ ok: false, reason: 'config_token' });
  });

  it('refuses a body that disagrees with the signed claims', () => {
    const token = jwt.sign({ payload: body }, secret);
    const forged = { ...body, url: 'https://app.example.com/cache/files/data/other/output.docx' };
    expect(check({ authorization: `Bearer ${token}`, body: forged })).toMatchObject({ ok: false, reason: 'mismatch' });
  });

  it("refuses a save URL outside DocumentServer's origins", () => {
    const evil = { ...body, url: 'https://evil.example.com/x.docx' };
    expect(check({ authorization: `Bearer ${jwt.sign({ payload: evil }, secret)}`, body: evil })).toMatchObject({ ok: false, reason: 'bad_url_origin' });
  });

  it('accepts an unsigned callback only when a token is not required (EDITOR_ENV=local)', () => {
    expect(check({ requireToken: false })).toMatchObject({ ok: true, verified: false });
  });
});
