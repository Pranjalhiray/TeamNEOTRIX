import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Activity, AlertCircle, ArrowUpRight, Menu, Search, ShieldCheck } from 'lucide-react';
import { api } from '../../services/api';
import { useUIStore } from '../../store/useStore';
import { isHostedDeployment } from '../../utils/runtime';

function getPageTitle(path: string) {
  if (path.startsWith('/investigate')) return 'Investigate';
  if (path === '/ingestion') return 'Ingest & correlate';
  if (path === '/alerts') return 'Ranked alerts';
  if (path === '/anomaly-detection') return 'Anomaly detection';
  if (path === '/clusters') return 'Entity clusters';
  if (path === '/graph') return 'Graph analysis';
  if (path === '/performance') return 'Model performance';
  return 'Overview';
}

export function Header() {
  const { toggleSidebar } = useUIStore();
  const location = useLocation();
  const navigate = useNavigate();
  const [searchValue, setSearchValue] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const pageTitle = getPageTitle(location.pathname);
  const health = useQuery({
    queryKey: ['system', 'health'],
    queryFn: api.system.getHealth,
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: false,
    networkMode: 'always',
  });

  useEffect(() => {
    document.title = `${pageTitle} | Bitcoin Transaction Forensics`;
  }, [pageTitle]);

  useEffect(() => {
    const focusSearch = (event: KeyboardEvent) => {
      const target = event.target;
      const isTyping = target instanceof HTMLElement && (
        target.isContentEditable || ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)
      );
      const quickSearch = (event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k';
      const slashSearch = event.key === '/' && !event.ctrlKey && !event.metaKey;
      if ((quickSearch || slashSearch) && !isTyping && !event.altKey) {
        event.preventDefault();
        if (searchRef.current?.getClientRects().length) {
          searchRef.current.focus();
        } else {
          navigate('/investigate');
        }
      }
    };
    window.addEventListener('keydown', focusSearch);
    return () => window.removeEventListener('keydown', focusSearch);
  }, [navigate]);

  const handleSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const value = searchValue.trim();
    if (!value) return;

    if (/^[a-f\d]{64}$/i.test(value)) {
      navigate(`/investigate/${encodeURIComponent(value)}`);
    } else {
      navigate(`/investigate?wallet=${encodeURIComponent(value)}`);
    }
    setSearchValue('');
  };

  const ready = health.data?.artifacts_loaded === true;
  const unavailable = health.isError || health.data?.artifacts_loaded === false;

  return (
    <header className="app-header sticky top-0 z-30 flex h-[72px] items-center justify-between gap-4 px-5 sm:px-8">
      <div className="flex min-w-0 items-center gap-3">
        <button
          onClick={toggleSidebar}
          className="header-menu-button lg:hidden"
          aria-label="Open navigation"
        >
          <Menu size={19} />
        </button>
        <div className="min-w-0">
          <p className="header-kicker hidden sm:block">Bitcoin transaction forensics</p>
          <h1 className="truncate text-[15px] font-semibold tracking-[-0.015em] text-[var(--color-text-primary)] sm:mt-0.5 sm:text-[17px]">{pageTitle}</h1>
        </div>
      </div>

      <form className="header-search hidden md:flex" role="search" onSubmit={handleSearch}>
        <Search size={16} aria-hidden="true" />
        <input
          ref={searchRef}
          value={searchValue}
          onChange={(event) => setSearchValue(event.target.value)}
          aria-label="Search a transaction ID or wallet address"
          placeholder="Search TXID or wallet address"
          autoComplete="off"
          spellCheck={false}
        />
        {searchValue ? (
          <button className="header-search-submit" type="submit" aria-label="Open investigation">
            <ArrowUpRight size={15} />
          </button>
        ) : (
          <kbd aria-hidden="true">Ctrl K</kbd>
        )}
      </form>

      <button
        type="button"
        className="header-mobile-search md:hidden"
        aria-label="Open transaction or wallet search"
        onClick={() => navigate('/investigate')}
      >
        <Search size={17} aria-hidden="true" />
      </button>

      <div className="flex shrink-0 items-center gap-2 sm:gap-3">
        <div className="offline-ready-badge hidden sm:flex" title={isHostedDeployment ? 'This hosted demo needs a connection to the analysis service.' : 'The interface is cached for offline viewing; live analysis needs the local service.'}>
          <ShieldCheck size={15} />
          <span>{isHostedDeployment ? 'Hosted demo' : 'Offline ready'}</span>
        </div>
        <div className={`engine-status ${ready ? 'engine-status-ready' : unavailable ? 'engine-status-error' : ''}`} title={ready ? 'Analysis API and model artifacts are available.' : unavailable ? 'Check the analysis service and model bundle.' : 'Checking the analysis service.'}>
          {ready ? <Activity size={14} /> : unavailable ? <AlertCircle size={14} /> : <span className="status-pulse" />}
          <span className="hidden sm:inline">{ready ? 'Engine ready' : unavailable ? 'Service offline' : 'Connecting'}</span>
          <span className="sm:hidden">{ready ? 'Ready' : unavailable ? 'Offline' : '…'}</span>
        </div>
      </div>
    </header>
  );
}
