import { NavLink, useLocation } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bitcoin,
  ChevronLeft,
  ChevronRight,
  GitBranch,
  LayoutDashboard,
  Search,
  ShieldCheck,
  UploadCloud,
  Users,
} from 'lucide-react';
import { cn } from '../../utils/cn';
import { useUIStore } from '../../store/useStore';
import { isHostedDeployment } from '../../utils/runtime';

const navigationGroups = [
  {
    name: 'Workspace',
    items: [
      { name: 'Overview', href: '/', icon: LayoutDashboard },
      { name: 'Ingest dataset', href: '/ingestion', icon: UploadCloud },
      { name: 'Investigate', href: '/investigate', icon: Search },
    ],
  },
  {
    name: 'Intelligence',
    items: [
      { name: 'Ranked alerts', href: '/alerts', icon: AlertTriangle },
      { name: 'Anomaly detection', href: '/anomaly-detection', icon: Activity },
      { name: 'Entity clusters', href: '/clusters', icon: Users },
      { name: 'Graph analysis', href: '/graph', icon: GitBranch },
    ],
  },
  {
    name: 'Models',
    items: [
      { name: 'Model performance', href: '/performance', icon: BarChart3 },
    ],
  },
];

interface SidebarProps {
  isMobile?: boolean;
}

export function Sidebar({ isMobile = false }: SidebarProps) {
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const location = useLocation();

  return (
    <aside
      className={cn(
        'sidebar-shell fixed inset-y-0 left-0 z-50 flex h-dvh flex-col border-r transition-[width,transform] duration-300 ease-out',
        sidebarOpen ? 'w-[256px]' : 'w-[72px]',
        isMobile && !sidebarOpen && '-translate-x-full',
      )}
      aria-label="Workspace navigation"
    >
      <div className={cn('sidebar-brand flex h-[82px] shrink-0 items-center border-b px-5', sidebarOpen ? 'justify-between' : 'justify-center px-3')}>
        <NavLink to="/" className="flex min-w-0 items-center gap-3" aria-label="Bitcoin forensics overview">
          <span className="brand-mark"><Bitcoin aria-hidden="true" /></span>
          {sidebarOpen && (
            <span className="min-w-0">
              <span className="block truncate text-[14px] font-semibold tracking-[-0.02em] text-[var(--color-text-primary)]">Forensic Intelligence</span>
              <span className="mt-0.5 block text-[10px] font-semibold uppercase tracking-[0.17em] text-[var(--text-muted)]">Bitcoin transaction lab</span>
            </span>
          )}
        </NavLink>
        {!isMobile && (
          <button
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="sidebar-collapse"
            aria-label={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
            title={sidebarOpen ? 'Collapse navigation' : 'Expand navigation'}
          >
            {sidebarOpen ? <ChevronLeft size={16} /> : <ChevronRight size={16} />}
          </button>
        )}
      </div>

      <nav className="flex-1 overflow-y-auto px-3 py-7" aria-label="Main navigation">
        <div className="sidebar-navigation">
          {navigationGroups.map((group) => (
            <div className="sidebar-navigation-group" key={group.name}>
              {sidebarOpen && <p className="sidebar-section-label px-3">{group.name}</p>}
              <div className="space-y-1.5">
                {group.items.map((item) => {
                  const active = location.pathname === item.href || (item.href !== '/' && location.pathname.startsWith(item.href));
                  const Icon = item.icon;
                  return (
                    <NavLink
                      key={item.name}
                      to={item.href}
                      onClick={() => isMobile && setSidebarOpen(false)}
                      aria-current={active ? 'page' : undefined}
                      title={sidebarOpen ? undefined : item.name}
                      className={cn('sidebar-link group', active && 'sidebar-link-active', !sidebarOpen && 'justify-center px-0')}
                    >
                      <Icon size={18} strokeWidth={1.8} aria-hidden="true" />
                      {sidebarOpen && <span className="truncate">{item.name}</span>}
                      {sidebarOpen && active && <span className="sidebar-link-indicator" />}
                    </NavLink>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </nav>

      <div className="sidebar-footer border-t p-4">
        <div className={cn('offline-card flex items-center gap-3', !sidebarOpen && 'justify-center px-0')}>
          <span className="offline-indicator"><ShieldCheck size={16} /></span>
          {sidebarOpen && (
            <div className="min-w-0">
              <p className="text-xs font-semibold text-[var(--color-text-primary)]">{isHostedDeployment ? 'Session scoped' : 'Private by design'}</p>
              <p className="mt-1 text-[11px] leading-relaxed text-[var(--text-muted)]">{isHostedDeployment ? 'Hosted uploads use a temporary browser session. Use demo data only.' : 'Models and analysis stay on this device.'}</p>
            </div>
          )}
        </div>
        {sidebarOpen && <p className="mt-4 px-1 text-[10px] font-medium uppercase tracking-[0.15em] text-[var(--text-muted)]">SIH 2026 · PS 26146</p>}
      </div>
    </aside>
  );
}
