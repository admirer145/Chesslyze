import React, { useMemo, useState, useEffect } from 'react';
import { Download, CheckCircle, AlertCircle, Loader2, ArrowLeftRight, RefreshCw, FileUp } from 'lucide-react';
import { syncUserGames, fetchLichessUser, fetchLichessGames } from '../../services/lichess';
import { getLatestGameTimestamp } from '../../services/db';
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

    const handleSync = async () => {
        if (!username) return;

        setStatus('loading');
        setProgress({ type: 'start', message: 'Connecting to Lichess...' });
        setMessage('Initializing sync...');

        try {
            await syncUserGames(username, (p) => {
                setProgress(p);
                if (p.message) setMessage(p.message);
            }, {
                fullSync: false,
                startTime: userStats?.createdAt
            });
            setStatus('success');
            setHasNewGames(false);
            const now = Date.now();
            setLastCheckedAt(now);
            localStorage.setItem(newCheckAtKey(username), String(now));
            localStorage.setItem(newCheckHasKey(username), 'false');
            // Navigate to library after successful sync
            setTimeout(() => {
                navigate('/library');
            }, 1500);
        } catch (err) {
            console.error(err);
            setStatus('error');
            setMessage(err.message);
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
        } catch (err) {
            console.error(err);
            setPgnStatus('error');
            setPgnMessage(err.message || 'Failed to import PGN.');
        }
    };

    return (
        <div className="h-full bg-app p-8 overflow-y-auto">
            <div className="w-full max-w-5xl mx-auto grid gap-6 lg:grid-cols-2">
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
                            <div className="flex items-center gap-4 border-b border-white/10 pb-6">
                                <div className="w-12 h-12 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 flex items-center justify-center text-xl font-bold text-white shadow-lg">
                                    {userStats.username.charAt(0).toUpperCase()}
                                </div>
                                <div className="flex flex-col">
                                    <span className="text-lg font-bold text-primary">{userStats.username}</span>
                                    <span className="text-xs text-secondary">Joined {new Date(userStats.createdAt).toLocaleDateString()}</span>
                                </div>
                                <div className="ml-auto flex items-center gap-4">
                                    <div className="text-right">
                                        <div className="text-2xl font-bold text-accent-primary">{userStats.count?.all || 0}</div>
                                        <div className="text-xs text-muted">Total Games</div>
                                    </div>
                                    <button
                                        onClick={() => {
                                            setUserStats(null);
                                            setLastSyncDate(null);
                                            setHasNewGames(null);
                                            setLastCheckedAt(null);
                                        }}
                                        className="btn btn-secondary px-3 py-2 text-xs"
                                    >
                                        <ArrowLeftRight size={14} className="mr-2" />
                                        Change User
                                    </button>
                                </div>
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

                            <div className="flex flex-col gap-3">
                                {status === 'loading' ? (
                                    <div className="bg-subtle/50 p-4 rounded-xl flex flex-col gap-3 border border-white/5">
                                        <div className="flex items-center gap-3 text-sm text-primary">
                                            <Loader2 size={16} className="animate-spin text-accent-primary" />
                                            <span>{message || 'Syncing...'}</span>
                                        </div>
                                        {progress?.currentSince && (
                                            <div className="w-full bg-black/50 h-1.5 rounded-full overflow-hidden">
                                                <div
                                                    className="h-full bg-accent-primary transition-all duration-300 relative overflow-hidden"
                                                    style={{ width: `${Math.min(100, ((progress.currentSince - userStats.createdAt) / (Date.now() - userStats.createdAt)) * 100)}%` }}
                                                >
                                                    <div className="absolute inset-0 bg-white/20 animate-pulse" />
                                                </div>
                                            </div>
                                        )}
                                        {progress?.type === 'added' && (
                                            <div className="flex justify-between items-center mt-1">
                                                <span className="text-xs text-muted uppercase tracking-wider">Imported</span>
                                                <span className="text-lg font-bold text-accent-primary">{progress.total}</span>
                                            </div>
                                        )}
                                    </div>
                                ) : (
                                    <>
                                        <button
                                            onClick={() => handleSync()}
                                            disabled={status === 'loading'}
                                            className="btn btn-primary w-full py-4 text-base font-medium shadow-lg shadow-blue-500/20"
                                        >
                                            <Download size={18} className="mr-2" />
                                            {lastSyncDate ? 'Sync Latest Games' : 'Start Import'}
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
                                <span className="font-medium text-sm">{pgnMessage}</span>
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
    );
};
