import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { App } from './App';
import { AuthProvider } from './auth';
import './index.css';

// Data is reused for a minute, and switching back to the tab does not reload every list.
// Screens that change data refresh the lists they affect themselves.
const client = new QueryClient({
  defaultOptions: { queries: { retry: 1, refetchOnWindowFocus: false, staleTime: 60_000 } },
});

// Lists that change a few times a year are reused for 10 minutes.
const REFERENCE_DATA = ['academic-years', 'classes', 'subjects', 'section-subjects', 'staff', 'default-subjects'];
for (const key of REFERENCE_DATA) {
  client.setQueryDefaults([key], { staleTime: 10 * 60_000 });
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={client}>
      <BrowserRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </BrowserRouter>
    </QueryClientProvider>
  </StrictMode>,
);
