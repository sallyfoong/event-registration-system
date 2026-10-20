import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Loader2 } from 'lucide-react';

import { useCreateEvent, useHandlers } from '@/api/queries';
import type { CreateEventPayload } from '@/api/schemas';
import { extractErrorMessage, extractFieldErrors } from '@/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Create-event form.
//
// What actually matters here isn't the layout - it's where errors show up.
//
// The backend returns two kinds of errors and conflating them misleads
// users:
//   421 (field problem) -> red text under the offending input; fixing that
//                          field is all the user needs to do
//   400 (business rule) -> banner at the top; no single field is at fault
//
// E.g. "this handler is already running an open event" marked under the
// handler field reads like a bad selection, when actually the fix is to pick a
// different person or close the other event first. An error message can only
// guide action if it appears in the right place.

/** Every value is held as a string while the user is typing - capacity in
 *  particular must be able to be empty, which a number cannot represent.
 *
 *  The key set is derived from the request body type rather than listed by
 *  hand. Adding a field to the API now breaks this type and the payload
 *  literal below, so the new field cannot be silently left out of the
 *  request; a hand-written list would just quietly stay short. */
type FormState = Record<keyof CreateEventPayload, string>;

const EMPTY_FORM: FormState = {
  name: '',
  dateTime: '',
  postalCode: '',
  deadline: '',
  capacity: '',
  handlerUuid: '',
};

/** Shell for one form field: label + control + error/hint.
 *  Six fields each repeating this JSX means six chances to place the error
 *  message inconsistently. */
const Field = ({
  id,
  label,
  error,
  hint,
  children,
}: {
  id: string;
  label: string;
  // Explicit | undefined because tsconfig enables exactOptionalPropertyTypes,
  // under which error?: string rejects an explicit undefined.
  error?: string | undefined;
  hint?: string | undefined;
  children: React.ReactNode;
}) => (
  <div className="space-y-1.5">
    <Label htmlFor={id}>{label}</Label>
    {children}
    {error ? (
      // role="alert" so screen readers announce it immediately, no focus
      // change needed.
      <p role="alert" className="text-xs font-medium text-destructive">
        {error}
      </p>
    ) : hint ? (
      <p className="text-xs text-muted-foreground">{hint}</p>
    ) : null}
  </div>
);

const CreateEventPage = () => {
  const navigate = useNavigate();
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [localError, setLocalError] = useState<string | null>(null);

  const handlersQuery = useHandlers();
  const createEvent = useCreateEvent();

  // Field errors come from the 421 errors array; on 400 this is empty and
  // the top banner is the only channel.
  const fieldErrors = extractFieldErrors(createEvent.error);
  // Server message first, verbatim; the fallback only covers a response with
  // no message of its own.
  const banner = createEvent.error
    ? extractErrorMessage(createEvent.error, 'The event could not be created. Please try again.')
    : localError;

  /** Generic field updater. K ties the key and value types together, so a
   *  wrong field name or value type fails at compile time.
   *  Functional setForm instead of spreading the current `form` avoids
   *  reading a stale snapshot during rapid typing. */
  const update = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((previous) => ({ ...previous, [key]: value }));
    // Every message on this page describes the payload as it was submitted.
    // Once a field changes, that description refers to values no longer on
    // screen: leaving it up means the form argues with what the user is
    // looking at, and a corrected field still wears a red banner. Clearing on
    // the first keystroke is also what makes the error feel responsive rather
    // than sticky.
    if (createEvent.error) createEvent.reset();
    if (localError) setLocalError(null);
  };

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setLocalError(null);

    // Only guard "required field empty" here, no business rules. The guard
    // must exist because new Date('').toISOString() below throws a
    // RangeError and the request never goes out. Business rules (the deadline
    // has to be before the event time, one open event per handler) live only
    // in the backend, so there's exactly one implementation to maintain.
    const missing = Object.values(form).some((value) => value.trim() === '');
    if (missing) {
      setLocalError('Please fill in every field before submitting.');
      return;
    }

    // The literal below is checked against CreateEventPayload, so a field
    // added to the API shows up here as a compile error rather than as a
    // request that quietly omits it.
    createEvent.mutate(
      {
        name: form.name.trim(),
        // datetime-local yields "2026-12-24T14:00" with no timezone.
        // new Date() parses it in the browser's local zone, toISOString()
        // converts to UTC - the backend receives an unambiguous ISO string
        // with a Z suffix.
        dateTime: new Date(form.dateTime).toISOString(),
        postalCode: form.postalCode.trim(),
        deadline: new Date(form.deadline).toISOString(),
        capacity: Number.parseInt(form.capacity, 10),
        handlerUuid: form.handlerUuid,
      },
      {
        // Navigate back with the message in route state, not a URL param -
        // a param would survive refreshes and ride along in shared links.
        onSuccess: () =>
          navigate('/admin', { state: { successMessage: `Event "${form.name}" was created.` } }),
      },
    );
  };

  const submitting = createEvent.isPending;
  const handlers = handlersQuery.data ?? [];

  return (
    <div className="mx-auto max-w-xl space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Add New Event</h1>

      {banner && <Alert variant="destructive">{banner}</Alert>}

      <Card className="p-6">
        {/* noValidate turns off the browser's native HTML5 validation
            bubbles: unstyleable, untranslatable, and when their rules differ
            from the backend's you get the split experience of the browser
            passing what the backend rejects. One set of rules, in the
            backend. */}
        <form onSubmit={handleSubmit} noValidate className="space-y-5">
          {/* Single column on purpose: one breakpoint to maintain, and it
              reads the same on mobile instead of collapsing back from a
              multi-column grid. */}
          <Field
            id="name"
            label="Name"
            error={fieldErrors.name}
            hint="Must be unique across all events."
          >
            <Input
              id="name"
              value={form.name}
              aria-invalid={Boolean(fieldErrors.name)}
              onChange={(event) => update('name', event.target.value)}
            />
          </Field>

          <Field id="dateTime" label="Event Date Time" error={fieldErrors.dateTime}>
            <Input
              id="dateTime"
              type="datetime-local"
              value={form.dateTime}
              aria-invalid={Boolean(fieldErrors.dateTime)}
              onChange={(event) => update('dateTime', event.target.value)}
            />
          </Field>

          <Field
            id="postalCode"
            label="Postal Code"
            error={fieldErrors.postalCode}
            hint="6 digits, validated via OneMap."
          >
            <Input
              id="postalCode"
              inputMode="numeric"
              maxLength={6}
              value={form.postalCode}
              aria-invalid={Boolean(fieldErrors.postalCode)}
              onChange={(event) => update('postalCode', event.target.value)}
            />
          </Field>

          <Field
            id="deadline"
            label="Registration Deadline"
            error={fieldErrors.deadline}
            hint="Choose a time before the event starts."
          >
            <Input
              id="deadline"
              type="datetime-local"
              value={form.deadline}
              aria-invalid={Boolean(fieldErrors.deadline)}
              onChange={(event) => update('deadline', event.target.value)}
            />
          </Field>

          <Field id="capacity" label="Capacity" error={fieldErrors.capacity} hint="1–99999.">
            <Input
              id="capacity"
              type="number"
              min={1}
              max={99999}
              value={form.capacity}
              aria-invalid={Boolean(fieldErrors.capacity)}
              onChange={(event) => update('capacity', event.target.value)}
            />
          </Field>

          <Field
            id="handlerUuid"
            label="Handler"
            error={fieldErrors.handlerUuid}
            hint="Each handler can run at most 1 open event."
          >
            <Select
              value={form.handlerUuid}
              onValueChange={(value) => update('handlerUuid', value)}
            >
              <SelectTrigger id="handlerUuid" aria-invalid={Boolean(fieldErrors.handlerUuid)}>
                <SelectValue
                  placeholder={handlersQuery.isPending ? 'Loading…' : 'Select a handler'}
                />
              </SelectTrigger>
              <SelectContent>
                {/* Nothing seeded yet - show a disabled hint item instead of
                    an empty list that does nothing when clicked. */}
                {handlers.length === 0 ? (
                  <SelectItem value="__none" disabled>
                    No handlers seeded
                  </SelectItem>
                ) : (
                  handlers.map((handler) => (
                    <SelectItem key={handler.uuid} value={handler.uuid}>
                      {handler.name}
                    </SelectItem>
                  ))
                )}
              </SelectContent>
            </Select>
          </Field>

          <div className="flex justify-end gap-2 border-t pt-4">
            <Button asChild variant="ghost">
              <Link to="/admin">Cancel</Link>
            </Button>
            {/* Both buttons disabled while submitting so a double click
                cannot fire two requests. The second one would now be rejected
                by the unique index, but the user would still see a failure
                banner for something they did once. Cheaper to prevent at the
                source. */}
            <Button type="submit" disabled={submitting}>
              {submitting && <Loader2 className="h-4 w-4 animate-spin" />}
              {submitting ? 'Adding…' : 'Add Event'}
            </Button>
          </div>
        </form>
      </Card>
    </div>
  );
};

export default CreateEventPage;
