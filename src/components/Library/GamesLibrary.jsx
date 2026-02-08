import React, { useMemo, useState, useEffect } from 'react';
import { db } from '../../services/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Filter, Search, RotateCcw } from 'lucide-react';

export const GamesLibrary = () => {
    const navigate = useNavigate();
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
    const pageSize = 24;

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
        <div className="w-full h-full overflow-y-auto bg-black relative">

            {/* Background Atmosphere */}
            <div className="fixed inset-0 pointer-events-none z-0">
                <div className="absolute top-[-20%] left-[20%] w-[600px] h-[600px] bg-blue-900/10 rounded-full blur-[120px]" />
                <div className="absolute bottom-[-10%] right-[10%] w-[500px] h-[500px] bg-purple-900/10 rounded-full blur-[120px]" />
            </div>

            <div className="relative z-10 max-w-7xl mx-auto px-6 py-10">

                {/* Header Section */}
                <div className="flex flex-col md:flex-row md:items-end justify-between gap-6 mb-12">
                    <div>
                        <h1 className="text-5xl font-extrabold text-transparent bg-clip-text bg-gradient-to-br from-white via-white/90 to-white/50 tracking-tight mb-3">
                            Library
                        </h1>
                        <p className="text-lg text-neutral-400 font-light max-w-2xl">
                            Your personal chess archive. Analyze, review, and track your progress across <span className="text-white font-medium">{games ? games.length : 0}</span> games.
                        </p>
                    </div>

                    <div className="flex items-center gap-4">
                        <button
                            onClick={() => navigate('/import')}
                            className="group relative px-6 py-3 bg-white text-black font-semibold rounded-xl overflow-hidden transition-all hover:scale-105 shadow-[0_0_20px_rgba(255,255,255,0.1)]"
                        >
                            <span className="relative z-10 flex items-center gap-2">
                                <span className="text-lg">+</span> Import Games
                            </span>
                            <div className="absolute inset-0 bg-gradient-to-r from-blue-100 to-white opacity-0 group-hover:opacity-100 transition-opacity" />
                        </button>
                    </div>
                </div>

                {/* Filters Section */}
                <div className="bg-neutral-900/40 backdrop-blur-xl border border-white/5 rounded-3xl p-6 mb-16 shadow-2xl">
                    <div className="flex items-center justify-between mb-6">
                        <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                            <Filter size={20} className="text-blue-400" />
                            Filter Games
                        </h2>
                        <button
                            onClick={() => setFilters({
                                result: 'all', color: 'all', opening: '', analyzed: 'all', perf: 'all', dateFrom: '', dateTo: '', player: ''
                            })}
                            className="text-sm text-neutral-400 hover:text-white transition-colors flex items-center gap-2 px-3 py-1 rounded-lg hover:bg-white/5"
                        >
                            <RotateCcw size={14} /> Clear All
                        </button>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-4">
                        {/* Search Inputs */}
                        <div className="relative group col-span-1 md:col-span-2">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 group-focus-within:text-blue-400 transition-colors" size={20} />
                            <input
                                className="w-full h-12 bg-neutral-950/50 border border-white/10 rounded-xl pl-12 pr-4 text-base text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
                                value={filters.player}
                                onChange={(e) => setFilters({ ...filters, player: e.target.value })}
                                placeholder="Search by opponent name..."
                            />
                        </div>

                        <div className="relative group col-span-1 md:col-span-2">
                            <Search className="absolute left-4 top-1/2 -translate-y-1/2 text-neutral-500 group-focus-within:text-blue-400 transition-colors" size={20} />
                            <input
                                className="w-full h-12 bg-neutral-950/50 border border-white/10 rounded-xl pl-12 pr-4 text-base text-white placeholder:text-neutral-600 focus:outline-none focus:border-blue-500/50 focus:ring-1 focus:ring-blue-500/50 transition-all"
                                value={filters.opening}
                                onChange={(e) => setFilters({ ...filters, opening: e.target.value })}
                                placeholder="Search by opening (e.g. Sicilian)..."
                            />
                        </div>
                    </div>

                    <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-5 gap-4">
                        {[
                            { value: filters.result, key: 'result', label: 'Result', options: [{ v: 'all', l: 'All Results' }, { v: 'win', l: 'Won' }, { v: 'loss', l: 'Lost' }, { v: 'draw', l: 'Draw' }] },
                            { value: filters.color, key: 'color', label: 'Color', options: [{ v: 'all', l: 'Any Color' }, { v: 'white', l: 'White' }, { v: 'black', l: 'Black' }] },
                            { value: filters.perf, key: 'perf', label: 'Speed', options: [{ v: 'all', l: 'Any Speed' }, { v: 'bullet', l: 'Bullet' }, { v: 'blitz', l: 'Blitz' }, { v: 'rapid', l: 'Rapid' }, { v: 'classical', l: 'Classical' }] },
                            { value: filters.analyzed, key: 'analyzed', label: 'Analysis', options: [{ v: 'all', l: 'All Status' }, { v: 'yes', l: 'Analyzed' }, { v: 'no', l: 'Pending' }] }
                        ].map((f) => (
                            <div key={f.key} className="relative">
                                <select
                                    className={`w-full h-12 appearance-none bg-neutral-950/50 border border-white/10 rounded-xl px-4 pr-10 text-sm focus:outline-none focus:border-blue-500/50 transition-colors cursor-pointer ${f.value !== 'all' ? 'text-blue-400 font-medium bg-blue-500/5 border-blue-500/20' : 'text-neutral-300'}`}
                                    value={f.value}
                                    onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}
                                >
                                    {f.options.map(o => (
                                        <option key={o.v} value={o.v}>{o.l}</option>
                                    ))}
                                </select>
                                <div className="absolute right-4 top-1/2 -translate-y-1/2 pointer-events-none text-neutral-500">
                                    <svg width="10" height="6" viewBox="0 0 10 6" fill="none" xmlns="http://www.w3.org/2000/svg">
                                        <path d="M1 1L5 5L9 1" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
                                    </svg>
                                </div>
                            </div>
                        ))}

                        <div className="col-span-2 md:col-span-1">
                            <input
                                type="date"
                                className="w-full h-12 bg-neutral-950/50 border border-white/10 rounded-xl px-4 text-sm text-neutral-300 focus:outline-none focus:border-blue-500/50 transition-colors"
                                value={filters.dateFrom}
                                onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                            />
                        </div>
                    </div>
                </div>

                {/* Grid Divider */}
                <div className="flex items-center gap-4 mb-8">
                    <div className="h-px bg-white/10 flex-1" />
                    <span className="text-neutral-500 text-sm font-medium uppercase tracking-widest">
                        {pageGames.length} of {games?.length} Games
                    </span>
                    <div className="h-px bg-white/10 flex-1" />
                </div>

                {/* Games Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8 mb-16">
                    {pageGames.map((game) => {
                        const dateLabel = game.date ? new Date(game.date).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' }) : 'Unknown Date';
                        const opening = game.openingName || game.eco || 'Unknown Opening';
                        const heroResult = getHeroResult(game) || 'result';
                        const whiteName = typeof game.white === 'string' ? game.white : game.white?.name || 'White';
                        const blackName = typeof game.black === 'string' ? game.black : game.black?.name || 'Black';
                        const status = game.analysisStatus || (game.analyzed ? 'completed' : 'idle');
                        const isWin = heroResult === 'win';
                        const isLoss = heroResult === 'loss';

                        return (
                            <div key={game.id}
                                onClick={() => handleView(game.id)}
                                className="group relative bg-[#0f0f0f] hover:bg-[#141414] border border-white/5 rounded-3xl overflow-hidden transition-all duration-300 hover:scale-[1.01] hover:shadow-[0_20px_40px_-5px_rgba(0,0,0,0.5)] cursor-pointer flex flex-col"
                            >
                                {/* Top colored accent */}
                                <div className={`h-1.5 w-full ${isWin ? 'bg-emerald-500' : isLoss ? 'bg-rose-500' : 'bg-neutral-600'}`} />

                                <div className="p-6 flex-1 flex flex-col">
                                    {/* Header */}
                                    <div className="flex justify-between items-start mb-6">
                                        <div>
                                            <div className="text-xs font-bold text-neutral-500 uppercase tracking-wider mb-1">
                                                {game.perf || 'Rapid'} • {dateLabel}
                                            </div>
                                            <div className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-bold border ${isWin ? 'bg-emerald-500/10 text-emerald-500 border-emerald-500/20' :
                                                    isLoss ? 'bg-rose-500/10 text-rose-500 border-rose-500/20' :
                                                        'bg-neutral-700/30 text-neutral-400 border-neutral-700/50'
                                                }`}>
                                                {heroResult === 'win' ? 'VICTORY' : heroResult === 'loss' ? 'DEFEAT' : 'DRAW'}
                                            </div>
                                        </div>
                                        <div className={`w-3 h-3 rounded-full outline outline-4 outline-[#0f0f0f] ${status === 'completed' ? 'bg-emerald-500' : 'bg-neutral-600'
                                            }`} title={`Analysis: ${status}`} />
                                    </div>

                                    {/* Players */}
                                    <div className="space-y-4 mb-8">
                                        <div className="flex items-center justify-between group/player">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${game.white === heroUser ? 'bg-white text-black' : 'bg-neutral-800 text-neutral-400 border border-white/10'
                                                    }`}>
                                                    T
                                                </div>
                                                <span className={`text-base font-medium ${game.white === heroUser ? 'text-white' : 'text-neutral-400'}`}>
                                                    {whiteName}
                                                </span>
                                            </div>
                                            {game.white === heroUser && isWin && <div className="text-emerald-500">♛</div>}
                                        </div>
                                        <div className="flex items-center justify-between group/player">
                                            <div className="flex items-center gap-3">
                                                <div className={`w-8 h-8 rounded-full flex items-center justify-center font-bold text-xs ${game.black === heroUser ? 'bg-white text-black' : 'bg-black text-neutral-400 border border-white/10 shadow-sm'
                                                    }`}>
                                                    B
                                                </div>
                                                <span className={`text-base font-medium ${game.black === heroUser ? 'text-white' : 'text-neutral-400'}`}>
                                                    {blackName}
                                                </span>
                                            </div>
                                            {game.black === heroUser && isWin && <div className="text-emerald-500">♛</div>}
                                        </div>
                                    </div>

                                    {/* Footer */}
                                    <div className="mt-auto pt-5 border-t border-white/5">
                                        <p className="text-sm text-neutral-500 truncate mb-4 font-mono" title={opening}>
                                            {opening}
                                        </p>
                                        <button className="w-full h-12 bg-white/5 hover:bg-white/10 text-white font-semibold rounded-xl border border-white/5 hover:border-white/20 transition-all flex items-center justify-center gap-2 group-hover:bg-blue-600 group-hover:border-transparent group-hover:shadow-lg group-hover:shadow-blue-500/20">
                                            Review Game
                                        </button>
                                    </div>
                                </div>
                            </div>
                        );
                    })}
                </div>

                {/* Empty State */}
                {games && games.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 text-center border border-dashed border-white/10 rounded-3xl bg-white/5">
                        <div className="w-20 h-20 bg-neutral-900 rounded-full flex items-center justify-center mb-6 shadow-xl border border-white/5">
                            <Search className="w-8 h-8 text-neutral-500" />
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-2">No games found</h3>
                        <p className="text-neutral-400 max-w-md">
                            We couldn't find any games matching your filters. Try clearing them or import new games.
                        </p>
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-6 pb-20">
                        <button
                            className="w-12 h-12 flex items-center justify-center rounded-2xl bg-neutral-900 border border-white/10 text-white hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-neutral-900 transition-all"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                        >
                            ←
                        </button>
                        <div className="text-sm font-medium text-neutral-500">
                            Page <span className="text-white text-lg mx-1">{page}</span> of {totalPages}
                        </div>
                        <button
                            className="w-12 h-12 flex items-center justify-center rounded-2xl bg-neutral-900 border border-white/10 text-white hover:bg-neutral-800 disabled:opacity-30 disabled:hover:bg-neutral-900 transition-all"
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                        >
                            →
                        </button>
                    </div>
                )}
            </div>
        </div>
    );
};
