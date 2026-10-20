import axios from 'axios';
import type { AxiosRequestConfig } from 'axios';
import type { z } from 'zod';

// The only layer that knows where the API lives and what its errors look like.
//
// Why axios over fetch? Four things fetch doesn't give you:
//   1. Non-2xx rejects automatically. fetch doesn't - forgetting res.ok
//      is a silent bug.
//   2. Interceptors, so headers and error mapping live in one place
//      instead of every call site.
//   3. A built-in timeout option; fetch needs a hand-rolled AbortController.
//   4. Automatic JSON (de)serialization.
// Any of these can be hand-written on top of fetch, which is exactly why
// they shouldn't be.

// Relative by default, so the browser calls the same origin that served the
// page. That is the shape production runs in (nginx serves the bundle and
// forwards /api), and it is the shape `vite dev` / `vite preview` run in too,
// because both declare an /api proxy in vite.config.ts.
//
// Why this matters beyond tidiness: the previous default was
// http://localhost:8000/api, which made every local run cross-origin and put
// the CORS allowlist in the path of a normal page load. It also meant the
// build had to be told VITE_API_BASE_URL=/api, and a value that starts with a
// slash is easy to mangle in a shell (Git Bash on Windows rewrites it into a
// filesystem path), which produces a bundle that requests
// "C:/Program Files/Git/api/..." and fails with no request on the wire at all.
// One default, no build-time flag, nothing to mangle.
//
// Still overridable: point VITE_API_BASE_URL at an absolute URL when the API
// genuinely lives on another host.
const baseURL = import.meta.env.VITE_API_BASE_URL ?? '/api';

export const apiClient = axios.create({
  baseURL,
  // 10s. The slowest backend call is OneMap (server-side timeout 8s), so 10s
  // lets the backend's own timeout fire first and return its written error
  // message, instead of the frontend giving up and showing a generic
  // "network error".
  timeout: 10_000,
});

/** Thrown when a response body doesn't match its schema.
 *  Its own class so the UI can tell it apart from "network down" or "server
 *  said no" - the first two are actionable for the user, this one is a bug. */
export class ApiContractError extends Error {
  constructor(readonly issues: string[]) {
    super('The server returned data in an unexpected shape');
    this.name = 'ApiContractError';
  }
}

/** Validates a response body against a zod schema and narrows the type.
 *  The schema determines the type, so call sites never annotate one by hand. */
export const parseResponse = <S extends z.ZodTypeAny>(schema: S, data: unknown): z.infer<S> => {
  const result = schema.safeParse(data);
  if (!result.success) {
    // Only include the failing paths and reasons in the message - never the
    // whole payload, which may contain user emails.
    const issues = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ApiContractError(issues);
  }
  return result.data;
};

// ---------------------------------------------------------------------------
// Request helpers.
//
// Why the response is read as `unknown` and never as `get<PublicEvent[]>`:
// axios' generic only asserts a type on `response.data` - it checks nothing at
// runtime. Writing the expected type there would make the zod parse look like
// a formality, when it is the only step that actually inspects the payload.
// `unknown` means "this came off the wire and cannot be touched yet"; it is
// the opposite of a lazy `any`, which would let the rest of the app use
// unvalidated data without a word of complaint.
//
// Keeping that wide type here, in three functions, means call sites never see
// it: `events.ts` reads as a list of endpoints and schemas.
// ---------------------------------------------------------------------------

/** GET + validate. */
export const getValidated = async <S extends z.ZodTypeAny>(
  path: string,
  schema: S,
  config?: AxiosRequestConfig,
): Promise<z.infer<S>> => {
  const { data } = await apiClient.get(path, config);
  return parseResponse(schema, data);
};

/** POST + validate. The body is generic rather than typed here: this layer
 *  has no opinion about what a given endpoint accepts, only that the response
 *  matches its schema. */
export const postValidated = async <S extends z.ZodTypeAny, B = undefined>(
  path: string,
  schema: S,
  body?: B,
): Promise<z.infer<S>> => {
  const { data } = await apiClient.post(path, body);
  return parseResponse(schema, data);
};

/** POST with nothing to validate - the endpoint answers 200 + null.
 *  Separate from postValidated so a missing schema reads as a decision rather
 *  than an oversight. */
export const postVoid = async <B>(path: string, body: B): Promise<void> => {
  await apiClient.post(path, body);
};

/** Shape of backend error responses. `errors` only exists on 421
 *  (field-level validation); 400 usually carries just a message.
 *
 *  Deliberately not a zod schema, unlike the success bodies: every read below
 *  is optional (`data?.message`). A parse failure here would throw while
 *  handling an error, turning "the backend said no" into "the frontend blew
 *  up" - and the one moment a lenient read matters is when the response is
 *  already not what we expected. */
interface ApiErrorBody {
  message?: string;
  errors?: Array<{ field?: string; message: string }>;
}

/** Picks one message that can be shown to the user as-is.
 *  Priority: contract error > backend message > network error > fallback.
 *  The backend message wins because it's written for the user ("This email
 *  address has already registered for the event."), while axios's own
 *  "Request failed with status code 400" means nothing to one.
 *
 *  Nothing here rewrites or maps the server's wording. The server is the only
 *  place that knows why a request failed, so it is the only place that should
 *  phrase it; duplicating the phrases in the client would guarantee that the
 *  two copies disagree after the first change. The strings below only cover
 *  the cases where no server message exists at all. */
export const extractErrorMessage = (
  error: unknown,
  fallback = 'Something went wrong. Please try again.',
): string => {
  if (error instanceof ApiContractError) {
    return 'The server returned an unexpected response. Please refresh and try again.';
  }
  if (axios.isAxiosError<ApiErrorBody>(error)) {
    const data = error.response?.data;
    if (data?.message) return data.message;
    // No response means the request never reached the backend: the user's
    // connection dropped, or the service is unavailable. Either way the useful
    // advice is "try again in a moment" - the port number and the phrase "the
    // API" belong in a developer's terminal, not on a registration page.
    if (!error.response) {
      return 'We could not reach the server. Please check your connection and try again.';
    }
  }
  // Deliberately not `return error.message`. A bare JS Error here is something
  // that went wrong inside this app - a TypeError from a malformed response, a
  // render crash surfacing through an event handler - and its message is
  // written for whoever reads the stack ("Cannot read properties of
  // undefined"), not for the person on the registration page. The fallback is
  // the only honest thing to say; the console keeps the original for us.
  return fallback;
};

/** Flattens 421 field errors into { field: message } so forms can highlight
 *  each input. Only 421 carries an errors array, so a 400 yields an empty
 *  object and the page falls back to a banner - which is right, because a
 *  business-level rejection doesn't belong to any single field. */
export const extractFieldErrors = (error: unknown): Record<string, string> => {
  if (!axios.isAxiosError<ApiErrorBody>(error)) return {};
  const result: Record<string, string> = {};
  for (const entry of error.response?.data?.errors ?? []) {
    if (entry.field) result[entry.field] = entry.message;
  }
  return result;
};

/** HTTP status. Pages occasionally need to tell validation failures (421)
 *  from business rejections (400) - e.g. 421 marks the input red, 400 only
 *  shows a banner. */
export const statusOf = (error: unknown): number | undefined =>
  axios.isAxiosError(error) ? error.response?.status : undefined;
