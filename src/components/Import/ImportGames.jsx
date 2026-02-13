import React, { useMemo, useState, useEffect } from 'react';
import { Download, CheckCircle, AlertCircle, Loader2, ArrowLeftRight, RefreshCw, FileUp, Zap, Calendar, Archive, Play, X } from 'lucide-react';
import { syncUserGames, fetchLichessUser, fetchLichessGames } from '../../services/lichess';
import { getLatestGameTimestamp, loadImportProgress, clearImportProgress } from '../../services/db';
import { useRef } from 'react';
import { importPgnGames } from '../../services/pgn';
import { useNavigate } from 'react-router-dom';

export const ImportGames = () => {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    const [progress, setProgress] = useState(null);
    const [userStats, setUserStats] = useState(null);
    const [lastSyncDate, setLastSyncDate] = useState(null);
    const [hasNewGames, setHasNewGames] = useState(null);
    const [checkingNew, setCheckingNew] = useState(false);
    const [lastCheckedAt, setLastCheckedAt] = useState(null);
    const [pgnText, setPgnText] = useState('');
    const [pgnTag, setPgnTag] = useState('');
    const [pgnStatus, setPgnStatus] = useState('idle');
    const [pgnMessage, setPgnMessage] = useState('');
    const [pgnStats, setPgnStats] = useState(null);
    const [pgnFileName, setPgnFileName] = useState('');
    const [isSmallScreen, setIsSmallScreen] = useState(window.innerWidth < 640);
    const [importMode, setImportMode] = useState('smart');
    const [customDateRange, setCustomDateRange] = useState({ since: null, until: null });
    const [canResume, setCanResume] = useState(false);
    const [resumeData, setResumeData] = useState(null);
    const abortRef = useRef(null);
    const [importTotal, setImportTotal] = useState(0);
    const [importPct, setImportPct] = useState(0);

    useEffect(() => {
        const handleResize = () => setIsSmallScreen(window.innerWidth < 640);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const USER_STATS_TTL_MS = 24 * 60 * 60 * 1000;
    const NEW_GAMES_CHECK_TTL_MS = 6 * 60 * 60 * 1000;

    const statsCacheKey = (user) => `heroUserStats:${user.toLowerCase()}`;
    const statsCacheAtKey = (user) => `heroUserStatsAt:${user.toLowerCase()}`;
    const newCheckAtKey = (user) => `heroNewCheckAt:${user.toLowerCase()}`;
    const newCheckHasKey = (user) => `heroNewCheckHas:${user.toLowerCase()}`;

    const readCachedStats = (user) => {
        try {
            const raw = localStorage.getItem(statsCacheKey(user));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    };

    const writeCachedStats = (user, stats) => {
        localStorage.setItem(statsCacheKey(user), JSON.stringify(stats));
        localStorage.setItem(statsCacheAtKey(user), String(Date.now()));
    };

    const refreshLastSyncDate = async (user) => {
        const lastSync = await getLatestGameTimestamp(user);
        setLastSyncDate(lastSync);
        return lastSync;
    };

    const maybeCheckForNewGames = async (user, lastSync) => {
        if (!user || !lastSync) {
            setHasNewGames(null);
            return;
        }
        const lastChecked = parseInt(localStorage.getItem(newCheckAtKey(user)) || '0', 10);
        const cachedHas = localStorage.getItem(newCheckHasKey(user));

        if (lastChecked && Date.now() - lastChecked < NEW_GAMES_CHECK_TTL_MS) {
            if (cachedHas !== null) setHasNewGames(cachedHas === 'true');
            setLastCheckedAt(lastChecked);
            return;
        }

        setCheckingNew(true);
        try {
            const games = await fetchLichessGames(user, 1, { since: lastSync + 1, until: Date.now() });
            const hasNew = games.length > 0;
            setHasNewGames(hasNew);
            const now = Date.now();
            setLastCheckedAt(now);
            localStorage.setItem(newCheckAtKey(user), String(now));
            localStorage.setItem(newCheckHasKey(user), String(hasNew));
        } catch (err) {
            console.error(err);
        } finally {
            setCheckingNew(false);
        }
    };

    const handleFetchStats = async (e, options = {}) => {
        if (e && e.preventDefault) e.preventDefault();
        const userToFetch = typeof e === 'string' ? e : username;
        if (!userToFetch) return;

        const { useCache = false, silent = false } = options;
        if (useCache) {
            const cachedAt = parseInt(localStorage.getItem(statsCacheAtKey(userToFetch)) || '0', 10);
            const cached = readCachedStats(userToFetch);
            if (cached && cachedAt && Date.now() - cachedAt < USER_STATS_TTL_MS) {
                setUserStats(cached);
                const lastSync = await refreshLastSyncDate(userToFetch);
                await maybeCheckForNewGames(userToFetch, lastSync);
                return;
            }
        }

        if (!silent) {
            setStatus('loading');
            setMessage('Fetching user profile...');
        }
        try {
            const stats = await fetchLichessUser(userToFetch);
            setUserStats(stats);
            writeCachedStats(userToFetch, stats);

            // Fetch last sync date
            const lastSync = await refreshLastSyncDate(userToFetch);
            await maybeCheckForNewGames(userToFetch, lastSync);

            localStorage.setItem('heroUser', userToFetch);
            if (typeof e === 'string') setUsername(userToFetch);
            if (!silent) {
                setStatus('idle');
                setMessage('');
            }
        } catch (err) {
            console.error(err);
            if (!silent) {
                setStatus('error');
                setMessage(err.message);
            }
        }
    };

    useEffect(() => {
        const lastUser = localStorage.getItem('heroUser');
        if (lastUser) {
            setUsername(lastUser);
            // Load from cache if fresh to avoid unnecessary API calls
            setTimeout(() => handleFetchStats(lastUser, { useCache: true, silent: true }), 0);
        }
    }, []);

    // Check for resumable import when username changes
    useEffect(() => {
        const checkResumable = async () => {
            if (!username) return;
            const progress = await loadImportProgress(username);
            if (progress && (progress.status === 'in-progress' || progress.status === 'paused')) {
                setCanResume(true);
                setResumeData(progress);
            } else {
                setCanResume(false);
                setResumeData(null);
            }
        };
        checkResumable();
    }, [username]);

    const handleSync = async (resumeMode = false) => {
        if (!username) return;

        // Validate custom date range
        if (importMode === 'custom' && (!customDateRange.since || !customDateRange.until)) {
            setStatus('error');
            setMessage('Please select both a start and end date for custom import.');
            return;
        }
        if (importMode === 'custom' && customDateRange.since >= customDateRange.until) {
            setStatus('error');
            setMessage('Start date must be before end date.');
            return;
        }

        const controller = new AbortController();
        abortRef.current = controller;

        setStatus('loading');
        setImportTotal(resumeMode ? (resumeData?.totalImported || 0) : 0);
        setImportPct(0);
        setProgress({ type: 'start', message: 'Initializing import...' });
        setMessage('Starting import...');

        try {
            const syncOptions = {
                mode: importMode,
                resumeFrom: resumeMode ? resumeData : null,
                signal: controller.signal
            };

            if (importMode === 'custom') {
                syncOptions.since = customDateRange.since;
                syncOptions.until = customDateRange.until;
            } else if (importMode === 'full') {
                syncOptions.startTime = userStats?.createdAt;
            }

            const result = await syncUserGames(username, (p) => {
                setProgress(p);
                if (p.message) setMessage(p.message);
                if (p.total !== undefined) setImportTotal(p.total);
                if (p.percentage !== undefined) setImportPct(p.percentage);
            }, syncOptions);

            abortRef.current = null;

            if (result.cancelled) {
                setStatus('idle');
                setMessage(`Import cancelled. ${result.totalImported} games saved.`);
                // Reload resume data
                const prog = await loadImportProgress(username);
                if (prog) {
                    setCanResume(true);
                    setResumeData(prog);
                }
                return;
            }

            setStatus('success');
            setCanResume(false);
            setResumeData(null);
            setHasNewGames(false);
            const now = Date.now();
            setLastCheckedAt(now);
            localStorage.setItem(newCheckAtKey(username), String(now));
            localStorage.setItem(newCheckHasKey(username), 'false');

            if (result.failedChunks && result.failedChunks.length > 0) {
                setMessage(`Import completed with ${result.failedChunks.length} failed chunks. ${result.totalImported} games imported.`);
            }

            setTimeout(() => navigate('/library'), 2000);
        } catch (err) {
            console.error(err);
            abortRef.current = null;
            setStatus('error');
            setMessage(err.message);

            if (err.message.includes('Too many rate limit errors')) {
                setCanResume(true);
                const prog = await loadImportProgress(username);
                if (prog) setResumeData(prog);
            }
        }
    };

    const handleCancel = () => {
        if (abortRef.current) {
            abortRef.current.abort();
        }
    };

    const handlePgnFile = (e) => {
        const file = e.target.files?.[0];
        if (!file) return;
        const reader = new FileReader();
        reader.onload = () => {
            setPgnText(String(reader.result || ''));
            setPgnFileName(file.name);
        };
        reader.readAsText(file);
    };

    const handlePgnImport = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        if (!pgnText.trim()) {
            setPgnStatus('error');
            setPgnMessage('Paste PGN or upload a .pgn file first.');
            return;
        }
        setPgnStatus('loading');
        setPgnMessage('Importing PGN...');
        setPgnStats(null);
        try {
            const result = await importPgnGames(pgnText, { importTag: pgnTag.trim() });
            setPgnStats(result);
            setPgnStatus('success');
            setPgnMessage(`Imported ${result.imported} games. Skipped ${result.skipped}.`);
            // Clear form
            setPgnText('');
            setPgnTag('');
            setPgnFileName('');
            // Redirect to library
            setTimeout(() => navigate('/library'), 1500);
        } catch (err) {
            console.error(err);
            setPgnStatus('error');
            setPgnMessage(err.message || 'Failed to import PGN.');
        }
    };

    return (
        <div className="h-full bg-app p-4 sm:p-8 overflow-y-auto">
            <div className="w-full max-w-5xl mx-auto">
                <div className="text-center mb-8">
                    <h1 className="text-3xl font-bold text-primary mb-2">Import Games</h1>
                    <p className="text-secondary text-sm max-w-md mx-auto">Sync your Lichess history or paste PGN files to start analyzing and improving.</p>
                </div>
                <div className="grid gap-6 lg:grid-cols-2">
                    <div className="bg-panel border border-white/5 rounded-2xl p-8 shadow-2xl animate-fade-in relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500" />

                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold text-primary mb-2">Sync Hero Games</h2>
                            <p className="text-secondary text-sm">Connect your Lichess account to import your personal history.</p>
                        </div>

                        {!userStats ? (
                            <form onSubmit={handleFetchStats} className="flex flex-col gap-6 w-full">
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs font-semibold text-muted uppercase tracking-wider">Lichess Username</label>
                                    <input
                                        type="text"
                                        value={username}
                                        onChange={(e) => setUsername(e.target.value)}
                                        placeholder="e.g. MagnusCarlsen"
                                        className="input w-full bg-subtle focus:ring-2 focus:ring-blue-500/50"
                                        required
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={status === 'loading'}
                                    className="btn btn-primary w-full py-3 mt-2 shadow-lg shadow-blue-500/20"
                                >
                                    {status === 'loading' ? (
                                        <span className="flex items-center gap-2 justify-center">
                                            <Loader2 size={16} className="animate-spin" /> Fetching...
                                        </span>
                                    ) : (
                                        <span className="flex items-center gap-2 justify-center">
                                            Find User
                                        </span>
                                    )}
                                </button>
                            </form>
                        ) : (
                            <div className="flex flex-col gap-6 w-full animate-fade-in">
                                <div style={{
                                    display: 'flex',
                                    flexDirection: 'column',
                                    gap: 16,
                                    borderBottom: '1px solid rgba(255,255,255,0.1)',
                                    paddingBottom: 20
                                }}>
                                    <div style={{
                                        display: 'flex',
                                        alignItems: 'center',
                                        justifyContent: 'space-between',
                                        gap: 12,
                                        width: '100%'
                                    }}>
                                        <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0 }}>
                                            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, #3b82f6, #9333ea)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                                {userStats.username.charAt(0).toUpperCase()}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                                <span className="text-primary" style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{userStats.username}</span>
                                                <span className="text-secondary" style={{ fontSize: 11 }}>Joined {new Date(userStats.createdAt).toLocaleDateString()}</span>
                                            </div>
                                        </div>

                                        <div style={{
                                            textAlign: 'center',
                                            padding: '4px 14px',
                                            borderRadius: 10,
                                            background: 'rgba(139,92,246,0.08)',
                                            border: '1px solid rgba(139,92,246,0.2)',
                                            marginLeft: isSmallScreen ? '0' : 'auto',
                                            marginRight: isSmallScreen ? '0' : 'auto',
                                            flexShrink: 0
                                        }}>
                                            <div style={{ fontSize: 18, fontWeight: 800, background: 'linear-gradient(90deg, #8b5cf6, #6366f1)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{userStats.count?.all || 0}</div>
                                            <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(139,92,246,0.7)' }}>Total Games</div>
                                        </div>

                                        {!isSmallScreen && (
                                            <button
                                                onClick={() => {
                                                    setUserStats(null);
                                                    setLastSyncDate(null);
                                                    setHasNewGames(null);
                                                    setLastCheckedAt(null);
                                                }}
                                                className="btn btn-secondary"
                                                style={{ padding: '6px 12px', fontSize: 12, flexShrink: 0 }}
                                            >
                                                <ArrowLeftRight size={14} style={{ marginRight: 6 }} />
                                                Change User
                                            </button>
                                        )}
                                    </div>

                                    {isSmallScreen && (
                                        <button
                                            onClick={() => {
                                                setUserStats(null);
                                                setLastSyncDate(null);
                                                setHasNewGames(null);
                                                setLastCheckedAt(null);
                                            }}
                                            className="btn btn-secondary"
                                            style={{ width: '100%', padding: '8px', fontSize: 12 }}
                                        >
                                            <ArrowLeftRight size={14} style={{ marginRight: 6 }} />
                                            Change User
                                        </button>
                                    )}
                                </div>

                                <div className="grid grid-cols-3 gap-3 text-center mb-2">
                                    <div className="bg-emerald-500/5 border border-emerald-500/10 p-3 rounded-xl flex flex-col gap-1">
                                        <div className="text-emerald-400 font-bold text-xl">{userStats.count?.win || 0}</div>
                                        <div className="text-[10px] text-emerald-400/70 font-bold uppercase tracking-wider">Wins</div>
                                    </div>
                                    <div className="bg-rose-500/5 border border-rose-500/10 p-3 rounded-xl flex flex-col gap-1">
                                        <div className="text-rose-400 font-bold text-xl">{userStats.count?.loss || 0}</div>
                                        <div className="text-[10px] text-rose-400/70 font-bold uppercase tracking-wider">Losses</div>
                                    </div>
                                    <div className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-xl flex flex-col gap-1">
                                        <div className="text-blue-400 font-bold text-xl">{userStats.count?.draw || 0}</div>
                                        <div className="text-[10px] text-blue-400/70 font-bold uppercase tracking-wider">Draws</div>
                                    </div>
                                </div>

                                {/* Import Mode Selection */}
                                <div className="flex flex-col gap-3 pb-4 border-b border-white/5">
                                    <label className="text-xs font-semibold text-muted uppercase tracking-wider">
                                        Import Mode
                                    </label>

                                    <div className="grid grid-cols-3 gap-2">
                                        <button
                                            onClick={() => setImportMode('smart')}
                                            className={`btn ${importMode === 'smart' ? 'btn-primary' : 'btn-secondary'} py-3 flex flex-col items-center gap-1`}
                                            type="button"
                                        >
                                            <Zap size={16} />
                                            <span className="text-[11px] font-semibold">Quick</span>
                                            <span className="text-[9px] text-muted">Last 7 days</span>
                                        </button>

                                        <button
                                            onClick={() => setImportMode('custom')}
                                            className={`btn ${importMode === 'custom' ? 'btn-primary' : 'btn-secondary'} py-3 flex flex-col items-center gap-1`}
                                            type="button"
                                        >
                                            <Calendar size={16} />
                                            <span className="text-[11px] font-semibold">Custom</span>
                                            <span className="text-[9px] text-muted">Date range</span>
                                        </button>

                                        <button
                                            onClick={() => setImportMode('full')}
                                            className={`btn ${importMode === 'full' ? 'btn-primary' : 'btn-secondary'} py-3 flex flex-col items-center gap-1`}
                                            type="button"
                                        >
                                            <Archive size={16} />
                                            <span className="text-[11px] font-semibold">Full</span>
                                            <span className="text-[9px] text-muted">All history</span>
                                        </button>
                                    </div>

                                    {/* Custom Date Range Picker */}
                                    {/* Custom Date Range Picker */}
                                    {importMode === 'custom' && (
                                        <div className="flex flex-col gap-3 p-3 bg-subtle/30 rounded-xl border border-white/5 mt-2">
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-[10px] text-muted mb-1 block uppercase tracking-wider">From Date</label>
                                                    <input
                                                        type="date"
                                                        value={customDateRange.since ? new Date(customDateRange.since).toISOString().split('T')[0] : ''}
                                                        onChange={(e) => setCustomDateRange(prev => ({
                                                            ...prev,
                                                            since: new Date(e.target.value).getTime()
                                                        }))}
                                                        className="input w-full text-xs"
                                                        max={customDateRange.until ? new Date(customDateRange.until).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}
                                                    />
                                                </div>

                                                <div>
                                                    <label className="text-[10px] text-muted mb-1 block uppercase tracking-wider">To Date</label>
                                                    <input
                                                        type="date"
                                                        value={customDateRange.until ? new Date(customDateRange.until).toISOString().split('T')[0] : ''}
                                                        onChange={(e) => {
                                                            const date = new Date(e.target.value);
                                                            date.setHours(23, 59, 59, 999);
                                                            setCustomDateRange(prev => ({
                                                                ...prev,
                                                                until: date.getTime()
                                                            }));
                                                        }}
                                                        className="input w-full text-xs"
                                                        min={customDateRange.since ? new Date(customDateRange.since).toISOString().split('T')[0] : undefined}
                                                        max={new Date().toISOString().split('T')[0]}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {/* Resume Import Alert */}
                                {canResume && resumeData && status !== 'loading' && (
                                    <div className="p-3 bg-blue-500/10 border border-blue-500/20 rounded-xl">
                                        <div className="flex items-start gap-2">
                                            <AlertCircle size={16} className="text-blue-400 mt-0.5 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-semibold text-primary mb-1">
                                                    Previous Import Found
                                                </div>
                                                <div className="text-[10px] text-secondary mb-2">
                                                    {resumeData.totalImported || 0} games imported so far. Resume to continue from where you left off.
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleSync(true)}
                                                        className="btn btn-primary text-[10px] py-1.5 px-3"
                                                        type="button"
                                                    >
                                                        <Play size={10} className="mr-1" />
                                                        Resume
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            await clearImportProgress(username);
                                                            setCanResume(false);
                                                            setResumeData(null);
                                                        }}
                                                        className="btn btn-secondary text-[10px] py-1.5 px-3"
                                                        type="button"
                                                    >
                                                        Discard
                                                    </button>
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="flex flex-col gap-3">
                                    {status === 'loading' ? (
                                        <div className="bg-subtle/50 p-4 rounded-xl flex flex-col gap-3 border border-white/5">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3 text-sm text-primary">
                                                    <Loader2 size={16} className="animate-spin text-accent-primary" />
                                                    <span className="truncate">{message || 'Importing...'}</span>
                                                </div>
                                                <button
                                                    onClick={handleCancel}
                                                    className="btn btn-secondary py-1 px-2 flex-shrink-0 text-[10px]"
                                                    type="button"
                                                    title="Cancel Import"
                                                >
                                                    <X size={12} className="mr-1" />
                                                    Cancel
                                                </button>
                                            </div>

                                            <div className="w-full bg-black/50 h-2 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-gradient-to-r from-blue-500 to-purple-500 transition-all duration-500"
                                                    style={{ width: `${Math.min(100, importPct)}%` }}
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div className="text-center p-2 bg-black/30 rounded-lg">
                                                    <div className="text-muted mb-0.5">Total Imported</div>
                                                    <div className="text-accent-primary font-bold text-lg">{importTotal}</div>
                                                </div>
                                                <div className="text-center p-2 bg-black/30 rounded-lg">
                                                    <div className="text-muted mb-0.5">Progress</div>
                                                    <div className="text-secondary font-bold text-lg">{Math.round(importPct)}%</div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            {importMode === 'custom' && (
                                                <div className="text-center mb-2 min-h-[16px]">
                                                    {(!customDateRange.since || !customDateRange.until) ? (
                                                        <span className="text-xs text-secondary animate-pulse">Please select both start and end dates</span>
                                                    ) : (customDateRange.since > customDateRange.until) ? (
                                                        <span className="text-xs text-red-400 font-medium">Start date cannot be after end date</span>
                                                    ) : null}
                                                </div>
                                            )}
                                            <button
                                                onClick={() => handleSync()}
                                                disabled={
                                                    status === 'loading' ||
                                                    (importMode === 'custom' && (!customDateRange.since || !customDateRange.until || customDateRange.since > customDateRange.until))
                                                }
                                                className="btn btn-primary w-full py-4 text-base font-medium shadow-lg shadow-blue-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Download size={18} className="mr-2" />
                                                {importMode === 'smart'
                                                    ? (lastSyncDate ? 'Sync Latest Games' : 'Start Quick Import')
                                                    : importMode === 'custom'
                                                        ? 'Import Range'
                                                        : 'Import Full History'
                                                }
                                            </button>
                                            <div className="flex items-center justify-between text-xs text-muted px-1">
                                                <div className="flex items-center gap-2">
                                                    {checkingNew ? (
                                                        <>
                                                            <Loader2 size={12} className="animate-spin text-accent-primary" />
                                                            <span>Checking for new games…</span>
                                                        </>
                                                    ) : hasNewGames === true ? (
                                                        <>
                                                            <RefreshCw size={12} className="text-emerald-400" />
                                                            <span className="text-emerald-400">New games available</span>
                                                        </>
                                                    ) : hasNewGames === false ? (
                                                        <span>Up to date</span>
                                                    ) : (
                                                        <span>New games check pending</span>
                                                    )}
                                                </div>
                                                {lastCheckedAt && (
                                                    <span>Checked {new Date(lastCheckedAt).toLocaleDateString()}</span>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="mt-6 min-h-[40px] flex justify-center">
                            {status === 'success' && (
                                <div className="flex items-center gap-3 text-emerald-400 justify-center animate-fade-in">
                                    <CheckCircle size={18} />
                                    <span className="font-medium text-sm">Sync Complete! Redirecting...</span>
                                </div>
                            )}

                            {status === 'error' && (
                                <div className="flex items-center gap-3 text-red-400 justify-center animate-fade-in">
                                    <AlertCircle size={18} />
                                    <span className="font-medium text-sm">{message}</span>
                                </div>
                            )}
                        </div>
                    </div>

                    <div className="bg-panel border border-white/5 rounded-2xl p-8 shadow-2xl animate-fade-in relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-400 to-blue-500" />

                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold text-primary mb-2">Import PGN</h2>
                            <p className="text-secondary text-sm">Analyze master games or any custom PGN without affecting hero analytics.</p>
                        </div>

                        <form onSubmit={handlePgnImport} className="flex flex-col gap-4">
                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Import Label (Optional)</label>
                                <input
                                    type="text"
                                    value={pgnTag}
                                    onChange={(e) => setPgnTag(e.target.value)}
                                    placeholder="e.g. Tal vs Fischer"
                                    className="input w-full bg-subtle focus:ring-2 focus:ring-emerald-500/50"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">PGN Content</label>
                                <textarea
                                    value={pgnText}
                                    onChange={(e) => setPgnText(e.target.value)}
                                    placeholder="Paste one or more PGNs here..."
                                    rows={8}
                                    className="input w-full bg-subtle focus:ring-2 focus:ring-emerald-500/50 resize-none"
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Upload PGN File</label>
                                <div className="flex items-center gap-3">
                                    <input
                                        type="file"
                                        accept=".pgn"
                                        onChange={handlePgnFile}
                                        className="text-xs text-muted"
                                    />
                                    {pgnFileName && <span className="text-xs text-secondary">{pgnFileName}</span>}
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={pgnStatus === 'loading'}
                                className="btn btn-primary w-full py-4 text-base font-medium shadow-lg shadow-emerald-500/20"
                            >
                                {pgnStatus === 'loading' ? (
                                    <span className="flex items-center gap-2 justify-center">
                                        <Loader2 size={16} className="animate-spin" /> Importing...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2 justify-center">
                                        <FileUp size={18} /> Import PGN
                                    </span>
                                )}
                            </button>
                        </form>

                        <div className="mt-6 min-h-[40px] flex flex-col items-center gap-2">
                            {pgnStatus === 'success' && (
                                <div className="flex items-center gap-3 text-emerald-400 justify-center animate-fade-in">
                                    <CheckCircle size={18} />
                                    <span className="font-medium text-sm">{pgnMessage} Redirecting...</span>
                                </div>
                            )}
                            {pgnStatus === 'error' && (
                                <div className="flex items-center gap-3 text-red-400 justify-center animate-fade-in">
                                    <AlertCircle size={18} />
                                    <span className="font-medium text-sm">{pgnMessage}</span>
                                </div>
                            )}
                            {pgnStats && (
                                <div className="text-xs text-muted">
                                    {pgnStats.errors ? `${pgnStats.errors} invalid PGN(s) skipped.` : 'PGN import complete.'}
                                </div>
                            )}
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
