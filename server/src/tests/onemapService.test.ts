/** Unit tests for the OneMap client. axios is fully mocked so no network call
 *  is ever made. The module keeps a token cache at module scope, therefore each
 *  test re-requires the service to get a clean cache.
 *
 *  setupFiles stubs resolveAddress for the API-level suites; this file is the
 *  one place that exercises the real thing, so it undoes that stub. */

// The stub exists so other suites can create events without a third party.
// Here the real module is the subject.
jest.unmock('../services/onemapService');

interface AxiosHolder {
  get: jest.Mock;
  post: jest.Mock;
}

jest.mock('axios', () => {
  const holder: { get?: jest.Mock; post?: jest.Mock } = {};
  (global as any).__axiosHolder = holder;
  return {
    __esModule: true,
    default: {
      // the service uses this to tell a 401 apart from a timeout
      isAxiosError: (error: unknown) =>
        Boolean((error as { isAxiosError?: boolean })?.isAxiosError),
      create: () => ({
        // Delegates at call time so tests can swap the mock after module load.
        get: (...args: unknown[]) => holder.get!(...args),
        post: (...args: unknown[]) => holder.post!(...args),
      }),
    },
  };
});

type Service = typeof import('../services/onemapService');

const originalEnv = { ...process.env };

const loadService = async (): Promise<{ service: Service; axios: AxiosHolder }> => {
  jest.resetModules();
  const service = require('../services/onemapService') as Service;
  const holder = (global as any).__axiosHolder as AxiosHolder;
  holder.get = jest.fn();
  holder.post = jest.fn();
  return { service, axios: holder };
};

beforeEach(() => {
  process.env.ONEMAP_TOKEN = '';
  process.env.ONEMAP_EMAIL = '';
  process.env.ONEMAP_PASSWORD = '';
});

afterAll(() => {
  process.env = { ...originalEnv };
});

describe('isOneMapConfigured', () => {
  it('is false when credentials are missing', async () => {
    const { service } = await loadService();
    expect(service.isOneMapConfigured()).toBe(false);
  });

  it('is true when both email and password are present', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service } = await loadService();
    expect(service.isOneMapConfigured()).toBe(true);
  });

  it('is true with a pre-issued token and no account', async () => {
    process.env.ONEMAP_TOKEN = 'header.payload.signature';
    const { service } = await loadService();
    expect(service.isOneMapConfigured()).toBe(true);
  });
});

describe('tokenExpiryMs', () => {
  const withPayload = (payload: object): string =>
    `header.${Buffer.from(JSON.stringify(payload)).toString('base64url')}.signature`;

  it('reads exp out of the payload', async () => {
    const { service } = await loadService();
    expect(service.tokenExpiryMs(withPayload({ exp: 1_800_000_000 }))).toBe(1_800_000_000_000);
  });

  it('returns null when there is no exp or the payload is not JSON', async () => {
    const { service } = await loadService();
    expect(service.tokenExpiryMs('header.not-json.signature')).toBeNull();
    expect(service.tokenExpiryMs('no-dots')).toBeNull();
  });
});

describe('lookupAddressByPostalCode', () => {
  it('throws instead of answering when OneMap is not configured', async () => {
    const { service, axios } = await loadService();
    await expect(service.lookupAddressByPostalCode('123456')).rejects.toThrow(/not configured/i);
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('authenticates, searches, and returns the first address', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service, axios } = await loadService();

    axios.post.mockResolvedValueOnce({ data: { access_token: 'tok-123' } });
    axios.get.mockResolvedValueOnce({
      data: {
        found: 1,
        results: [{ ADDRESS: '10 PASIR PANJANG CENTRAL', POSTAL: '117440' }],
      },
    });

    await expect(service.lookupAddressByPostalCode('117440')).resolves.toEqual({
      address: '10 PASIR PANJANG CENTRAL',
      postalCode: '117440',
    });

    expect(axios.post).toHaveBeenCalledWith('/api/auth/post/getLoginToken', {
      email: 'demo@onemap.gov.sg',
      password: 'secret',
    });
    expect(axios.get).toHaveBeenCalledWith(
      '/api/common/elastic/search',
      expect.objectContaining({ headers: { Authorization: 'Bearer tok-123' } }),
    );
  });

  it('caches the access token and reuses it on the next lookup', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service, axios } = await loadService();

    axios.post.mockResolvedValue({ data: { access_token: 'tok-cached' } });
    axios.get.mockResolvedValue({ data: { results: [{ ADDRESS: 'A', POSTAL: '123456' }] } });

    await service.lookupAddressByPostalCode('123456');
    await service.lookupAddressByPostalCode('123456');

    expect(axios.post).toHaveBeenCalledTimes(1);
    expect(axios.get).toHaveBeenCalledTimes(2);
  });

  it('falls back to the requested postal when the result omits POSTAL', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service, axios } = await loadService();

    axios.post.mockResolvedValueOnce({ data: { access_token: 'tok' } });
    axios.get.mockResolvedValueOnce({ data: { results: [{ ADDRESS: 'Somewhere' }] } });

    await expect(service.lookupAddressByPostalCode('654321')).resolves.toEqual({
      address: 'Somewhere',
      postalCode: '654321',
    });
  });

  it('returns null when OneMap finds no matching result', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service, axios } = await loadService();

    axios.post.mockResolvedValueOnce({ data: { access_token: 'tok' } });
    axios.get.mockResolvedValueOnce({ data: { found: 0, results: [] } });

    await expect(service.lookupAddressByPostalCode('000000')).resolves.toBeNull();
  });

  it('returns null when the result entry carries no ADDRESS field', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service, axios } = await loadService();

    axios.post.mockResolvedValueOnce({ data: { access_token: 'tok' } });
    axios.get.mockResolvedValueOnce({ data: { results: [{ BLK_NO: '1' }] } });

    await expect(service.lookupAddressByPostalCode('123456')).resolves.toBeNull();
  });

  it('throws when the auth response carries no access token', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service, axios } = await loadService();

    axios.post.mockResolvedValueOnce({ data: {} });

    await expect(service.lookupAddressByPostalCode('123456')).rejects.toThrow(
      /did not contain an access token/i,
    );
  });

  it('uses a pre-issued token without logging in', async () => {
    process.env.ONEMAP_TOKEN = 'pre.issued.token';
    const { service, axios } = await loadService();

    axios.get.mockResolvedValueOnce({ data: { results: [{ ADDRESS: '1 BISHAN ST' }] } });

    await expect(service.lookupAddressByPostalCode('579768')).resolves.toEqual({
      address: '1 BISHAN ST',
      postalCode: '579768',
    });
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).toHaveBeenCalledWith(
      '/api/common/elastic/search',
      expect.objectContaining({ headers: { Authorization: 'Bearer pre.issued.token' } }),
    );
  });

  it('logs in again when OneMap rejects the cached token', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service, axios } = await loadService();

    const unauthorized = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      response: { status: 401 },
    });
    axios.post.mockResolvedValueOnce({ data: { access_token: 'stale' } });
    axios.get.mockRejectedValueOnce(unauthorized);
    axios.post.mockResolvedValueOnce({ data: { access_token: 'fresh' } });
    axios.get.mockResolvedValueOnce({ data: { results: [{ ADDRESS: '1 BISHAN ST' }] } });

    await expect(service.lookupAddressByPostalCode('579768')).resolves.toEqual({
      address: '1 BISHAN ST',
      postalCode: '579768',
    });
    expect(axios.post).toHaveBeenCalledTimes(2);
    expect(axios.get).toHaveBeenLastCalledWith(
      '/api/common/elastic/search',
      expect.objectContaining({ headers: { Authorization: 'Bearer fresh' } }),
    );
  });

  it('does not retry a rejected pre-issued token, because there is nothing to log in with', async () => {
    process.env.ONEMAP_TOKEN = 'pre.issued.token';
    const { service, axios } = await loadService();

    const unauthorized = Object.assign(new Error('Request failed with status code 401'), {
      isAxiosError: true,
      response: { status: 401 },
    });
    axios.get.mockRejectedValueOnce(unauthorized);

    await expect(service.lookupAddressByPostalCode('579768')).rejects.toThrow(/401/);
    expect(axios.get).toHaveBeenCalledTimes(1);
  });

  it('treats a token complaint in an empty response as "no such code"', async () => {
    // OneMap attaches "Invalid authentication token" to responses that carry
    // perfectly good results, so the message cannot be trusted. Only the
    // result set decides.
    process.env.ONEMAP_TOKEN = 'pre.issued.token';
    const { service, axios } = await loadService();

    axios.get.mockResolvedValueOnce({
      data: { found: 0, results: [], error: 'Invalid authentication token.' },
    });

    await expect(service.lookupAddressByPostalCode('999999')).resolves.toBeNull();
  });
});

describe('resolveAddress', () => {
  it('returns the OneMap address with source "onemap" on success', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service, axios } = await loadService();

    axios.post.mockResolvedValueOnce({ data: { access_token: 'tok' } });
    axios.get.mockResolvedValueOnce({
      data: { results: [{ ADDRESS: '1 BISHAN ST', POSTAL: '579768' }] },
    });

    await expect(service.resolveAddress('579768')).resolves.toBe('1 BISHAN ST');
  });

  it('rejects a postal code OneMap does not know, pinned to the field', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service, axios } = await loadService();

    axios.post.mockResolvedValueOnce({ data: { access_token: 'tok' } });
    axios.get.mockResolvedValueOnce({ data: { found: 0, results: [] } });

    await expect(service.resolveAddress('123456')).rejects.toMatchObject({
      status: 421,
      details: [{ field: 'postalCode', message: expect.stringMatching(/could not find/i) }],
    });
  });

  it('refuses the request instead of inventing an address when OneMap is down', async () => {
    process.env.ONEMAP_EMAIL = 'demo@onemap.gov.sg';
    process.env.ONEMAP_PASSWORD = 'secret';
    const { service, axios } = await loadService();

    axios.post.mockRejectedValueOnce(new Error('ECONNREFUSED'));

    await expect(service.resolveAddress('123456')).rejects.toMatchObject({
      status: 500,
      message: expect.stringMatching(/could not check this postal code/i),
    });
  });

  it('refuses to create an event when OneMap is not configured', async () => {
    const { service, axios } = await loadService();
    await expect(service.resolveAddress('123456')).rejects.toMatchObject({
      status: 500,
      message: expect.stringMatching(/could not verify this postal code/i),
    });
    expect(axios.post).not.toHaveBeenCalled();
    expect(axios.get).not.toHaveBeenCalled();
  });

  it('rejects a malformed postal code before looking at the configuration', async () => {
    const { service } = await loadService();
    await expect(service.resolveAddress('12AB56')).rejects.toMatchObject({
      status: 400,
      message: expect.stringMatching(/6-digit Singapore postal code/i),
    });
  });

  it('rejects a too-short postal code', async () => {
    const { service } = await loadService();
    await expect(service.resolveAddress('12345')).rejects.toThrow(/6-digit Singapore postal code/i);
  });
});
