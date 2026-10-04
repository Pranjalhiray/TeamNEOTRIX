import { useEffect, useState } from 'react';
import { Outlet } from 'react-router-dom';
import { cn } from '../../utils/cn';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { useUIStore } from '../../store/useStore';

export function MainLayout() {
  const { sidebarOpen, setSidebarOpen } = useUIStore();
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 1024);

  useEffect(() => {
    const updateViewport = () => setIsMobile(window.innerWidth < 1024);
    window.addEventListener('resize', updateViewport);
    return () => window.removeEventListener('resize', updateViewport);
  }, []);

  useEffect(() => {
    setSidebarOpen(!isMobile);
  }, [isMobile, setSidebarOpen]);

  return (
    <div className="min-h-screen">
      {isMobile && sidebarOpen && (
        <button
          className="sidebar-scrim"
          aria-label="Close navigation"
          onClick={() => setSidebarOpen(false)}
        />
      )}
      <Sidebar isMobile={isMobile} />
      <div className={cn('min-h-screen transition-[padding] duration-300', sidebarOpen ? 'lg:pl-[256px]' : 'lg:pl-[72px]')}>
        <Header />
        <main className="main-content" id="main-content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
