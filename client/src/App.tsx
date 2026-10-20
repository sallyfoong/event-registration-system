import { Link, Route, Routes, useLocation } from 'react-router-dom';
import { CalendarDays, ShieldCheck } from 'lucide-react';

import PublicEventPage from './pages/PublicEventPage';
import AdminEventsPage from './pages/AdminEventsPage';
import CreateEventPage from './pages/CreateEventPage';
import EventTrendPage from './pages/EventTrendPage';
import { cn } from '@/lib/utils';

// The single route table. Paths deliberately mirror the backend API paths
// (/admin/events/... vs /api/admin/events/...) so cross-referencing a page
// with its endpoint needs no mental translation.

/** Top navigation. Extracted because the "highlight the current page" logic
 *  is needed twice, and two copies of it always drift apart eventually.
 *
 *  '/' needs an exact match: everything else uses startsWith
 *  (/admin/events/new still counts as /admin), but startsWith('/') would
 *  highlight it on literally every route.
 *
 *  Mobile shows icons only (labels are hidden sm:inline) - the two labels
 *  together wrap the brand name at 375px. The icons keep aria-label, so
 *  accessibility doesn't suffer. */
const NavLink = ({
  to,
  label,
  icon: Icon,
}: {
  to: string;
  label: string;
  icon: typeof CalendarDays;
}) => {
  const { pathname } = useLocation();
  const isActive = to === '/' ? pathname === '/' : pathname.startsWith(to);
  return (
    <Link
      to={to}
      aria-label={label}
      aria-current={isActive ? 'page' : undefined}
      className={cn(
        'flex items-center gap-2 rounded-md px-3 py-2 text-sm font-medium transition-colors',
        isActive
          ? 'bg-primary/10 text-primary'
          : 'text-muted-foreground hover:bg-muted hover:text-foreground',
      )}
    >
      <Icon className="h-4 w-4 shrink-0" />
      <span className="hidden sm:inline">{label}</span>
    </Link>
  );
};

const App = () => (
  // Three stacked flex layers: fixed-height header, content fills the rest,
  // footer pinned to the bottom. Short pages still keep the footer at the
  // bottom instead of floating mid-screen.
  <div className="flex min-h-screen flex-col bg-muted/30">
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-3 px-4">
        <Link to="/" className="flex items-center gap-2.5">
          <span className="grid h-9 w-9 place-items-center rounded-lg bg-primary text-white">
            <CalendarDays className="h-5 w-5" />
          </span>
          <span className="text-base font-semibold tracking-tight">Event Company</span>
        </Link>
        <nav className="flex items-center gap-1" aria-label="Main">
          <NavLink to="/" label="Public Registration" icon={CalendarDays} />
          <NavLink to="/admin" label="Employee Console" icon={ShieldCheck} />
        </nav>
      </div>
    </header>

    <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6 sm:py-8">
      <Routes>
        <Route path="/" element={<PublicEventPage />} />
        <Route path="/admin" element={<AdminEventsPage />} />
        {/* 'new' is a static segment and must be matched before :uuid below */}
        <Route path="/admin/events/new" element={<CreateEventPage />} />
        <Route path="/admin/events/:uuid/trend" element={<EventTrendPage />} />
      </Routes>
    </main>

    <footer className="border-t bg-card py-4 text-center text-xs text-muted-foreground">
      © 2026 Event Company
    </footer>
  </div>
);

export default App;
