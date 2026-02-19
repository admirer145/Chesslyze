import React, { useState, useEffect, useCallback } from 'react';
import { LayoutDashboard, Import, Activity, BookOpen, Settings, ChevronLeft, ChevronRight, Zap, User, LayoutList, Menu, X } from 'lucide-react';
import { Link, useLocation } from 'react-router-dom';
import { useAnalysisQueue } from '../hooks/useAnalysisQueue';
import { db } from '../services/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { PWAInstallPrompt } from './common/PWAInstallPrompt';

const MOBILE_BREAKPOINT = 768;

const NavItem = ({ to, icon: Icon, label, collapsed, onClick }) => {
    const location = useLocation();
    const isActive = location.pathname === to;

    return (
        <Link
            to={to}
            onClick={onClick}
            className={`nav-item flex items-center gap-3 p-2 mx-2 rounded-md transition-colors text-sm ${isActive
                ? 'nav-item-active text-primary font-medium'
                : 'nav-item-inactive text-secondary hover:bg-subtle hover:text-primary'
                }`}
            title={collapsed ? label : ''}
        >
            <Icon size={18} strokeWidth={2} />
            {!collapsed && <span>{label}</span>}
        </Link>
    );
};

export const Layout = ({ children }) => {
    // Ensure queue processor is running
    useAnalysisQueue();

    // Direct query for real-time UI status
    const analyzingCount = useLiveQuery(() => db.games.filter(g => g.analysisStatus === 'analyzing').count()) || 0;
    const isAnalyzing = analyzingCount > 0;

    const [collapsed, setCollapsed] = useState(false);
    const [isMobile, setIsMobile] = useState(() =>
        typeof window !== 'undefined' ? window.innerWidth < MOBILE_BREAKPOINT : false
    );
    const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

    useEffect(() => {
        const mq = window.matchMedia(`(max-width: ${MOBILE_BREAKPOINT - 1}px)`);
        const handler = (e) => {
            setIsMobile(e.matches);
            if (!e.matches) setMobileMenuOpen(false); // Close overlay when resizing to desktop
        };
        mq.addEventListener('change', handler);
        setIsMobile(mq.matches);
        return () => mq.removeEventListener('change', handler);
    }, []);

    const closeMobileMenu = useCallback(() => setMobileMenuOpen(false), []);

    return (
        <div className="app-shell flex flex-col h-screen bg-app text-primary overflow-hidden">
            <PWAInstallPrompt />

            {/* Top Bar */}
            <header
                className={`app-header border-b bg-panel flex items-center justify-between shrink-0 z-20 ${isMobile ? 'px-3' : 'px-6'}`}
                style={{ height: 'calc(56px + var(--safe-top))', paddingTop: 'var(--safe-top)' }}
            >
                <div className="flex items-center gap-3">
                    {/* Mobile Hamburger */}
                    {isMobile && (
                        <button
                            onClick={() => setMobileMenuOpen(v => !v)}
                            className="mobile-hamburger p-1.5 rounded-md hover:bg-subtle text-secondary hover:text-primary transition-colors"
                            aria-label="Toggle menu"
                        >
                            {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
                        </button>
                    )}

                    {/* Logo */}
                    <div className="flex items-center gap-2">
                        <div className="w-auto p-1 rounded-sm flex items-center justify-center bg-white text-black">
                            <div style={{ width: 6, height: 6, borderRadius: '50%', background: 'black' }} />
                        </div>
                        <span className="font-semibold text-base">Chesslyze</span>
                    </div>

                    {!isMobile && (
                        <>
                            <div className="mx-2" style={{ height: 16, width: 1, backgroundColor: 'var(--border-subtle)' }} />
                            <span className="text-sm text-secondary">Personal Analytics</span>
                        </>
                    )}
                </div>

                <div className="flex items-center gap-4">
                    {/* Engine Status */}
                    <div className={`flex items-center gap-2 text-xs px-2 py-1 rounded transition-colors ${isAnalyzing ? 'text-blue-400' : 'text-muted'}`} style={{ backgroundColor: isAnalyzing ? 'rgba(96, 165, 250, 0.1)' : 'transparent' }}>
                        <Zap size={14} className={isAnalyzing ? 'fill-current' : ''} />
                        {!isMobile && <span>{isAnalyzing ? `Analyzing (${analyzingCount})` : 'Engine Idle'}</span>}
                    </div>
                </div>
            </header>

            <div className="flex flex-1 overflow-hidden w-full">
                {/* Mobile Sidebar Overlay */}
                {isMobile && (
                    <>
                        {/* Backdrop */}
                        <div
                            className={`mobile-sidebar-backdrop ${mobileMenuOpen ? 'is-visible' : ''}`}
                            onClick={closeMobileMenu}
                        />
                        {/* Sidebar */}
                        <aside className={`mobile-sidebar bg-panel border-r flex flex-col ${mobileMenuOpen ? 'is-open' : ''}`}>
                            <div className="flex-1 py-4 flex flex-col gap-1 overflow-y-auto">
                                <NavItem to="/" icon={LayoutDashboard} label="Dashboard" collapsed={false} onClick={closeMobileMenu} />
                                <NavItem to="/library" icon={LayoutList} label="Games Library" collapsed={false} onClick={closeMobileMenu} />
                                <NavItem to="/reels" icon={Zap} label="Smart Puzzles" collapsed={false} onClick={closeMobileMenu} />
                                <NavItem to="/openings" icon={BookOpen} label="Opening Explorer" collapsed={false} onClick={closeMobileMenu} />
                                <NavItem to="/profile" icon={User} label="Chess Journey" collapsed={false} onClick={closeMobileMenu} />
                                <div className="my-2 border-t mx-4" />
                                <NavItem to="/import" icon={Import} label="Import Games" collapsed={false} onClick={closeMobileMenu} />
                                <NavItem to="/settings" icon={Settings} label="Settings" collapsed={false} onClick={closeMobileMenu} />
                            </div>
                        </aside>
                    </>
                )}

                {/* Desktop Sidebar */}
                {!isMobile && (
                    <aside
                        className="app-sidebar border-r bg-panel flex flex-col transition-all"
                        style={{ width: collapsed ? 60 : 240, transitionDuration: '0.3s' }}
                    >
                        <div className="flex-1 py-4 flex flex-col gap-1">
                            <NavItem to="/" icon={LayoutDashboard} label="Dashboard" collapsed={collapsed} />
                            <NavItem to="/library" icon={LayoutList} label="Games Library" collapsed={collapsed} />
                            <NavItem to="/reels" icon={Zap} label="Smart Puzzles" collapsed={collapsed} />
                            <NavItem to="/openings" icon={BookOpen} label="Opening Explorer" collapsed={collapsed} />
                            <NavItem to="/profile" icon={User} label="Chess Journey" collapsed={collapsed} />
                            <div className="my-2 border-t mx-4" />
                            <NavItem to="/import" icon={Import} label="Import Games" collapsed={collapsed} />
                            <NavItem to="/settings" icon={Settings} label="Settings" collapsed={collapsed} />
                        </div>

                        <button
                            onClick={() => setCollapsed(!collapsed)}
                            className="p-3 text-muted hover:text-primary flex justify-center border-t outline-none"
                        >
                            {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
                        </button>
                    </aside>
                )}

                {/* Main Content */}
                <main className="app-main flex-1 overflow-auto bg-app p-0 relative">
                    {children}
                </main>
            </div>
        </div>
    );
};
