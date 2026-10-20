// Logs are the evidence you look at after something goes wrong, so "one log
// record is one line" has to hold. A newline inside a user-supplied value
// (a %0a in a query string, for instance) makes winston emit a second line
// that looks exactly like a real one - which hands anyone the ability to
// forge the record.
//
// Not using JSON.stringify for this: it would escape the newline, but the
// whole line turns into a quoted blob that is harder to read by eye. Swapping
// control characters for spaces is enough and keeps the line readable.

/** Default cap. Logs aren't storage - anything past this length is noise for
 *  debugging and just gives someone more room to stuff junk into a line. */
const MAX_LENGTH = 200;

/** Strip control characters and truncate, so anything interpolated into a log
 *  line stays on one line. */
export const logSafe = (value: unknown, maxLength: number = MAX_LENGTH): string =>
  String(value ?? '')
    // C0 control characters (\r, \n, \t included) and DEL become spaces.
    // No per-character special cases - any of them can be read as a format
    // instruction by a terminal or a log parser.
    // matching control characters is the whole point of this helper
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .slice(0, maxLength);
