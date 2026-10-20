import React from 'react';
import ReactDOM from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';

import App from './App';
import './index.css';

// Outermost wiring - each layer owns one thing:
//   StrictMode          -> surfaces effect bugs in dev
//   QueryClientProvider -> the server-state cache every useQuery/useMutation relies on
//   BrowserRouter       -> routing context, must sit above anything using Link/useNavigate
//
// The order matters: App's nav calls useLocation, so BrowserRouter has to be
// outside it, or it dies with "useLocation may be used only in the context
// of a Router".

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // 4xx is our own doing (validation failure, business rejection) -
      // retrying returns the same answer every time. Only 5xx and network
      // errors are worth retrying, since those can be transient. Without
      // this split, a typo in one field makes the user wait through three
      // retries before seeing the message.
      retry: (failureCount, error) => {
        const status = (error as { response?: { status?: number } })?.response?.status;
        if (status !== undefined && status < 500) return false;
        return failureCount < 2;
      },
      // Refetch on window focus. Handy in the admin console: switch back
      // and see events a colleague just created.
      refetchOnWindowFocus: true,
    },
  },
});

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Root element #root not found in index.html');
}

ReactDOM.createRoot(rootElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
        <App />
      </BrowserRouter>
    </QueryClientProvider>
  </React.StrictMode>,
);
