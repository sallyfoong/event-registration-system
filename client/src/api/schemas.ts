import { z } from 'zod';

// TypeScript only guarantees "my code matches my declared types" - it has no
// idea what the backend actually returns. If registrationCount comes back as
// a string (or a gateway rewrites the response), nothing fails at compile
// time; it fails quietly at runtime when `registrationCount < capacity`
// becomes a string comparison.
//
// So this file is the second copy of the API contract - the executable one.
// Types are inferred from the schemas (z.infer), never declared twice. If
// the backend changes a field, parsing fails here immediately and names the
// field, instead of the bug surfacing through a user.

/** ISO 8601 string. Not z.string().datetime() - it's picky about timezone
 *  suffixes. "Parsable by Date" is the actual requirement and matches what
 *  the backend's toIsoString produces. */
const isoDate = z.string().refine((value) => !Number.isNaN(Date.parse(value)), {
  message: 'must be a parsable date string',
});

const uuid = z.string().uuid();

/** Admin event response. Fields mirror the documented response exactly.
 *  strict() is deliberate: if the backend sneaks in an extra internal field
 *  (say handlerUuid), this fails loudly instead of letting the frontend
 *  quietly start relying on it. */
export const adminEventSchema = z
  .object({
    uuid,
    createdAt: isoDate,
    name: z.string(),
    dateTime: isoDate,
    address: z.string(),
    deadline: isoDate,
    capacity: z.number().int().nonnegative(),
    registrationCount: z.number().int().nonnegative(),
    handler: z.object({ uuid, name: z.string() }),
  })
  .strict();

/** Public event response. Note there is deliberately no capacity / handler /
 *  registrationCount - the public API shouldn't expose those. If the backend
 *  sends them anyway, strict() fails on the spot, which turns "don't leak
 *  internal fields" into an automatic check. */
export const publicEventSchema = z
  .object({
    uuid,
    name: z.string(),
    dateTime: isoDate,
    address: z.string(),
    deadline: isoDate,
  })
  .strict();

export const handlerSchema = z.object({ uuid, name: z.string() });

// ---------------------------------------------------------------------------
// Request bodies.
//
// These describe the *shape* only, never the rules. Postal-code length,
// capacity range, deadline-before-start, duplicate names - all of that stays
// in the backend, because the backend's wording is the sentence the user ends
// up reading. Duplicating a rule here would give the frontend its own way to
// reject input, and the two would drift.
//
// What this buys: the payload type used by `events.ts`, the key set the form
// derives from it, and the object literal built on submit are all one
// declaration. Add a field to the API and the compiler points at every place
// that has to change, instead of the field quietly missing from the request.
//
// No `.strict()` here: strict on a response catches the backend leaking an
// extra field, which is a real risk. A request body is built in this process
// from a typed literal, so there is nothing to guard against.
// ---------------------------------------------------------------------------

export const createEventPayloadSchema = z.object({
  name: z.string(),
  dateTime: isoDate,
  postalCode: z.string(),
  deadline: isoDate,
  capacity: z.number().int(),
  handlerUuid: uuid,
});

export const registerPayloadSchema = z.object({
  eventUuid: uuid,
  emailAddress: z.string(),
});

/** Trend response. `date` is a bare calendar day, not a timestamp. */
export const trendPointSchema = z.object({
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be YYYY-MM-DD'),
  registrationCount: z.number().int().nonnegative(),
  newRegistrationCount: z.number().int().nonnegative(),
});

/** Registration response. The 5-digit format is part of the contract;
 *  validating it here means a backend padStart regression surfaces on the
 *  frontend immediately. */
export const registrationResultSchema = z.object({
  registrationNo: z.string().regex(/^\d{5}$/, 'registration number must be 5 digits'),
});

// List responses. Wrapped here rather than at the call site: `z.array(x)` typed
// inline in `events.ts` would be a second place where a response shape is
// declared, and the two would eventually disagree.
export const adminEventListSchema = z.object({
  total: z.number().int().nonnegative(),
  events: z.array(adminEventSchema),
});
export const handlerListSchema = z.array(handlerSchema);
export const publicEventListSchema = z.array(publicEventSchema);
export const trendPointListSchema = z.array(trendPointSchema);

// Types are inferred from the schemas, not hand-written interfaces - type
// and runtime validation can never drift apart.
export type AdminEvent = z.infer<typeof adminEventSchema>;
export type AdminEventList = z.infer<typeof adminEventListSchema>;
export type PublicEvent = z.infer<typeof publicEventSchema>;
export type Handler = z.infer<typeof handlerSchema>;
export type TrendPoint = z.infer<typeof trendPointSchema>;
export type RegistrationResult = z.infer<typeof registrationResultSchema>;
export type CreateEventPayload = z.infer<typeof createEventPayloadSchema>;
export type RegisterPayload = z.infer<typeof registerPayloadSchema>;
