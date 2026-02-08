import React, { useMemo, useState, useEffect } from 'react';
import { Download, CheckCircle, AlertCircle, Loader2 } from 'lucide-react';
import { fetchLichessGames } from '../../services/lichess';
import { addGames, db } from '../../services/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';

export const ImportGames = () => {
    const navigate = useNavigate();
    const [username, setUsername] = useState('');
    const [maxGames, setMaxGames] = useState(50);
    const [status, setStatus] = useState('idle');
    const [message, setMessage] = useState('');
    const [page, setPage] = useState(1);
    const [filters, setFilters] = useState({
        result: 'all',
        color: 'all',
        opening: '',
        analyzed: 'all',
        perf: 'all',
        dateFrom: '',
        dateTo: '',
        player: ''
    });

    const heroUser = useMemo(() => localStorage.getItem('heroUser') || '', []);
    const pageSize = 10;

    const constructPgn = (game) => {
        const headers = [
            `[Event "${game.tournament || 'Casual'}"]`,
            `[Site "Lichess"]`,
            `[Date "${new Date(game.createdAt).toISOString().split('T')[0]}"]`,
            `[White "${game.players.white.user.name}"]`,
            `[Black "${game.players.black.user.name}"]`,
            `[Result "${game.winner ? (game.winner === 'white' ? '1-0' : '0-1') : '1/2-1/2'}"]`,
            `[WhiteElo "${game.players.white.rating || '?'}"]`,
            `[BlackElo "${game.players.black.rating || '?'}"]`,
            `[Variant "${game.variant || 'Standard'}"]`,
            `[ECO "${game.opening?.eco || '?'}"]`,
            `[Opening "${game.opening?.name || '?'}"]`
        ].join('\n');
        return `${headers}\n\n${game.moves}`;
    };

    const handleImport = async (e) => {
        e.preventDefault();
        if (!username) return;

        // Save username as preference for Dashboard orientation
        localStorage.setItem('heroUser', username);

        setStatus('loading');
        setMessage(`Connecting to Lichess API...`);

        try {
            const rawGames = await fetchLichessGames(username, maxGames);
            setMessage(`Found ${rawGames.length} games. Checking for duplicates...`);

            // 1. Check by Lichess ID (Primary method for new data)
            const gameIds = rawGames.map(g => g.id);
            const existingByLichessId = await db.games.where('lichessId').anyOf(gameIds).toArray();
            const existingLichessIds = new Set(existingByLichessId.map(g => g.lichessId));

            // 2. Check by Timestamp (Fallback for old data)
            const timestamps = rawGames.map(g => g.createdAt);
            const existingByTimestamp = await db.games.where('timestamp').anyOf(timestamps).toArray();
            const existingTimestamps = new Set(existingByTimestamp.map(g => g.timestamp));

            const newGames = rawGames
                .filter(game => !existingLichessIds.has(game.id) && !existingTimestamps.has(game.createdAt))
                .map(game => {
                    const pgn = game.pgn || constructPgn(game);

                    const speed = game.speed || game.perf || 'standard';
                    const timeControl = game.clock ? `${game.clock.initial}+${game.clock.increment}` : '';

                    return {
                        lichessId: game.id,
                        site: 'Lichess',
                        date: new Date(game.createdAt).toISOString(),
                        white: game.players.white.user.name,
                        black: game.players.black.user.name,
                        whiteRating: game.players.white.rating,
                        blackRating: game.players.black.rating,
                        perf: speed,
                        speed,
                        timeControl,
                        result: game.winner ? (game.winner === 'white' ? '1-0' : '0-1') : '1/2-1/2',
                        eco: game.opening?.eco || '',
                        openingName: game.opening?.name || 'Unknown Opening',
                        pgn: pgn,
                        timestamp: game.createdAt,
                        analyzed: false,
                        analysisStatus: 'idle'
                    };
                });

            if (newGames.length > 0) {
                await addGames(newGames);
                const skippedCount = rawGames.length - newGames.length;
                setStatus('success');
                setMessage(`Imported ${newGames.length} new games. (${skippedCount} skipped)`);
            } else {
                setStatus('success');
                setMessage(`No new games found. (${rawGames.length} skipped)`);
            }

        } catch (err) {
            console.error(err);
            setStatus('error');
            setMessage(err.message);
        }
    };

    useEffect(() => {
        setPage(1);
    }, [filters]);

    const getHeroResult = (game) => {
        if (!heroUser) return null;
        const isWhite = game.white?.toLowerCase() === heroUser.toLowerCase();
        const isBlack = game.black?.toLowerCase() === heroUser.toLowerCase();
        if (!isWhite && !isBlack) return null;
        if (game.result === '1/2-1/2') return 'draw';
        if (isWhite && game.result === '1-0') return 'win';
        if (isWhite && game.result === '0-1') return 'loss';
        if (isBlack && game.result === '0-1') return 'win';
        if (isBlack && game.result === '1-0') return 'loss';
        return null;
    };

    const games = useLiveQuery(async () => {
        const all = await db.games.toArray();
        const filtered = all.filter((game) => {
            if (filters.result !== 'all') {
                const heroResult = getHeroResult(game);
                if (!heroResult || heroResult !== filters.result) return false;
            }
            if (filters.analyzed !== 'all') {
                const analyzed = game.analysisStatus === 'completed' || !!game.analyzed;
                if (filters.analyzed === 'yes' && !analyzed) return false;
                if (filters.analyzed === 'no' && analyzed) return false;
            }
            if (filters.perf !== 'all' && (game.perf || '').toLowerCase() !== filters.perf) return false;
            if (filters.opening) {
                const target = `${game.openingName || ''} ${game.eco || ''}`.toLowerCase();
                if (!target.includes(filters.opening.toLowerCase())) return false;
            }

            if (filters.player) {
                const playerTarget = `${game.white || ''} ${game.black || ''}`.toLowerCase();
                if (!playerTarget.includes(filters.player.toLowerCase())) return false;
            }

            if (filters.color !== 'all' && heroUser) {
                const isWhite = game.white?.toLowerCase() === heroUser.toLowerCase();
                const isBlack = game.black?.toLowerCase() === heroUser.toLowerCase();
                if (filters.color === 'white' && !isWhite) return false;
                if (filters.color === 'black' && !isBlack) return false;
            }

            const gameDate = new Date(game.date || game.timestamp || 0);
            if (filters.dateFrom) {
                const from = new Date(filters.dateFrom);
                if (gameDate < from) return false;
            }
            if (filters.dateTo) {
                const to = new Date(filters.dateTo);
                to.setHours(23, 59, 59, 999);
                if (gameDate > to) return false;
            }

            return true;
        });

        return filtered.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
    }, [filters, heroUser]);

    const totalPages = games ? Math.max(1, Math.ceil(games.length / pageSize)) : 1;
    const pageGames = games ? games.slice((page - 1) * pageSize, page * pageSize) : [];

    const handleView = (gameId) => {
        localStorage.setItem('activeGameId', String(gameId));
        window.dispatchEvent(new Event('activeGameChanged'));
        navigate('/');
    };

    return (
        <div className="import-page bg-app">
            <div className="import-layout">
                <div className="import-main">
                    <div className="import-header">
                        <div>
                            <h2 className="text-2xl font-semibold mb-2 text-primary">Games Library</h2>
                            <p className="text-secondary">Filter, review, and jump into any imported game.</p>
                        </div>
                        <div className="text-xs text-muted">{games ? games.length : 0} games</div>
                    </div>

                    <div className="filter-bar">
                        <div className="filter-row">
                            <div className="filter-field">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Result</label>
                                <select
                                    className="input"
                                    value={filters.result}
                                    onChange={(e) => setFilters({ ...filters, result: e.target.value })}
                                >
                                    <option value="all">All</option>
                                    <option value="win">Win</option>
                                    <option value="loss">Loss</option>
                                    <option value="draw">Draw</option>
                                </select>
                            </div>
                            <div className="filter-field">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Color</label>
                                <select
                                    className="input"
                                    value={filters.color}
                                    onChange={(e) => setFilters({ ...filters, color: e.target.value })}
                                >
                                    <option value="all">All</option>
                                    <option value="white">White</option>
                                    <option value="black">Black</option>
                                </select>
                            </div>
                            <div className="filter-field">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Time Control</label>
                                <select
                                    className="input"
                                    value={filters.perf}
                                    onChange={(e) => setFilters({ ...filters, perf: e.target.value })}
                                >
                                    <option value="all">All</option>
                                    <option value="bullet">Bullet</option>
                                    <option value="blitz">Blitz</option>
                                    <option value="rapid">Rapid</option>
                                    <option value="classical">Classical</option>
                                </select>
                            </div>
                            <div className="filter-field">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Analyzed</label>
                                <select
                                    className="input"
                                    value={filters.analyzed}
                                    onChange={(e) => setFilters({ ...filters, analyzed: e.target.value })}
                                >
                                    <option value="all">All</option>
                                    <option value="yes">Analyzed</option>
                                    <option value="no">Not analyzed</option>
                                </select>
                            </div>
                        </div>

                        <div className="filter-row">
                            <div className="filter-field">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Opening</label>
                                <input
                                    className="input"
                                    value={filters.opening}
                                    onChange={(e) => setFilters({ ...filters, opening: e.target.value })}
                                    placeholder="Search ECO or name"
                                />
                            </div>
                            <div className="filter-field">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Player</label>
                                <input
                                    className="input"
                                    value={filters.player}
                                    onChange={(e) => setFilters({ ...filters, player: e.target.value })}
                                    placeholder="Search username"
                                />
                            </div>
                            <div className="filter-field filter-date">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Date Range</label>
                                <div className="date-range">
                                    <input
                                        type="date"
                                        className="input"
                                        value={filters.dateFrom}
                                        onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                                    />
                                    <input
                                        type="date"
                                        className="input"
                                        value={filters.dateTo}
                                        onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>
                    </div>

                    <div className="games-grid">
                        {pageGames.map((game) => {
                            const dateLabel = game.date ? new Date(game.date).toLocaleDateString() : 'Unknown';
                            const opening = game.openingName || game.eco || 'Unknown Opening';
                            const heroResult = getHeroResult(game) || 'result';
                            const whiteName = typeof game.white === 'string' ? game.white : game.white?.name || 'White';
                            const blackName = typeof game.black === 'string' ? game.black : game.black?.name || 'Black';
                            const status = game.analysisStatus || (game.analyzed ? 'completed' : 'idle');
                            const statusLabel = status === 'completed'
                                ? 'Analyzed'
                                : status === 'pending'
                                    ? 'Queued'
                                    : status === 'analyzing'
                                        ? 'Analyzing'
                                        : status === 'failed'
                                            ? 'Failed'
                                            : status === 'ignored'
                                                ? 'Ignored'
                                                : 'Idle';
                            const statusClass = status === 'completed'
                                ? 'status-success'
                                : status === 'failed'
                                    ? 'status-error'
                                    : status === 'ignored'
                                        ? 'status-muted'
                                        : 'status-warning';
                            return (
                                <div key={game.id} className="game-card">
                                    <div className="game-card-header">
                                        <div className="game-title">
                                            <span className="text-primary font-semibold">{whiteName} vs {blackName}</span>
                                            <span className="text-muted">{dateLabel}</span>
                                        </div>
                                        <span className={`status-pill ${statusClass}`}>
                                            {statusLabel}
                                        </span>
                                    </div>
                                    <div className="game-meta">
                                        <span className="pill">{game.perf || 'Standard'}</span>
                                        <span className="pill">{opening}</span>
                                        <span className={`pill ${heroResult === 'win' ? 'pill-win' : heroResult === 'loss' ? 'pill-loss' : heroResult === 'draw' ? 'pill-draw' : ''}`}>
                                            {heroResult.toUpperCase()}
                                        </span>
                                    </div>
                                    <div className="game-actions">
                                        <button
                                            className="btn btn-secondary"
                                            onClick={() => handleView(game.id)}
                                        >
                                            View in Dashboard
                                        </button>
                                    </div>
                                </div>
                            );
                        })}

                        {games && games.length === 0 && (
                            <div className="p-6 rounded-lg border bg-panel text-center text-muted">
                                No games match these filters.
                            </div>
                        )}
                    </div>

                    <div className="pagination">
                        <button
                            className="btn btn-secondary"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                        >
                            Previous
                        </button>
                        <div className="text-xs text-muted">
                            Page {page} of {totalPages}
                        </div>
                        <button
                            className="btn btn-secondary"
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                        >
                            Next
                        </button>
                    </div>
                </div>

                <aside className="import-aside">
                    <div className="import-card">
                        <div className="text-center mb-6">
                            <h2 className="text-xl font-semibold mb-2 text-primary">Sync Games</h2>
                            <p className="text-secondary text-sm">Fetch your latest Lichess activity.</p>
                        </div>

                        <form onSubmit={handleImport} className="flex flex-col gap-6 w-full">
                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Lichess Username</label>
                                <input
                                    type="text"
                                    value={username}
                                    onChange={(e) => setUsername(e.target.value)}
                                    placeholder="e.g. MagnusCarlsen"
                                    className="input w-full bg-subtle"
                                    required
                                />
                            </div>

                            <div className="flex flex-col gap-2">
                                <label className="text-xs font-semibold text-muted uppercase tracking-wider">Game Limit</label>
                                <div className="grid gap-2" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)' }}>
                                    {[20, 50, 100, 200].map(val => (
                                        <button
                                            key={val}
                                            type="button"
                                            onClick={() => setMaxGames(val)}
                                            className={`py-2 px-3 rounded text-sm font-medium transition-all border ${maxGames === val
                                                ? 'bg-primary text-black border-transparent'
                                                : 'bg-transparent border text-secondary hover:border-focus'
                                                }`}
                                            style={{
                                                backgroundColor: maxGames === val ? 'var(--accent-primary)' : 'transparent',
                                                color: maxGames === val ? 'var(--accent-text-on-primary)' : 'var(--text-secondary)'
                                            }}
                                        >
                                            {val}
                                        </button>
                                    ))}
                                </div>
                            </div>

                            <button
                                type="submit"
                                disabled={status === 'loading'}
                                className="btn btn-primary w-full py-3 mt-2"
                            >
                                {status === 'loading' ? (
                                    <span className="flex items-center gap-2">
                                        <Loader2 size={16} className="animate-spin" /> Syncing...
                                    </span>
                                ) : (
                                    <span className="flex items-center gap-2">
                                        <Download size={16} /> Update Library
                                    </span>
                                )}
                            </button>
                        </form>

                        <div className="mt-6 min-h-[60px] flex justify-center">
                            {status === 'success' && (
                                <div className="flex items-center gap-3 text-emerald-400 justify-center">
                                    <CheckCircle size={18} />
                                    <span className="font-medium text-sm">{message}</span>
                                </div>
                            )}

                            {status === 'error' && (
                                <div className="flex items-center gap-3 text-red-400 justify-center">
                                    <AlertCircle size={18} />
                                    <span className="font-medium text-sm">{message}</span>
                                </div>
                            )}
                        </div>
                    </div>
                </aside>
            </div>
        </div>
    );
};
