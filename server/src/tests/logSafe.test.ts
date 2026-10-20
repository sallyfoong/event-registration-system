/** logSafe: the one-line guarantee for logs.
 *
 *  A newline inside user input (URL-encoded as %0a) would otherwise let an
 *  attacker write a second, perfectly convincing log line -- i.e. forge
 *  evidence. logSafe replaces C0 control characters (including \r \n \t) and
 *  DEL with spaces, then truncates, so anything it returns is one line.
 */

import request from 'supertest';

import app from '../app';
import { logSafe } from '../utils/logSafe';

const api = () => request(app);

describe('logSafe', () => {
  it('replaces a newline so the output can never span two log lines', () => {
    const output = logSafe('legit request\nFAKE 200 1ms');

    expect(output).not.toContain('\n');
    expect(output).toBe('legit request FAKE 200 1ms');
  });

  it('replaces every CRLF and tab with a space', () => {
    expect(logSafe('a\r\n\tb')).toBe('a   b');
    expect(logSafe('a\r\n\tb')).not.toMatch(/[\r\n\t]/);
  });

  it('replaces NUL and DEL characters', () => {
    expect(logSafe('\u0000payload\u007f')).toBe(' payload ');
  });

  it('truncates values longer than 200 characters', () => {
    const output = logSafe('x'.repeat(250));

    expect(output).toHaveLength(200);
    expect(output).toBe('x'.repeat(200));
  });

  it('accepts a custom maximum length', () => {
    expect(logSafe('abcdef', 3)).toBe('abc');
  });

  it('returns an empty string for null and undefined instead of throwing', () => {
    expect(logSafe(null)).toBe('');
    expect(logSafe(undefined)).toBe('');
  });

  it('stringifies numbers and objects without throwing', () => {
    expect(logSafe(42)).toBe('42');
    expect(logSafe({ a: 1 })).toBe('[object Object]');
  });

  it('sanitises after stringifying, so an object holding a newline is still one line', () => {
    expect(logSafe({ note: 'x\ny' })).not.toContain('\n');
  });
});

describe('GET /api/admin/events - hostile search input', () => {
  it('survives a URL-encoded newline in the search parameter', async () => {
    const response = await api().get('/api/admin/events?search=%0aFAKE%20LOG%20LINE');

    // A newline is a legal string for `search`, so this is a normal (empty)
    // result. The point is that it is neither a 500 nor a crashed connection.
    expect(response.status).toBe(200);
    expect(response.body.total).toBe(0);
    expect(response.body.events).toEqual([]);
  });

  it('keeps serving normal requests after the hostile one', async () => {
    await api().get('/api/admin/events?search=%0aFAKE%20LOG%20LINE').expect(200);

    const healthy = await api().get('/api/health').expect(200);
    expect(healthy.body).toEqual({ status: 'ok' });
  });
});
