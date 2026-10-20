import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';

import { useAdminEvent, useEventTrend } from '@/api/queries';
import { extractErrorMessage } from '@/api/client';
import { Alert } from '@/components/ui/alert';
import { Button } from '@/components/ui/button';
import { Card } from '@/components/ui/card';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';

// Daily registration trend: one row per day from the event's creation date
// to its registration deadline, showing "new that day" and "cumulative".
//
// Two scope details worth spelling out:
//   1. The range starts at the event's creation date, not the first
//      registration. The trend answers "how did registrations accumulate
//      since this went live" - a day with zero registrations should show 0,
//      not vanish from the table.
//   2. The date column passes through the backend's "YYYY-MM-DD" as-is.
//      That value is a per-day key generated server-side, not a timestamp
//      to be formatted; running it through Intl again only adds a way to
//      get it wrong.

const EventTrendPage = () => {
  const { uuid } = useParams<{ uuid: string }>();
  const eventQuery = useAdminEvent(uuid);
  const trendQuery = useEventTrend(uuid);

  const trend = trendQuery.data ?? [];
  const loading = eventQuery.isPending || trendQuery.isPending;
  const error = eventQuery.error ?? trendQuery.error;

  if (loading) {
    return <div className="h-64 animate-pulse rounded-xl border bg-muted" />;
  }

  if (error) {
    return (
      <Alert variant="destructive">
        {extractErrorMessage(error, 'We could not load the registration trend. Please try again.')}
      </Alert>
    );
  }

  return (
    <div className="space-y-5">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/admin">
          <ArrowLeft className="h-4 w-4" />
          Back to event list
        </Link>
      </Button>

      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Registration Trend</h1>
        <p className="mt-1 text-sm text-muted-foreground">{eventQuery.data?.name}</p>
      </div>

      {/* Empty state handled separately: there should normally be at least
          one row (creation day), but a freshly created event or dirty data
          (deadline before createdAt) can produce none. */}
      {trend.length === 0 ? (
        <Alert variant="info">No data available for the selected event.</Alert>
      ) : (
        <Card className="overflow-hidden">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Date</TableHead>
                <TableHead className="text-right">New registration</TableHead>
                <TableHead className="text-right">Total registration</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {trend.map((point) => (
                // date alone is a sufficient key - the backend guarantees
                // one row per day.
                <TableRow key={point.date}>
                  <TableCell className="whitespace-nowrap tabular-nums">{point.date}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {point.newRegistrationCount}
                  </TableCell>
                  <TableCell className="text-right tabular-nums">
                    {point.registrationCount}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </Card>
      )}
    </div>
  );
};

export default EventTrendPage;
