import React, { useMemo, useState, useEffect } from 'react';
import { Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { syncUserGames, fetchLichessUser } from '../../services/lichess';
import { getLatestGameTimestamp } from '../../services/db';
import { useNavigate } from 'react-router-dom';

export const ImportGames = () => {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    const [progress, setProgress] = useState(null);
    const [userStats, setUserStats] = useState(null);
    const [lastSyncDate, setLastSyncDate] = useState(null);

    const handleFetchStats = async (e) => {
        if (e && e.preventDefault) e.preventDefault();
        const userToFetch = typeof e === 'string' ? e : username;
        if (!userToFetch) return;

        setStatus('loading');
        setMessage('Fetching user profile...');
        try {
            const stats = await fetchLichessUser(userToFetch);
            setUserStats(stats);

            // Fetch last sync date
            const lastSync = await getLatestGameTimestamp(userToFetch);
            setLastSyncDate(lastSync);

            localStorage.setItem('heroUser', userToFetch);
            if (typeof e === 'string') setUsername(userToFetch);
            setStatus('idle');
            setMessage('');
        } catch (err) {
            console.error(err);
            setStatus('error');
            setMessage(err.message);
        }
    };

    useEffect(() => {
        const lastUser = localStorage.getItem('heroUser');
        if (lastUser) {
            setUsername(lastUser);
            // Wait for state to settle
            setTimeout(() => handleFetchStats(lastUser), 0);
        }
    }, []);

    const handleSync = async (fullSync = false) => {
        if (!username) return;

        setStatus('loading');
        setProgress({ type: 'start', message: 'Connecting to Lichess...' });
        setMessage('Initializing sync...');

        try {
            await syncUserGames(username, (p) => {
                setProgress(p);
                if (p.message) setMessage(p.message);
            }, {
                fullSync,
                startTime: userStats?.createdAt
            });
            setStatus('success');
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

    return (
        <div className="h-full flex items-center justify-center bg-app p-8">
            <div className="max-w-md w-full bg-panel border border-white/5 rounded-2xl p-8 shadow-2xl animate-fade-in relative overflow-hidden">
                {/* Background Glow */}
                <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 to-purple-500" />

                <div className="text-center mb-8">
                    <h2 className="text-2xl font-bold text-primary mb-2">Sync Games</h2>
                    <p className="text-secondary text-sm">Connect your Lichess account to import your history.</p>
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
                            <div className="ml-auto text-right">
                                <div className="text-2xl font-bold text-accent-primary">{userStats.count?.all || 0}</div>
                                <div className="text-xs text-muted">Total Games</div>
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
                                        onClick={() => handleSync(false)}
                                        disabled={status === 'loading'}
                                        className="btn btn-primary w-full py-4 text-base font-medium shadow-lg shadow-blue-500/20"
                                    >
                                        <Download size={18} className="mr-2" />
                                        {lastSyncDate ? 'Sync Latest Games' : 'Start Import'}
                                    </button>
                                    <button
                                        onClick={() => handleSync(true)}
                                        disabled={status === 'loading'}
                                        className="btn btn-secondary w-full py-2 text-xs opacity-70 hover:opacity-100"
                                    >
                                        Resync All History (Slower)
                                    </button>
                                </>
                            )}
                        </div>

                        {status !== 'loading' && (
                            <button
                                onClick={() => setUserStats(null)}
                                className="text-xs text-muted hover:text-primary transition-colors text-center mt-2 pb-1 border-b border-transparent hover:border-muted px-4"
                            >
                                ← Switch Account
                            </button>
                        )}
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
        </div>
    );
};
