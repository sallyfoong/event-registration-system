import { useEffect, useState } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { ChevronLeft, ChevronRight, RefreshCw, Search, TrendingUp } from 'lucide-react';

import { useAdminEvents } from '@/api/queries';
import { extractErrorMessage } from '@/api/client';
import { formatDateIso, formatDateTimeCompact } from '@/utils/format';
import { useDebouncedValue } from '@/lib/useDebouncedValue';
import { Alert } from '@/components/ui/alert';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import { cn } from '@/lib/utils';

// Employee-side event list: pagination, search (name/address/handler),
// open-only filter, trend links.
//
// The interesting part is how pagination and filters interact.
// The data depends on page, search, and openOnly, but their semantics
// differ:
//   page turn      -> only page changes, filters stay
//   filter change  -> the result set is a different one, must go back to page 1
// If only `page` were watched, searching "Alice" from page 3 when the result
// has 2 rows would request page 3 and the backend would honestly return an
// empty array - the user sees "no matches" while the data exists.
//
// So "filter changed -> reset to page 1" lives directly in each onChange
// rather than an effect: the intent is explicit, and it avoids the wasteful
// fetch-at-old-page-then-fetch-at-new-page sequence.

// The frontend needs the page size to compute total pages. Must match the
// backend's env.pageSize or the page count math breaks and the last page
// looks empty.
const PAGE_SIZE = 10;

const AdminEventsPage = () => {
  const location = useLocation();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [openOnly, setOpenOnly] = useState(false);

  // Debounce the search - a request per keystroke explodes the cache keys.
  const debouncedSearch = useDebouncedValue(search);

  const { data, isPending, isError, error, isFetching, refetch } = useAdminEvents({
    page,
    search: debouncedSearch,
    open: openOnly,
  });

  // The create page hands back a success message via route state rather
  // than a URL param - a param would survive refreshes and show up in
  // shared links.
  const successMessage = (location.state as { successMessage?: string } | null)?.successMessage;
  const [banner, setBanner] = useState<string | null>(successMessage ?? null);
  useEffect(() => {
    if (!banner) return;
    const timer = setTimeout(() => setBanner(null), 4500);
    return () => clearTimeout(timer);
  }, [banner]);

  const events = data?.events ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  // While previous-page data is kept (isPlaceholderData) the skeleton can
  // rest too - only show a loading state when there's truly nothing, so
  // page turns don't flash blank.
  const showSkeleton = isPending && events.length === 0;

  return (
    <div className="space-y-5">
      <h1 className="text-2xl font-semibold tracking-tight">Events</h1>

      {banner && <Alert variant="success">{banner}</Alert>}
      {isError && (
        <Alert variant="destructive">
          {extractErrorMessage(error, 'We could not load the events. Please try again.')}
        </Alert>
      )}

      {/* Toolbar. Search box + checkbox + button don't fit on one phone row,
          so stack vertically and go back to a single row from sm up. */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            className="pl-9"
            placeholder="Search events by name, address, or handler.."
            aria-label="Search events"
            value={search}
            onChange={(event) => {
              setSearch(event.target.value);
              // Filter changed -> back to page 1. Placed here rather than
              // in an effect because resetting is part of the same action,
              // not a reaction to it.
              setPage(1);
            }}
          />
        </div>
        <div className="flex flex-wrap items-center justify-between gap-3 sm:justify-end sm:gap-4">
          {/* A native checkbox is enough for one boolean - pulling in Radix
              Checkbox for a single line of UI isn't worth a dependency.
              accent-primary makes the check follow the theme color. */}
          <label className="flex cursor-pointer select-none items-center gap-2 text-sm">
            <input
              type="checkbox"
              className="h-4 w-4 accent-primary"
              checked={openOnly}
              onChange={(event) => {
                setOpenOnly(event.target.checked);
                setPage(1);
              }}
            />
            Open Events Only
          </label>
          {/* Manual refresh, no polling: admin data doesn't need second-level
              freshness, and a poller would interrupt the user mid-typing. */}
          <Button
            variant="outline"
            size="icon"
            onClick={() => void refetch()}
            disabled={isFetching}
            aria-label="Refresh"
          >
            <RefreshCw className={cn('h-4 w-4', isFetching && 'animate-spin')} />
          </Button>
          <Button asChild>
            <Link to="/admin/events/new">Add Event</Link>
          </Button>
        </div>
      </div>

      <Card className="overflow-hidden">
        {/* Phone layout: one stacked card per event.
            The ten-column table is fine on a laptop and unusable on a phone -
            it only fits by scrolling sideways, which pushes the Actions column
            (the only way into the trend page) off screen. Same data, ordered by
            what someone actually looks at on a phone: what is it, when is it,
            where is it, who runs it, how full is it. */}
        <ul className="divide-y md:hidden">
          {showSkeleton ? (
            Array.from({ length: 3 }).map((_, index) => (
              <li key={`mobile-skeleton-${index}`} className="space-y-2 p-4">
                <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                <div className="h-3 w-1/2 animate-pulse rounded bg-muted" />
                <div className="h-3 w-3/4 animate-pulse rounded bg-muted" />
              </li>
            ))
          ) : events.length === 0 ? (
            <li className="py-12 text-center text-sm text-muted-foreground">
              No events match the current filters.
            </li>
          ) : (
            events.map((event) => (
              <li key={event.uuid} className="space-y-3 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="font-medium leading-snug">{event.name}</span>
                  <Badge variant={isOpen(event) ? 'success' : 'outline'} className="shrink-0">
                    {isOpen(event) ? 'Open' : 'Closed'}
                  </Badge>
                </div>

                <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-sm">
                  <dt className="text-muted-foreground">Event date</dt>
                  <dd className="tabular-nums">{formatDateTimeCompact(event.dateTime)}</dd>
                  <dt className="text-muted-foreground">Deadline</dt>
                  <dd className="tabular-nums">{formatDateIso(event.deadline)}</dd>
                  <dt className="text-muted-foreground">Address</dt>
                  {/* break-words, not truncate: an address is the one field
                      people need in full before driving to the venue. */}
                  <dd className="min-w-0 break-words">{event.address}</dd>
                  <dt className="text-muted-foreground">Handler</dt>
                  <dd>{event.handler.name || '—'}</dd>
                  <dt className="text-muted-foreground">Registered</dt>
                  <dd className="tabular-nums">
                    <span
                      className={cn(
                        event.registrationCount >= event.capacity &&
                          'font-semibold text-destructive',
                      )}
                    >
                      {event.registrationCount}
                    </span>{' '}
                    / {event.capacity}
                  </dd>
                  <dt className="text-muted-foreground">Created</dt>
                  <dd className="tabular-nums">{formatDateIso(event.createdAt)}</dd>
                </dl>

                <Button asChild variant="outline" size="sm" className="w-full">
                  <Link to={`/admin/events/${event.uuid}/trend`}>
                    <TrendingUp className="h-4 w-4" />
                    View Trend
                  </Link>
                </Button>
              </li>
            ))
          )}
        </ul>

        <div className="hidden md:block">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Name</TableHead>
                <TableHead>Created on</TableHead>
                <TableHead>Event date time</TableHead>
                <TableHead>Address</TableHead>
                <TableHead>Registration deadline</TableHead>
                <TableHead>Handler</TableHead>
                <TableHead className="text-right">Capacity</TableHead>
                <TableHead className="whitespace-normal text-right">
                  No. of registration
                </TableHead>{' '}
                <TableHead>Status</TableHead>
                <TableHead className="text-right">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {showSkeleton ? (
                // Skeleton rows instead of a spinner: the table layout holds
                // steady and the content just replaces the placeholders.
                Array.from({ length: 5 }).map((_, index) => (
                  <TableRow key={`skeleton-${index}`}>
                    {Array.from({ length: 10 }).map((__, cell) => (
                      <TableCell key={`skeleton-${index}-${cell}`}>
                        <div className="h-4 w-full animate-pulse rounded bg-muted" />
                      </TableCell>
                    ))}
                  </TableRow>
                ))
              ) : events.length === 0 ? (
                <TableRow>
                  <TableCell
                    colSpan={10}
                    className="py-12 text-center text-sm text-muted-foreground"
                  >
                    No events match the current filters.
                  </TableCell>
                </TableRow>
              ) : (
                events.map((event) => (
                  <TableRow key={event.uuid}>
                    <TableCell className="min-w-[140px] font-medium">{event.name}</TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateIso(event.createdAt)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateTimeCompact(event.dateTime)}
                    </TableCell>
                    <TableCell className="min-w-[140px] text-sm text-muted-foreground">
                      {event.address}
                    </TableCell>
                    <TableCell className="whitespace-nowrap tabular-nums">
                      {formatDateIso(event.deadline)}
                    </TableCell>
                    <TableCell className="whitespace-nowrap">{event.handler.name || '—'}</TableCell>
                    <TableCell className="text-right tabular-nums">{event.capacity}</TableCell>
                    <TableCell className="text-right tabular-nums">
                      <span
                        className={cn(
                          event.registrationCount >= event.capacity &&
                            'font-semibold text-destructive',
                        )}
                      >
                        {event.registrationCount}
                      </span>
                    </TableCell>
                    <TableCell>
                      {/* Green = still open, gray outline = closed. This only
                        colors the badge - the backend is the authority. Worst
                        case a wrong color is ugly; it can't affect who may
                        register. */}
                      <Badge variant={isOpen(event) ? 'success' : 'outline'}>
                        {isOpen(event) ? 'Open' : 'Closed'}
                      </Badge>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button asChild variant="outline" size="sm">
                        <Link to={`/admin/events/${event.uuid}/trend`}>
                          <TrendingUp className="h-4 w-4" />
                          View Trend
                        </Link>
                      </Button>
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>

        <div className="flex items-center justify-between border-t px-4 py-3 text-sm">
          <span className="text-muted-foreground">
            {total === 0
              ? 'No results'
              : `${(page - 1) * PAGE_SIZE + 1}–${Math.min(page * PAGE_SIZE, total)} of ${total}`}
          </span>
          <div className="flex items-center gap-1">
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              disabled={page <= 1}
              aria-label="Previous page"
            >
              <ChevronLeft className="h-4 w-4" />
            </Button>
            <span className="px-2 tabular-nums text-muted-foreground">
              {page} / {totalPages}
            </span>
            <Button
              variant="outline"
              size="icon"
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              disabled={page >= totalPages}
              aria-label="Next page"
            >
              <ChevronRight className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </Card>
    </div>
  );
};

/** Frontend-side "can this still take registrations", used only to color the
 *  status badge. Must stay in sync with the backend's openEventCondition in
 *  utils/sql.ts, or you get "backend says it's full, frontend still shows
 *  green". */
const isOpen = (event: {
  deadline: string;
  registrationCount: number;
  capacity: number;
}): boolean =>
  new Date(event.deadline).getTime() > Date.now() && event.registrationCount < event.capacity;

export default AdminEventsPage;
