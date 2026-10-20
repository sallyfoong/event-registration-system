import request from 'supertest';

import app from '../app';
import { withRequestId } from '../config/logger';
import { currentRequestId, runWithRequestId } from '../utils/requestContext';

// The id is only useful if it survives all three hops: assigned on the way in,
// carried through the async chain, and readable on the way out. Each test
// below pins one hop.

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request id', () => {
  it('assigns one when the caller does not supply it', async () => {
    const res = await request(app).get('/api/health');

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('gives every request its own id', async () => {
    const [first, second] = await Promise.all([
      request(app).get('/api/health'),
      request(app).get('/api/health'),
    ]);

    expect(first.headers['x-request-id']).not.toBe(second.headers['x-request-id']);
  });

  it('keeps an inbound id so an existing trace stays in one piece', async () => {
    const res = await request(app).get('/api/health').set('X-Request-Id', 'trace-abc-12345');

    expect(res.headers['x-request-id']).toBe('trace-abc-12345');
  });

  it('ignores an inbound id that is not URL-safe', async () => {
    // the value ends up in log files; anything with spaces or punctuation is
    // replaced rather than trusted
    const res = await request(app).get('/api/health').set('X-Request-Id', 'not a valid id');

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('ignores an inbound id that is too short to be unique', async () => {
    const res = await request(app).get('/api/health').set('X-Request-Id', 'abc');

    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('is visible on a 404, where it is most needed', async () => {
    const res = await request(app).get('/api/does-not-exist');

    expect(res.status).toBe(404);
    expect(res.headers['x-request-id']).toMatch(UUID);
  });

  it('carries across awaits inside a request', async () => {
    // the point of AsyncLocalStorage: a service three awaits deep still sees
    // the id without being handed one
    const seen = await runWithRequestIdAsync('trace-deep-00001');
    expect(seen).toBe('trace-deep-00001');
  });

  it('is stamped onto the log record', () => {
    runWithRequestId('trace-log-00001', () => {
      const record = withRequestId().transform({ level: 'info', message: 'hello' });
      expect((record as { requestId?: string }).requestId).toBe('trace-log-00001');
    });
  });

  it('leaves the field off outside a request', () => {
    // startup and the seed script log too; they must not crash or invent an id
    const record = withRequestId().transform({ level: 'info', message: 'boot' });
    expect((record as { requestId?: string }).requestId).toBeUndefined();
    expect(currentRequestId()).toBeUndefined();
  });
});

/** Same thing runWithRequestId does, but through a promise so the async
 *  propagation is what's being tested rather than the sync call. */
const runWithRequestIdAsync = async (id: string): Promise<string | undefined> => {
  let seen: string | undefined;
  await new Promise<void>((resolve) => {
    runWithRequestId(id, () => {
      setTimeout(() => {
        seen = currentRequestId();
        resolve();
      }, 0);
    });
  });
  return seen;
};
