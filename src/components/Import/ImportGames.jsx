import React, { useState, useEffect } from 'react';
import { Download, CheckCircle, AlertCircle, Loader2, ArrowLeftRight, RefreshCw, FileUp, Zap, Calendar, Archive, Play, X } from 'lucide-react';
import { syncUserGames, fetchLichessUser, fetchLichessGames } from '../../services/lichess';
import { syncChessComGames, fetchChessComUser, hasChessComNewGames } from '../../services/chesscom';
import { getLatestGameTimestampForProfile, loadImportProgress, clearImportProgress } from '../../services/db';
import { upsertHeroProfile } from '../../services/heroProfiles';
import { useRef } from 'react';
import { importPgnGames } from '../../services/pgn';
import { useNavigate } from 'react-router-dom';

export const ImportGames = () => {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    const [, setProgress] = useState(null);
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

    const [chesscomUsername, setChesscomUsername] = useState('');
    const [ccStatus, setCcStatus] = useState('idle');
    const [ccMessage, setCcMessage] = useState('');
    const [, setCcProgress] = useState(null);
    const [ccUserStats, setCcUserStats] = useState(null);
    const [ccLastSyncDate, setCcLastSyncDate] = useState(null);
    const [ccHasNewGames, setCcHasNewGames] = useState(null);
    const [ccCheckingNew, setCcCheckingNew] = useState(false);
    const [ccLastCheckedAt, setCcLastCheckedAt] = useState(null);
    const [ccImportMode, setCcImportMode] = useState('smart');
    const [ccCustomDateRange, setCcCustomDateRange] = useState({ since: null, until: null });
    const [ccCanResume, setCcCanResume] = useState(false);
    const [ccResumeData, setCcResumeData] = useState(null);
    const ccAbortRef = useRef(null);
    const [ccImportTotal, setCcImportTotal] = useState(0);
    const [ccImportPct, setCcImportPct] = useState(0);

    useEffect(() => {
        const handleResize = () => setIsSmallScreen(window.innerWidth < 640);
        window.addEventListener('resize', handleResize);
        return () => window.removeEventListener('resize', handleResize);
    }, []);

    const USER_STATS_TTL_MS = 24 * 60 * 60 * 1000;
    const NEW_GAMES_CHECK_TTL_MS = 6 * 60 * 60 * 1000;

    const statsCacheKey = (platform, user) => `heroUserStats:${platform}:${user.toLowerCase()}`;
    const statsCacheAtKey = (platform, user) => `heroUserStatsAt:${platform}:${user.toLowerCase()}`;
    const newCheckAtKey = (platform, user) => `heroNewCheckAt:${platform}:${user.toLowerCase()}`;
    const newCheckHasKey = (platform, user) => `heroNewCheckHas:${platform}:${user.toLowerCase()}`;
    const lastUserKey = (platform) => `heroLastUser:${platform}`;

    const readCachedStats = (platform, user) => {
        try {
            const raw = localStorage.getItem(statsCacheKey(platform, user));
            if (!raw) return null;
            return JSON.parse(raw);
        } catch {
            return null;
        }
    };

    const writeCachedStats = (platform, user, stats) => {
        localStorage.setItem(statsCacheKey(platform, user), JSON.stringify(stats));
        localStorage.setItem(statsCacheAtKey(platform, user), String(Date.now()));
    };

    const refreshLastSyncDate = async (user) => {
        const lastSync = await getLatestGameTimestampForProfile('lichess', user);
        setLastSyncDate(lastSync);
        return lastSync;
    };

    const refreshChessComLastSyncDate = async (user) => {
        const lastSync = await getLatestGameTimestampForProfile('chesscom', user);
        setCcLastSyncDate(lastSync);
        return lastSync;
    };

    const maybeCheckForNewGames = async (user, lastSync) => {
        if (!user || !lastSync) {
            setHasNewGames(null);
            return;
        }
        const lastChecked = parseInt(localStorage.getItem(newCheckAtKey('lichess', user)) || '0', 10);
        const cachedHas = localStorage.getItem(newCheckHasKey('lichess', user));

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
            localStorage.setItem(newCheckAtKey('lichess', user), String(now));
            localStorage.setItem(newCheckHasKey('lichess', user), String(hasNew));
        } catch (err) {
            console.error(err);
        } finally {
            setCheckingNew(false);
        }
    };

    const maybeCheckForChessComNewGames = async (user, lastSync) => {
        if (!user || !lastSync) {
            setCcHasNewGames(null);
            return;
        }
        const lastChecked = parseInt(localStorage.getItem(newCheckAtKey('chesscom', user)) || '0', 10);
        const cachedHas = localStorage.getItem(newCheckHasKey('chesscom', user));

        if (lastChecked && Date.now() - lastChecked < NEW_GAMES_CHECK_TTL_MS) {
            if (cachedHas !== null) setCcHasNewGames(cachedHas === 'true');
            setCcLastCheckedAt(lastChecked);
            return;
        }

        setCcCheckingNew(true);
        try {
            const hasNew = await hasChessComNewGames(user, lastSync);
            setCcHasNewGames(hasNew);
            const now = Date.now();
            setCcLastCheckedAt(now);
            localStorage.setItem(newCheckAtKey('chesscom', user), String(now));
            localStorage.setItem(newCheckHasKey('chesscom', user), String(hasNew));
        } catch (err) {
            console.error(err);
        } finally {
            setCcCheckingNew(false);
        }
    };

    const handleFetchStats = async (e, options = {}) => {
        if (e && e.preventDefault) e.preventDefault();
        const userToFetch = typeof e === 'string' ? e : username;
        if (!userToFetch) return;

        const { useCache = false, silent = false } = options;
        if (useCache) {
            const cachedAt = parseInt(localStorage.getItem(statsCacheAtKey('lichess', userToFetch)) || '0', 10);
            const cached = readCachedStats('lichess', userToFetch);
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
            writeCachedStats('lichess', userToFetch, stats);

            // Fetch last sync date
            const lastSync = await refreshLastSyncDate(userToFetch);
            await maybeCheckForNewGames(userToFetch, lastSync);

            localStorage.setItem(lastUserKey('lichess'), userToFetch);
            await upsertHeroProfile({ platform: 'lichess', username: userToFetch, displayName: stats?.username || userToFetch });
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
        const lastUser = localStorage.getItem(lastUserKey('lichess'));
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
            const progress = await loadImportProgress('lichess', username);
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
                if (p.percentage !== undefined) {
                    const pct = Number.isFinite(p.percentage) ? p.percentage : 0;
                    setImportPct(Math.max(0, Math.min(100, pct)));
                }
            }, syncOptions);

            abortRef.current = null;

            if (result.cancelled) {
                setStatus('idle');
                setMessage(`Import cancelled. ${result.totalImported} games saved.`);
                // Reload resume data
                const prog = await loadImportProgress('lichess', username);
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
            await refreshLastSyncDate(username);
            const now = Date.now();
            setLastCheckedAt(now);
            localStorage.setItem(newCheckAtKey('lichess', username), String(now));
            localStorage.setItem(newCheckHasKey('lichess', username), 'false');

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
                const prog = await loadImportProgress('lichess', username);
                if (prog) setResumeData(prog);
            }
        }
    };

    const handleCancel = () => {
        if (abortRef.current) {
            abortRef.current.abort();
        }
    };

    const handleChessComFetchStats = async (e, options = {}) => {
        if (e && e.preventDefault) e.preventDefault();
        const userToFetch = typeof e === 'string' ? e : chesscomUsername;
        if (!userToFetch) return;

        const { useCache = false, silent = false } = options;
        if (useCache) {
            const cachedAt = parseInt(localStorage.getItem(statsCacheAtKey('chesscom', userToFetch)) || '0', 10);
            const cached = readCachedStats('chesscom', userToFetch);
            if (cached && cachedAt && Date.now() - cachedAt < USER_STATS_TTL_MS) {
                setCcUserStats(cached);
                const lastSync = await refreshChessComLastSyncDate(userToFetch);
                await maybeCheckForChessComNewGames(userToFetch, lastSync);
                return;
            }
        }

        if (!silent) {
            setCcStatus('loading');
            setCcMessage('Fetching user profile...');
        }
        try {
            const stats = await fetchChessComUser(userToFetch);
            setCcUserStats(stats);
            writeCachedStats('chesscom', userToFetch, stats);

            const lastSync = await refreshChessComLastSyncDate(userToFetch);
            await maybeCheckForChessComNewGames(userToFetch, lastSync);

            localStorage.setItem(lastUserKey('chesscom'), userToFetch);
            await upsertHeroProfile({ platform: 'chesscom', username: userToFetch, displayName: stats?.username || userToFetch });
            if (typeof e === 'string') setChesscomUsername(userToFetch);
            if (!silent) {
                setCcStatus('idle');
                setCcMessage('');
            }
        } catch (err) {
            console.error(err);
            if (!silent) {
                setCcStatus('error');
                setCcMessage(err.message);
            }
        }
    };

    useEffect(() => {
        const lastUser = localStorage.getItem(lastUserKey('chesscom'));
        if (lastUser) {
            setChesscomUsername(lastUser);
            setTimeout(() => handleChessComFetchStats(lastUser, { useCache: true, silent: true }), 0);
        }
    }, []);

    useEffect(() => {
        const checkResumable = async () => {
            if (!chesscomUsername) return;
            const progress = await loadImportProgress('chesscom', chesscomUsername);
            if (progress && (progress.status === 'in-progress' || progress.status === 'paused')) {
                setCcCanResume(true);
                setCcResumeData(progress);
            } else {
                setCcCanResume(false);
                setCcResumeData(null);
            }
        };
        checkResumable();
    }, [chesscomUsername]);

    const handleChessComSync = async (resumeMode = false) => {
        if (!chesscomUsername) return;

        if (ccImportMode === 'custom' && (!ccCustomDateRange.since || !ccCustomDateRange.until)) {
            setCcStatus('error');
            setCcMessage('Please select both a start and end date for custom import.');
            return;
        }
        if (ccImportMode === 'custom' && ccCustomDateRange.since >= ccCustomDateRange.until) {
            setCcStatus('error');
            setCcMessage('Start date must be before end date.');
            return;
        }

        const controller = new AbortController();
        ccAbortRef.current = controller;

        setCcStatus('loading');
        setCcImportTotal(resumeMode ? (ccResumeData?.totalImported || 0) : 0);
        setCcImportPct(0);
        setCcProgress({ type: 'start', message: 'Initializing import...' });
        setCcMessage('Starting import...');

        try {
            const syncOptions = {
                mode: ccImportMode,
                resumeFrom: resumeMode ? ccResumeData : null,
                signal: controller.signal
            };

            if (ccImportMode === 'custom') {
                syncOptions.since = ccCustomDateRange.since;
                syncOptions.until = ccCustomDateRange.until;
            }

            const result = await syncChessComGames(chesscomUsername, (p) => {
                setCcProgress(p);
                if (p.message) setCcMessage(p.message);
                if (p.total !== undefined) setCcImportTotal(p.total);
                if (p.percentage !== undefined) {
                    const pct = Number.isFinite(p.percentage) ? p.percentage : 0;
                    setCcImportPct(Math.max(0, Math.min(100, pct)));
                }
            }, syncOptions);

            ccAbortRef.current = null;

            if (result.cancelled) {
                setCcStatus('idle');
                setCcMessage(`Import cancelled. ${result.totalImported} games saved.`);
                const prog = await loadImportProgress('chesscom', chesscomUsername);
                if (prog) {
                    setCcCanResume(true);
                    setCcResumeData(prog);
                }
                return;
            }

            setCcStatus('success');
            setCcCanResume(false);
            setCcResumeData(null);
            setCcHasNewGames(false);
            await refreshChessComLastSyncDate(chesscomUsername);
            const now = Date.now();
            setCcLastCheckedAt(now);
            localStorage.setItem(newCheckAtKey('chesscom', chesscomUsername), String(now));
            localStorage.setItem(newCheckHasKey('chesscom', chesscomUsername), 'false');

            if (result.failedChunks && result.failedChunks.length > 0) {
                setCcMessage(`Import completed with ${result.failedChunks.length} failed chunks. ${result.totalImported} games imported.`);
            }

            setTimeout(() => navigate('/library'), 2000);
        } catch (err) {
            console.error(err);
            ccAbortRef.current = null;
            setCcStatus('error');
            setCcMessage(err.message);

            if (err.message.includes('Too many rate limit errors')) {
                setCcCanResume(true);
                const prog = await loadImportProgress('chesscom', chesscomUsername);
                if (prog) setCcResumeData(prog);
            }
        }
    };

    const handleChessComCancel = () => {
        if (ccAbortRef.current) {
            ccAbortRef.current.abort();
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
                    <p className="text-secondary text-sm max-w-md mx-auto">Sync your Lichess or Chess.com history, or paste PGN files to start analyzing and improving.</p>
                </div>
                <div className="import-cards-grid">
                    <div className="bg-panel border border-white/5 rounded-2xl p-8 shadow-2xl animate-fade-in relative overflow-hidden">
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500" />

                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold text-primary mb-2">Sync Lichess Games</h2>
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
                                            className={`btn ${importMode === 'smart' ? 'bg-blue-600 text-white ring-2 ring-blue-500' : 'btn-secondary'} py-3 flex flex-col items-center gap-1 transition-all`}
                                            type="button"
                                        >
                                            <Zap size={16} />
                                            <span className="text-[11px] font-semibold">Quick</span>
                                            <span className={`text-[9px] ${importMode === 'smart' ? 'text-blue-100' : 'text-muted'}`}>Last 7 days</span>
                                        </button>

                                        <button
                                            onClick={() => setImportMode('custom')}
                                            className={`btn ${importMode === 'custom' ? 'bg-blue-600 text-white ring-2 ring-blue-500' : 'btn-secondary'} py-3 flex flex-col items-center gap-1 transition-all`}
                                            type="button"
                                        >
                                            <Calendar size={16} />
                                            <span className="text-[11px] font-semibold">Custom</span>
                                            <span className={`text-[9px] ${importMode === 'custom' ? 'text-blue-100' : 'text-muted'}`}>Date range</span>
                                        </button>

                                        <button
                                            onClick={() => setImportMode('full')}
                                            className={`btn ${importMode === 'full' ? 'bg-blue-600 text-white ring-2 ring-blue-500' : 'btn-secondary'} py-3 flex flex-col items-center gap-1 transition-all`}
                                            type="button"
                                        >
                                            <Archive size={16} />
                                            <span className="text-[11px] font-semibold">Full</span>
                                            <span className={`text-[9px] ${importMode === 'full' ? 'text-blue-100' : 'text-muted'}`}>All history</span>
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
                                                            await clearImportProgress('lichess', username);
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
                        <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-emerald-500 to-amber-500" />

                        <div className="text-center mb-8">
                            <h2 className="text-2xl font-bold text-primary mb-2">Sync Chess.com Games</h2>
                            <p className="text-secondary text-sm">Connect your Chess.com account to import your personal history.</p>
                        </div>

                        {!ccUserStats ? (
                            <form onSubmit={handleChessComFetchStats} className="flex flex-col gap-6 w-full">
                                <div className="flex flex-col gap-2">
                                    <label className="text-xs font-semibold text-muted uppercase tracking-wider">Chess.com Username</label>
                                    <input
                                        type="text"
                                        value={chesscomUsername}
                                        onChange={(e) => setChesscomUsername(e.target.value)}
                                        placeholder="e.g. Hikaru"
                                        className="input w-full bg-subtle focus:ring-2 focus:ring-emerald-500/50"
                                        required
                                    />
                                </div>
                                <button
                                    type="submit"
                                    disabled={ccStatus === 'loading'}
                                    className="btn btn-primary w-full py-3 mt-2 shadow-lg shadow-emerald-500/20"
                                >
                                    {ccStatus === 'loading' ? (
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
                                            <div style={{ width: 44, height: 44, borderRadius: '50%', background: 'linear-gradient(135deg, #10b981, #f59e0b)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 18, fontWeight: 700, color: '#fff', flexShrink: 0 }}>
                                                {ccUserStats.username.charAt(0).toUpperCase()}
                                            </div>
                                            <div style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
                                                <span className="text-primary" style={{ fontSize: 16, fontWeight: 700, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ccUserStats.username}</span>
                                                <span className="text-secondary" style={{ fontSize: 11 }}>{ccUserStats.createdAt ? `Joined ${new Date(ccUserStats.createdAt).toLocaleDateString()}` : 'Joined date unknown'}</span>
                                            </div>
                                        </div>

                                        <div style={{
                                            textAlign: 'center',
                                            padding: '4px 14px',
                                            borderRadius: 10,
                                            background: 'rgba(16,185,129,0.08)',
                                            border: '1px solid rgba(16,185,129,0.2)',
                                            marginLeft: isSmallScreen ? '0' : 'auto',
                                            marginRight: isSmallScreen ? '0' : 'auto',
                                            flexShrink: 0
                                        }}>
                                            <div style={{ fontSize: 18, fontWeight: 800, background: 'linear-gradient(90deg, #10b981, #f59e0b)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>{ccUserStats.count?.all || 0}</div>
                                            <div style={{ fontSize: 8, fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.05em', color: 'rgba(16,185,129,0.7)' }}>Total Games</div>
                                        </div>

                                        {!isSmallScreen && (
                                            <button
                                                onClick={() => {
                                                    setCcUserStats(null);
                                                    setCcLastSyncDate(null);
                                                    setCcHasNewGames(null);
                                                    setCcLastCheckedAt(null);
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
                                                setCcUserStats(null);
                                                setCcLastSyncDate(null);
                                                setCcHasNewGames(null);
                                                setCcLastCheckedAt(null);
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
                                        <div className="text-emerald-400 font-bold text-xl">{ccUserStats.count?.win || 0}</div>
                                        <div className="text-[10px] text-emerald-400/70 font-bold uppercase tracking-wider">Wins</div>
                                    </div>
                                    <div className="bg-rose-500/5 border border-rose-500/10 p-3 rounded-xl flex flex-col gap-1">
                                        <div className="text-rose-400 font-bold text-xl">{ccUserStats.count?.loss || 0}</div>
                                        <div className="text-[10px] text-rose-400/70 font-bold uppercase tracking-wider">Losses</div>
                                    </div>
                                    <div className="bg-blue-500/5 border border-blue-500/10 p-3 rounded-xl flex flex-col gap-1">
                                        <div className="text-blue-400 font-bold text-xl">{ccUserStats.count?.draw || 0}</div>
                                        <div className="text-[10px] text-blue-400/70 font-bold uppercase tracking-wider">Draws</div>
                                    </div>
                                </div>

                                <div className="flex flex-col gap-3 pb-4 border-b border-white/5">
                                    <label className="text-xs font-semibold text-muted uppercase tracking-wider">
                                        Import Mode
                                    </label>

                                    <div className="grid grid-cols-3 gap-2">
                                        <button
                                            onClick={() => setCcImportMode('smart')}
                                            className={`btn ${ccImportMode === 'smart' ? 'bg-blue-600 text-white ring-2 ring-blue-500' : 'btn-secondary'} py-3 flex flex-col items-center gap-1 transition-all`}
                                            type="button"
                                        >
                                            <Zap size={16} />
                                            <span className="text-[11px] font-semibold">Quick</span>
                                            <span className={`text-[9px] ${ccImportMode === 'smart' ? 'text-blue-100' : 'text-muted'}`}>Last 90 days</span>
                                        </button>

                                        <button
                                            onClick={() => setCcImportMode('custom')}
                                            className={`btn ${ccImportMode === 'custom' ? 'bg-blue-600 text-white ring-2 ring-blue-500' : 'btn-secondary'} py-3 flex flex-col items-center gap-1 transition-all`}
                                            type="button"
                                        >
                                            <Calendar size={16} />
                                            <span className="text-[11px] font-semibold">Custom</span>
                                            <span className={`text-[9px] ${ccImportMode === 'custom' ? 'text-blue-100' : 'text-muted'}`}>Date range</span>
                                        </button>

                                        <button
                                            onClick={() => setCcImportMode('full')}
                                            className={`btn ${ccImportMode === 'full' ? 'bg-blue-600 text-white ring-2 ring-blue-500' : 'btn-secondary'} py-3 flex flex-col items-center gap-1 transition-all`}
                                            type="button"
                                        >
                                            <Archive size={16} />
                                            <span className="text-[11px] font-semibold">Full</span>
                                            <span className={`text-[9px] ${ccImportMode === 'full' ? 'text-blue-100' : 'text-muted'}`}>All history</span>
                                        </button>
                                    </div>

                                    {ccImportMode === 'custom' && (
                                        <div className="flex flex-col gap-3 p-3 bg-subtle/30 rounded-xl border border-white/5 mt-2">
                                            <div className="grid grid-cols-2 gap-2">
                                                <div>
                                                    <label className="text-[10px] text-muted mb-1 block uppercase tracking-wider">From Date</label>
                                                    <input
                                                        type="date"
                                                        value={ccCustomDateRange.since ? new Date(ccCustomDateRange.since).toISOString().split('T')[0] : ''}
                                                        onChange={(e) => setCcCustomDateRange(prev => ({
                                                            ...prev,
                                                            since: new Date(e.target.value).getTime()
                                                        }))}
                                                        className="input w-full text-xs"
                                                        max={ccCustomDateRange.until ? new Date(ccCustomDateRange.until).toISOString().split('T')[0] : new Date().toISOString().split('T')[0]}
                                                    />
                                                </div>

                                                <div>
                                                    <label className="text-[10px] text-muted mb-1 block uppercase tracking-wider">To Date</label>
                                                    <input
                                                        type="date"
                                                        value={ccCustomDateRange.until ? new Date(ccCustomDateRange.until).toISOString().split('T')[0] : ''}
                                                        onChange={(e) => {
                                                            const date = new Date(e.target.value);
                                                            date.setHours(23, 59, 59, 999);
                                                            setCcCustomDateRange(prev => ({
                                                                ...prev,
                                                                until: date.getTime()
                                                            }));
                                                        }}
                                                        className="input w-full text-xs"
                                                        min={ccCustomDateRange.since ? new Date(ccCustomDateRange.since).toISOString().split('T')[0] : undefined}
                                                        max={new Date().toISOString().split('T')[0]}
                                                    />
                                                </div>
                                            </div>
                                        </div>
                                    )}
                                </div>

                                {ccCanResume && ccResumeData && ccStatus !== 'loading' && (
                                    <div className="p-3 bg-emerald-500/10 border border-emerald-500/20 rounded-xl">
                                        <div className="flex items-start gap-2">
                                            <AlertCircle size={16} className="text-emerald-400 mt-0.5 flex-shrink-0" />
                                            <div className="flex-1 min-w-0">
                                                <div className="text-xs font-semibold text-primary mb-1">
                                                    Previous Import Found
                                                </div>
                                                <div className="text-[10px] text-secondary mb-2">
                                                    {ccResumeData.totalImported || 0} games imported so far. Resume to continue from where you left off.
                                                </div>
                                                <div className="flex gap-2">
                                                    <button
                                                        onClick={() => handleChessComSync(true)}
                                                        className="btn btn-primary text-[10px] py-1.5 px-3"
                                                        type="button"
                                                    >
                                                        <Play size={10} className="mr-1" />
                                                        Resume
                                                    </button>
                                                    <button
                                                        onClick={async () => {
                                                            await clearImportProgress('chesscom', chesscomUsername);
                                                            setCcCanResume(false);
                                                            setCcResumeData(null);
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
                                    {ccStatus === 'loading' ? (
                                        <div className="bg-subtle/50 p-4 rounded-xl flex flex-col gap-3 border border-white/5">
                                            <div className="flex items-center justify-between">
                                                <div className="flex items-center gap-3 text-sm text-primary">
                                                    <Loader2 size={16} className="animate-spin text-accent-primary" />
                                                    <span className="truncate">{ccMessage || 'Importing...'}</span>
                                                </div>
                                                <button
                                                    onClick={handleChessComCancel}
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
                                                    className="h-full bg-gradient-to-r from-emerald-500 to-amber-500 transition-all duration-500"
                                                    style={{ width: `${Math.min(100, ccImportPct)}%` }}
                                                />
                                            </div>

                                            <div className="grid grid-cols-2 gap-2 text-xs">
                                                <div className="text-center p-2 bg-black/30 rounded-lg">
                                                    <div className="text-muted mb-0.5">Total Imported</div>
                                                    <div className="text-accent-primary font-bold text-lg">{ccImportTotal}</div>
                                                </div>
                                                <div className="text-center p-2 bg-black/30 rounded-lg">
                                                    <div className="text-muted mb-0.5">Progress</div>
                                                    <div className="text-secondary font-bold text-lg">{Math.round(ccImportPct)}%</div>
                                                </div>
                                            </div>
                                        </div>
                                    ) : (
                                        <>
                                            {ccImportMode === 'custom' && (
                                                <div className="text-center mb-2 min-h-[16px]">
                                                    {(!ccCustomDateRange.since || !ccCustomDateRange.until) ? (
                                                        <span className="text-xs text-secondary animate-pulse">Please select both start and end dates</span>
                                                    ) : (ccCustomDateRange.since > ccCustomDateRange.until) ? (
                                                        <span className="text-xs text-red-400 font-medium">Start date cannot be after end date</span>
                                                    ) : null}
                                                </div>
                                            )}
                                            <button
                                                onClick={() => handleChessComSync()}
                                                disabled={
                                                    ccStatus === 'loading' ||
                                                    (ccImportMode === 'custom' && (!ccCustomDateRange.since || !ccCustomDateRange.until || ccCustomDateRange.since > ccCustomDateRange.until))
                                                }
                                                className="btn btn-primary w-full py-4 text-base font-medium shadow-lg shadow-emerald-500/20 disabled:opacity-50 disabled:cursor-not-allowed"
                                            >
                                                <Download size={18} className="mr-2" />
                                                {ccImportMode === 'smart'
                                                    ? (ccLastSyncDate ? 'Sync Latest Games' : 'Start Quick Import')
                                                    : ccImportMode === 'custom'
                                                        ? 'Import Range'
                                                        : 'Import Full History'
                                                }
                                            </button>
                                            <div className="flex items-center justify-between text-xs text-muted px-1">
                                                <div className="flex items-center gap-2">
                                                    {ccCheckingNew ? (
                                                        <>
                                                            <Loader2 size={12} className="animate-spin text-accent-primary" />
                                                            <span>Checking for new games…</span>
                                                        </>
                                                    ) : ccHasNewGames === true ? (
                                                        <>
                                                            <RefreshCw size={12} className="text-emerald-400" />
                                                            <span className="text-emerald-400">New games available</span>
                                                        </>
                                                    ) : ccHasNewGames === false ? (
                                                        <span>Up to date</span>
                                                    ) : (
                                                        <span>New games check pending</span>
                                                    )}
                                                </div>
                                                {ccLastCheckedAt && (
                                                    <span>Checked {new Date(ccLastCheckedAt).toLocaleDateString()}</span>
                                                )}
                                            </div>
                                        </>
                                    )}
                                </div>
                            </div>
                        )}

                        <div className="mt-6 min-h-[40px] flex justify-center">
                            {ccStatus === 'success' && (
                                <div className="flex items-center gap-3 text-emerald-400 justify-center animate-fade-in">
                                    <CheckCircle size={18} />
                                    <span className="font-medium text-sm">Sync Complete! Redirecting...</span>
                                </div>
                            )}

                            {ccStatus === 'error' && (
                                <div className="flex items-center gap-3 text-red-400 justify-center animate-fade-in">
                                    <AlertCircle size={18} />
                                    <span className="font-medium text-sm">{ccMessage}</span>
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
