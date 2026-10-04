import { lazy, Suspense } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { BrowserRouter, Routes, Route } from 'react-router-dom';
import { TooltipProvider } from './components/ui/Tooltip';
import { MainLayout } from './components/layout';
import { Button } from './components/ui/Button';

const Overview = lazy(() => import('./pages/Overview').then((page) => ({ default: page.Overview })));
const Investigate = lazy(() => import('./pages/Investigate').then((page) => ({ default: page.Investigate })));
const Alerts = lazy(() => import('./pages/Alerts').then((page) => ({ default: page.Alerts })));
const Clusters = lazy(() => import('./pages/Clusters').then((page) => ({ default: page.Clusters })));
const Graph = lazy(() => import('./pages/Graph').then((page) => ({ default: page.Graph })));
const Performance = lazy(() => import('./pages/Performance').then((page) => ({ default: page.Performance })));
const AnomalyDetection = lazy(() => import('./pages/AnomalyDetection').then((page) => ({ default: page.AnomalyDetection })));
const Ingestion = lazy(() => import('./pages/Ingestion').then((page) => ({ default: page.Ingestion })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      retry: false,
      refetchOnWindowFocus: false,
      networkMode: 'always',
      staleTime: 45_000,
      gcTime: 24 * 60 * 60 * 1000,
    },
    mutations: { retry: false, networkMode: 'always' },
  },
});

function PageLoading() {
  return (
    <div className="page-loading" role="status" aria-live="polite">
      <span className="loading-mark" />
      <span>Opening analysis workspace</span>
    </div>
  );
}

function NotFound() {
  return (
    <div className="empty-state">
      <p className="eyebrow">Page unavailable</p>
      <h1 className="text-display-sm">This view could not be found.</h1>
      <Button asChild className="mt-5"><a href="/">Return to overview</a></Button>
    </div>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <BrowserRouter>
          <Suspense fallback={<PageLoading />}>
            <Routes>
              <Route path="/" element={<MainLayout />}>
                <Route index element={<Overview />} />
                <Route path="investigate" element={<Investigate />} />
                <Route path="investigate/:txid" element={<Investigate />} />
                <Route path="ingestion" element={<Ingestion />} />
                <Route path="alerts" element={<Alerts />} />
                <Route path="clusters" element={<Clusters />} />
                <Route path="graph" element={<Graph />} />
                <Route path="performance" element={<Performance />} />
                <Route path="anomaly-detection" element={<AnomalyDetection />} />
                <Route path="*" element={<NotFound />} />
              </Route>
            </Routes>
          </Suspense>
        </BrowserRouter>
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
