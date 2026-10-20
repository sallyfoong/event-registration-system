/** Runs before any test file is loaded, so the environment and the OneMap
 *  module are already in place when a test imports `app`.
 *
 *  Two things happen here.
 *
 *  1. The read cache is pinned off. The default is already 0 under
 *     NODE_ENV=test, but dotenv loads server/.env first, so a developer
 *     following the README ends up with the production value of 10000 - and
 *     a 10s cache means one test serves the previous test's rows, which
 *     looks like a pagination bug in a file that never touched pagination.
 *
 *  2. The OneMap lookup is replaced with a stub. Creating an event now
 *     requires an address OneMap returned, so a suite with no credentials
 *     could not create anything at all - and the tempting fix, letting the
 *     build fall back to a format check, would mean these tests pass only
 *     because the validation they exist to cover is switched off.
 *
 *     The stub keeps the 6-digit format check, because that rule is
 *     observable through the API and is asserted there. It does not keep the
 *     "OneMap has no such code" branch: onemapService.test.ts covers that
 *     directly against the real module, which unmocks itself.
 */
process.env.CACHE_TTL_MS = '0';

jest.mock('../services/onemapService', () => {
  const actual = jest.requireActual('../services/onemapService') as Record<string, unknown>;
  const { clientError } = jest.requireActual('../utils/errors') as {
    clientError: (message: string) => Error;
  };

  return {
    ...actual,
    resolveAddress: jest.fn(async (postalCode: string) => {
      if (!/^\d{6}$/.test(postalCode)) {
        throw clientError('Please enter a valid 6-digit Singapore postal code.');
      }
      return `TEST ADDRESS SINGAPORE ${postalCode}`;
    }),
  };
});
