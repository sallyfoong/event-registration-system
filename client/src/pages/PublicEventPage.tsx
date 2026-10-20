import { useState } from 'react';
import { CheckCircle2, Loader2 } from 'lucide-react';

import { usePublicEvents, useRegisterForEvent } from '@/api/queries';
import { extractErrorMessage, extractFieldErrors } from '@/api/client';
import { formatDateLong, formatDateTimeLong } from '@/utils/format';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

// Public page: pick an open event from the dropdown, review the details,
// register with an email; on success a centered thank-you screen.
//
// Three states must render distinctly, never merged:
//   loading            -> skeleton
//   no open events     -> an explicit message
//   has data           -> the form
// Rendering "no events" as an empty dropdown makes the page look broken.
//
// Also: the selected event is derived from the data, not synced with
// useState + useEffect. The sync approach left the dropdown showing nothing
// whenever the selected uuid dropped off the list (e.g. the event just
// filled up and refreshed); deriving falls back automatically and there's
// no dangling state to get stuck in.

const PublicEventPage = () => {
  const [selectedUuid, setSelectedUuid] = useState<string>('');
  const [email, setEmail] = useState('');
  const [registeredNo, setRegisteredNo] = useState<string | null>(null);

  const eventsQuery = usePublicEvents();
  const registerMutation = useRegisterForEvent();

  const events = eventsQuery.data ?? [];
  // Two rules:
  //   1. Before the user has picked anything, stay unselected. Auto-picking
  //      the first event skips the "choosing" step and would reveal the
  //      details section prematurely.
  //   2. If the stored uuid is no longer in the list (that event just hit
  //      capacity and left the open list), fall back to the first event
  //      instead of hovering in a state where the uuid exists but the UI
  //      shows nothing.
  const selectedEvent = selectedUuid
    ? (events.find((event) => event.uuid === selectedUuid) ?? events[0])
    : undefined;

  const fieldErrors = extractFieldErrors(registerMutation.error);
  // The fallback only appears when the server sent no message at all (a
  // proxy error page, a timeout). When the server does answer, its message is
  // shown exactly as received - the backend owns the wording, so a copy here
  // would be a second version of the same sentence, drifting from the first.
  const banner = registerMutation.error
    ? extractErrorMessage(
        registerMutation.error,
        'Your registration could not be completed. Please try again.',
      )
    : null;

  const handleSubmit = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!selectedEvent) return;
    registerMutation.mutate(
      { eventUuid: selectedEvent.uuid, emailAddress: email.trim() },
      { onSuccess: (result) => setRegisteredNo(result.registrationNo) },
    );
  };

  /** Back to the form so the user can register another email. The selected
   *  event is kept - most likely they're registering a second person for
   *  the same one. */
  const handleReset = () => {
    setRegisteredNo(null);
    setEmail('');
    registerMutation.reset();
  };

  // The thank-you screen replaces the form entirely. Being a separate
  // screen (rather than a message squeezed above the form) is what makes
  // "you're done" unmistakable.
  if (registeredNo) {
    return (
      <div className="mx-auto max-w-md py-6 sm:py-12">
        <Card>
          <CardContent className="flex flex-col items-center gap-2 p-8 text-center">
            <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
            <h1 className="mt-2 text-2xl font-semibold">Thank You!</h1>
            <p className="text-sm text-muted-foreground">Your registration has been confirmed</p>

            <dl className="mt-6 w-full space-y-4">
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Event
                </dt>
                <dd className="mt-1 text-base font-medium">{selectedEvent?.name ?? '—'}</dd>
              </div>
              <div>
                <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                  Registration Number
                </dt>
                {/* Wide letter spacing so a number like 00001 reads at a glance */}
                <dd className="mt-1 text-4xl font-bold tracking-[0.25em] text-primary tabular-nums">
                  {registeredNo}
                </dd>
              </div>
            </dl>

            {/* Back to the top of the page - the public list lives right
                above, and re-picking an event from the top is the most
                natural move, especially on mobile. */}
            <Button className="mt-6 w-full sm:w-auto" onClick={handleReset}>
              Back to Events
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-xl space-y-5">
      {banner && <Alert variant="destructive">{banner}</Alert>}

      <Card className="p-6">
        {eventsQuery.isPending ? (
          <div className="space-y-3">
            <div className="h-10 w-full animate-pulse rounded-md bg-muted" />
            <div className="h-40 w-full animate-pulse rounded-md bg-muted" />
          </div>
        ) : eventsQuery.isError ? (
          <Alert variant="destructive">
            {extractErrorMessage(
              eventsQuery.error,
              'We could not load the list of events. Please try again.',
            )}
          </Alert>
        ) : events.length === 0 ? (
          <Alert variant="info">
            There are no open events available for registration at the moment.
          </Alert>
        ) : (
          <div className="space-y-6">
            <div className="space-y-1.5">
              <Label htmlFor="event-select">Select an Event</Label>
              <Select
                value={selectedEvent?.uuid ?? ''}
                onValueChange={(value) => {
                  setSelectedUuid(value);
                  registerMutation.reset();
                }}
              >
                <SelectTrigger id="event-select">
                  <SelectValue placeholder="-- Choose an event --" />
                </SelectTrigger>
                <SelectContent>
                  {events.map((event) => (
                    // Name + date in each option: same-name events on
                    // different dates are common.
                    <SelectItem key={event.uuid} value={event.uuid}>
                      {event.name} — {formatDateLong(event.dateTime)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Details of the selected event. Only shows fields the public
                endpoint returns - there's no capacity/handler here to
                "forget to hide". */}
            {selectedEvent && (
              <div>
                <h2 className="text-base font-semibold">Event Details</h2>
                <dl className="mt-3 divide-y rounded-lg border">
                  <DetailRow label="Name" value={selectedEvent.name} />
                  <DetailRow
                    label="Date & Time"
                    value={formatDateTimeLong(selectedEvent.dateTime)}
                  />
                  <DetailRow label="Address" value={selectedEvent.address} />
                  <DetailRow
                    label="Registration Deadline"
                    value={formatDateLong(selectedEvent.deadline)}
                  />
                </dl>
              </div>
            )}

            <form onSubmit={handleSubmit} noValidate className="space-y-4 border-t pt-5">
              <div className="space-y-1.5">
                <Label htmlFor="email">Email Address</Label>
                <Input
                  id="email"
                  type="email"
                  autoComplete="email"
                  value={email}
                  aria-invalid={Boolean(fieldErrors.emailAddress)}
                  onChange={(event) => {
                    setEmail(event.target.value);
                    // A validation message describes the value that was
                    // submitted. The moment the user starts editing, that
                    // message is about something that no longer exists - and
                    // leaving it under the box reads as "the new value is
                    // wrong too". That is how an empty field ends up showing
                    // "enter a valid email address" with nothing in it.
                    if (registerMutation.error) registerMutation.reset();
                  }}
                  placeholder="Enter your email address"
                />
                {fieldErrors.emailAddress && (
                  <p role="alert" className="text-xs font-medium text-destructive">
                    {fieldErrors.emailAddress}
                  </p>
                )}
              </div>

              {/* Full width: a bigger tap target on mobile. */}
              <Button
                type="submit"
                className="w-full"
                size="lg"
                disabled={registerMutation.isPending || !selectedEvent}
              >
                {registerMutation.isPending && <Loader2 className="h-4 w-4 animate-spin" />}
                {registerMutation.isPending ? 'Registering…' : 'Register'}
              </Button>
            </form>
          </div>
        )}
      </Card>
    </div>
  );
};

/** One "label + value" row in the details list.
 *
 *  Stacked on phones, side by side from `sm` up.
 *
 *  The earlier version kept the label on the left at a fixed w-40 with
 *  shrink-0. On a 320px viewport that spends 160px on the label, and after the
 *  card's padding and the gap the value was left with roughly 100px - narrow
 *  enough that `break-words` had no choice but to break *inside* words, so
 *  "Singapore" rendered as "Sing / apor / e". A label is not worth half a
 *  phone screen, so below `sm` it sits above its value and the value gets the
 *  full width.
 *
 *  min-w-0 stays on the value for the side-by-side layout: a flex item refuses
 *  to shrink below its content width by default, which would turn a long
 *  address into horizontal overflow instead of wrapping it. */
const DetailRow = ({ label, value }: { label: string; value: string }) => (
  <div className="flex flex-col gap-0.5 px-4 py-3 text-sm sm:flex-row sm:gap-3">
    <span className="text-muted-foreground sm:w-48 sm:shrink-0">{label}</span>
    {/* min-w-0 lets the value shrink inside the flex row; break-words is what
        gives an unbreakable token somewhere to go. They solve different
        problems and both are needed: an event name is free text, so
        "SustainableUrbanDevelopmentConference2026" is a legitimate value with
        no space in it, and without a break opportunity the row pushes the page
        wider than the viewport. overflow-wrap only breaks a word that cannot
        fit on its own line, so ordinary text - a 67-character address with
        spaces - still wraps at word boundaries exactly as before. */}
    <span className="min-w-0 break-words">{value}</span>
  </div>
);

export default PublicEventPage;
