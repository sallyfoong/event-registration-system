import { body, param, query } from 'express-validator';

import { parseDate } from '../utils/date';

// One job only: is the shape of this field right. No database lookups, no
// business rules.
//
// The line looks fussy but it's what keeps the error codes meaningful:
//   - a check here fails     -> 421 (the value itself is malformed)
//   - a check in the service -> 400 (the value is fine, the state forbids it)
// Let the validators query the database and the two layers blur into each
// other, and the client can no longer tell "fix the format" apart from
// "that one is not allowed to do this".
//
// bail() stops the chain at the first failure. Without it an empty required
// field produces both "please enter a value" and "please enter a valid
// email", and a message under an empty box that talks about email format
// just confuses people.
//
// Wording rules for every message in this file (the client renders them
// verbatim, so this is the user's actual text, not a log line):
//   - a full sentence: capital first letter, full stop at the end;
//   - no field names in camelCase, no status codes, no "must be";
//   - no repeating the label, because each input already has a visible label
//     right above it - "Please enter a valid email address." is enough.
// The `field` that travels next to each message is a separate thing: it stays
// the raw API field name, because its only job is to tell the form which input
// to highlight.

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const POSTAL_RE = /^\d{6}$/;

/** Page ceiling. Deliberately generous - no real pagination gets near it -
 *  but it still stops the absurd. page turns into an OFFSET, and 2 billion
 *  means MySQL walks every row before returning anything, so one request
 *  can take the database down. The service imports this constant when it
 *  clamps the offset, so the limit has exactly one definition. */
export const MAX_PAGE = 1_000_000;

/** Query params for GET /api/admin/events.
 *
 *  `open` needs a word of explanation: only open=true has a defined
 *  meaning, and omitting the parameter means "show everything". open=false
 *  is therefore an undefined value, so it's rejected as malformed - and the
 *  message has to say how to get all events instead, because "only true is
 *  allowed" on its own leaves the caller stuck. */
export const listEventsValidation = [
  query('page')
    .optional()
    .toInt()
    .isInt({ min: 1, max: MAX_PAGE })
    .withMessage(`The page number needs to be between 1 and ${MAX_PAGE}.`),
  query('search')
    .optional()
    .isString()
    .trim()
    .isLength({ max: 100 })
    .withMessage('The search text cannot be longer than 100 characters.'),
  query('open')
    .optional()
    .custom((value) => {
      // An empty value counts as "not sent" - ?open= arrives as an empty string
      if (value === undefined || value === null || value === '') return true;
      return value === 'true' || value === '1' || value === true || value === 1;
    })
    .withMessage('This filter only accepts the value true. Leave it out to list all events.'),
];

/** Body for POST /api/admin/events.
 *  dateTime and deadline are only checked for "parses as a date" here.
 *  "the deadline has to be before the event starts" is a cross-field rule and
 *  lives in the service. */
export const createEventValidation = [
  body('name')
    .exists({ checkFalsy: true })
    .withMessage('Please enter a name for the event.')
    .bail()
    .isString()
    .withMessage('Please enter the event name as text.')
    .bail()
    .trim()
    .isLength({ min: 1, max: 255 })
    .withMessage('The event name needs to be between 1 and 255 characters.'),
  body('dateTime')
    .exists({ checkFalsy: true })
    .withMessage('Please choose when the event starts.')
    .bail()
    // Reuse the parser from utils/date so "passes validation" and "can be
    // processed later" mean the same thing. With isISO8601() here, a client
    // sending "2026-12-24 14:00" would pass validation and blow up in the
    // service.
    .custom((value) => parseDate(value) !== null)
    .withMessage('Please choose a valid date and time for the event.'),
  body('postalCode')
    .exists({ checkFalsy: true })
    .withMessage('Please enter the postal code of the venue.')
    .bail()
    .isString()
    .trim()
    .matches(POSTAL_RE)
    .withMessage('Please enter a 6-digit Singapore postal code.'),
  body('deadline')
    .exists({ checkFalsy: true })
    .withMessage('Please choose when registration closes.')
    .bail()
    .custom((value) => parseDate(value) !== null)
    .withMessage('Please choose a valid date and time for the registration deadline.'),
  body('capacity')
    .exists({ checkFalsy: true })
    .withMessage('Please enter how many places are available.')
    .bail()
    // Capped at 99999: registration numbers are five digits (00001), so at
    // 100000 the hundred-thousandth registration would be handed "100000"
    // and the format breaks.
    .isInt({ min: 1, max: 99999 })
    .withMessage(
      'Please enter a whole number for the capacity between 1 and 99999. Registration numbers have 5 digits, so a larger capacity is not supported.',
    )
    // toInt is a sanitizer: once validation passes, "50" becomes 50 and the
    // service gets a number instead of parsing it again
    .toInt(),
  body('handlerUuid')
    .exists({ checkFalsy: true })
    .withMessage('Please choose a handler.')
    .bail()
    .isString()
    .trim()
    .matches(UUID_RE)
    .withMessage('That handler is not a valid choice. Please pick one from the list.'),
];

/** Body for POST /api/public/register. */
export const registerValidation = [
  body('eventUuid')
    .exists({ checkFalsy: true })
    .withMessage('Please choose an event.')
    .bail()
    .isString()
    .trim()
    .matches(UUID_RE)
    .withMessage('That event is not a valid choice. Please pick one from the list.'),
  body('emailAddress')
    .exists({ checkFalsy: true })
    .withMessage('Please enter your email address.')
    .bail()
    // The trim cleans the HTTP boundary: phone keyboards leave a trailing
    // space, and without it isEmail rejects a perfectly good address.
    // What counts as "the same email" (lowercasing) belongs to normaliseEmail
    // in the service - one job tidies what came in, the other defines the
    // canonical form, so they aren't duplicates of each other.
    .isString()
    .trim()
    // After trimming, a field that was only spaces is empty again - and
    // "enter a valid email address" is the wrong thing to say about a box
    // the user left blank. exists({checkFalsy}) above cannot catch this:
    // " " is truthy.
    .notEmpty()
    .withMessage('Please enter your email address.')
    .bail()
    .isEmail()
    .withMessage('Please enter a valid email address, for example name@example.com.')
    .isLength({ max: 255 })
    .withMessage('Please use an email address no longer than 255 characters.'),
];

/** The :uuid path param, shared by the detail and trend endpoints.
 *  Checking it here means a malformed uuid is a 421 instead of a pointless
 *  trip to the database. */
export const eventUuidParamValidation = [
  param('uuid')
    .trim()
    .matches(UUID_RE)
    .withMessage('This event link is not valid. Please choose an event from the list.'),
];
