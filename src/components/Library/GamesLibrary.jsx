import React, { useMemo, useState, useEffect } from 'react';
import { db } from '../../services/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Filter, Search, RotateCcw, ChevronDown, Trophy, Clock, Brain, User, Calendar, X } from 'lucide-react';

export const GamesLibrary = () => {
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [showFilters, setShowFilters] = useState(true);
    const [activeFilterCount, setActiveFilterCount] = useState(0);
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

    // Calculate active filter count
    useEffect(() => {
        let count = 0;
        if (filters.result !== 'all') count++;
        if (filters.color !== 'all') count++;
        if (filters.opening !== '') count++;
        if (filters.analyzed !== 'all') count++;
        if (filters.perf !== 'all') count++;
        if (filters.dateFrom !== '') count++;
        if (filters.dateTo !== '') count++;
        if (filters.player !== '') count++;
        setActiveFilterCount(count);
    }, [filters]);

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

    const pageSize = 24;
    const totalPages = games ? Math.max(1, Math.ceil(games.length / pageSize)) : 1;
    const pageGames = games ? games.slice((page - 1) * pageSize, page * pageSize) : [];

    const handleView = (gameId) => {
        localStorage.setItem('activeGameId', String(gameId));
        window.dispatchEvent(new Event('activeGameChanged'));
        navigate('/');
    };

    const clearFilter = (key) => {
        const defaults = {
            result: 'all',
            color: 'all',
            opening: '',
            analyzed: 'all',
            perf: 'all',
            dateFrom: '',
            dateTo: '',
            player: ''
        };
        setFilters({ ...filters, [key]: defaults[key] });
    };

    const formatDate = (dateStr) => {
        if (!dateStr) return 'Unknown';
        const date = new Date(dateStr);
        return date.toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
    };

    const getPerfColor = (perf) => {
        const colors = {
            bullet: 'text-amber-400 bg-amber-400/10 border-amber-400/20',
            blitz: 'text-orange-400 bg-orange-400/10 border-orange-400/20',
            rapid: 'text-blue-400 bg-blue-400/10 border-blue-400/20',
            classical: 'text-purple-400 bg-purple-400/10 border-purple-400/20',
        };
        return colors[perf?.toLowerCase()] || 'text-slate-400 bg-slate-400/10 border-slate-400/20';
    };

    return (
        <div className="w-full h-full overflow-y-auto bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950 relative">

            {/* Animated Background */}
            <div className="fixed inset-0 pointer-events-none z-0 overflow-hidden">
                <div className="absolute top-[-30%] left-[-10%] w-[800px] h-[800px] bg-indigo-500/5 rounded-full blur-[150px] animate-pulse-slow" />
                <div className="absolute bottom-[-20%] right-[-5%] w-[600px] h-[600px] bg-amber-500/5 rounded-full blur-[150px] animate-pulse-slow delay-1000" />
                <div className="absolute top-[40%] left-[60%] w-[400px] h-[400px] bg-emerald-500/5 rounded-full blur-[120px] animate-pulse-slow delay-500" />
            </div>

            <div className="relative z-10 max-w-7xl mx-auto px-4 sm:px-6 py-8">

                {/* Header Section */}
                <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-6 mb-8">
                    <div className="flex-1">
                        <div className="flex items-center gap-3 mb-2">
                            <div className="p-2 bg-gradient-to-br from-amber-400/20 to-orange-500/20 rounded-xl border border-amber-400/30">
                                <Trophy className="w-5 h-5 text-amber-400" />
                            </div>
                            <h1 className="text-3xl sm:text-4xl font-bold text-white tracking-tight">
                                Games Library
                            </h1>
                        </div>
                        <p className="text-slate-400 text-sm sm:text-base max-w-2xl">
                            Your personal chess archive. Analyze, review, and track your progress across{' '}
                            <span className="text-white font-semibold">{games?.length || 0}</span> games.
                        </p>
                    </div>

                    <div className="flex items-center gap-3">
                        <button
                            onClick={() => setShowFilters(!showFilters)}
                            className={`group relative px-4 py-2.5 rounded-xl border transition-all duration-200 flex items-center gap-2 ${
                                showFilters 
                                    ? 'bg-indigo-500/20 border-indigo-500/40 text-indigo-300' 
                                    : 'bg-slate-800/50 border-slate-700/50 text-slate-300 hover:bg-slate-800 hover:border-slate-600'
                            }`}
                        >
                            <Filter size={18} />
                            <span className="hidden sm:inline font-medium">Filters</span>
                            {activeFilterCount > 0 && (
                                <span className="absolute -top-2 -right-2 w-5 h-5 bg-amber-400 text-slate-900 text-xs font-bold rounded-full flex items-center justify-center">
                                    {activeFilterCount}
                                </span>
                            )}
                        </button>
                        <button
                            onClick={() => navigate('/import')}
                            className="group relative px-5 py-2.5 bg-gradient-to-r from-amber-400 to-orange-500 text-slate-900 font-semibold rounded-xl overflow-hidden transition-all hover:scale-105 hover:shadow-lg hover:shadow-amber-500/25"
                        >
                            <span className="relative z-10 flex items-center gap-2">
                                <span className="text-lg">+</span> Import
                            </span>
                        </button>
                    </div>
                </div>

                {/* Enhanced Filters Section */}
                <div className={`transition-all duration-300 ease-in-out ${showFilters ? 'opacity-100 max-h-[500px] mb-8' : 'opacity-0 max-h-0 mb-0 overflow-hidden'}`}>
                    <div className="bg-slate-900/60 backdrop-blur-2xl border border-slate-700/50 rounded-2xl p-5 sm:p-6 shadow-2xl">
                        <div className="flex items-center justify-between mb-5">
                            <h2 className="text-white font-semibold text-lg flex items-center gap-2">
                                <div className="p-1.5 bg-indigo-500/20 rounded-lg">
                                    <Filter size={18} className="text-indigo-400" />
                                </div>
                                Filter Games
                            </h2>
                            <button
                                onClick={() => setFilters({
                                    result: 'all', color: 'all', opening: '', analyzed: 'all', perf: 'all', dateFrom: '', dateTo: '', player: ''
                                })}
                                className="text-sm text-slate-400 hover:text-white transition-colors flex items-center gap-2 px-3 py-1.5 rounded-lg hover:bg-slate-800/50"
                            >
                                <RotateCcw size={14} /> Clear All
                            </button>
                        </div>

                        {/* Search Row */}
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
                            <div className="relative group">
                                <User className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={20} />
                                <div className="relative">
                                    <input
                                        className="w-full h-12 bg-slate-950/50 border border-slate-700/50 rounded-xl pl-12 pr-10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                        value={filters.player}
                                        onChange={(e) => setFilters({ ...filters, player: e.target.value })}
                                        placeholder="Search opponent..."
                                    />
                                    {filters.player && (
                                        <button 
                                            onClick={() => clearFilter('player')}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                        >
                                            <X size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>

                            <div className="relative group">
                                <Brain className="absolute left-4 top-1/2 -translate-y-1/2 text-slate-500 group-focus-within:text-indigo-400 transition-colors" size={20} />
                                <div className="relative">
                                    <input
                                        className="w-full h-12 bg-slate-950/50 border border-slate-700/50 rounded-xl pl-12 pr-10 text-sm text-white placeholder:text-slate-600 focus:outline-none focus:border-indigo-500/50 focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                        value={filters.opening}
                                        onChange={(e) => setFilters({ ...filters, opening: e.target.value })}
                                        placeholder="Search opening or ECO..."
                                    />
                                    {filters.opening && (
                                        <button 
                                            onClick={() => clearFilter('opening')}
                                            className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                        >
                                            <X size={16} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>

                        {/* Filter Dropdowns */}
                        <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-5 gap-3">
                            {[
                                { value: filters.result, key: 'result', label: 'Result', icon: Trophy, options: [
                                    { v: 'all', l: 'All Results' }, { v: 'win', l: 'Won' }, { v: 'loss', l: 'Lost' }, { v: 'draw', l: 'Draw' }
                                ]},
                                { value: filters.color, key: 'color', label: 'Color', icon: User, options: [
                                    { v: 'all', l: 'Any Color' }, { v: 'white', l: 'White' }, { v: 'black', l: 'Black' }
                                ]},
                                { value: filters.perf, key: 'perf', label: 'Speed', icon: Clock, options: [
                                    { v: 'all', l: 'Any Speed' }, { v: 'bullet', l: 'Bullet' }, { v: 'blitz', l: 'Blitz' }, { v: 'rapid', l: 'Rapid' }, { v: 'classical', l: 'Classical' }
                                ]},
                                { value: filters.analyzed, key: 'analyzed', label: 'Analysis', icon: Brain, options: [
                                    { v: 'all', l: 'All Status' }, { v: 'yes', l: 'Analyzed' }, { v: 'no', l: 'Pending' }
                                ]}
                            ].map((f) => (
                                <div key={f.key} className="relative">
                                    <div className="flex items-center gap-1.5 mb-1.5">
                                        <f.icon size={14} className="text-slate-500" />
                                        <label className="text-xs text-slate-400 font-medium">{f.label}</label>
                                    </div>
                                    <div className="relative">
                                        <select
                                            className={`w-full h-11 appearance-none bg-slate-950/50 border rounded-lg px-3 pr-9 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all cursor-pointer ${
                                                f.value !== 'all' 
                                                    ? 'border-indigo-500/50 text-white bg-indigo-500/10' 
                                                    : 'border-slate-700/50 text-slate-300'
                                            }`}
                                            value={f.value}
                                            onChange={(e) => setFilters({ ...filters, [f.key]: e.target.value })}
                                        >
                                            {f.options.map(o => (
                                                <option key={o.v} value={o.v}>{o.l}</option>
                                            ))}
                                        </select>
                                        <ChevronDown size={16} className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 pointer-events-none" />
                                    </div>
                                </div>
                            ))}

                            {/* Date Range */}
                            <div className="col-span-2 sm:col-span-1">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <Calendar size={14} className="text-slate-500" />
                                    <label className="text-xs text-slate-400 font-medium">From</label>
                                </div>
                                <div className="relative">
                                    <input
                                        type="date"
                                        className="w-full h-11 bg-slate-950/50 border border-slate-700/50 rounded-lg px-3 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                        value={filters.dateFrom}
                                        onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                                    />
                                    {filters.dateFrom && (
                                        <button 
                                            onClick={() => clearFilter('dateFrom')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                            
                            <div className="col-span-2 sm:col-span-1">
                                <div className="flex items-center gap-1.5 mb-1.5">
                                    <Calendar size={14} className="text-slate-500" />
                                    <label className="text-xs text-slate-400 font-medium">To</label>
                                </div>
                                <div className="relative">
                                    <input
                                        type="date"
                                        className="w-full h-11 bg-slate-950/50 border border-slate-700/50 rounded-lg px-3 text-sm text-slate-300 focus:outline-none focus:ring-2 focus:ring-indigo-500/20 transition-all"
                                        value={filters.dateTo}
                                        onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                                    />
                                    {filters.dateTo && (
                                        <button 
                                            onClick={() => clearFilter('dateTo')}
                                            className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-500 hover:text-slate-300 transition-colors"
                                        >
                                            <X size={14} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Results Summary */}
                {games && games.length > 0 && (
                    <div className="flex items-center gap-3 mb-6">
                        <div className="h-px bg-slate-700/50 flex-1" />
                        <div className="flex items-center gap-2 px-4 py-1.5 bg-slate-900/50 rounded-full border border-slate-700/30">
                            <span className="text-slate-400 text-sm">Showing</span>
                            <span className="text-white font-semibold">{pageGames.length}</span>
                            <span className="text-slate-400 text-sm">of</span>
                            <span className="text-white font-semibold">{games.length}</span>
                            <span className="text-slate-400 text-sm">games</span>
                        </div>
                        <div className="h-px bg-slate-700/50 flex-1" />
                    </div>
                )}

                {/* Games Grid - Enhanced Cards */}
                {games && games.length > 0 && (
                    <div className="grid games-grid mb-10">
                        {pageGames.map((game) => {
                            const heroResult = getHeroResult(game) || 'result';
                            const isWin = heroResult === 'win';
                            const isLoss = heroResult === 'loss';
                            const isDraw = heroResult === 'draw';
                            const opening = game.openingName || game.eco || 'Unknown Opening';
                            const status = game.analysisStatus || (game.analyzed ? 'completed' : 'idle');
                            const perfColor = getPerfColor(game.perf);
                            const whiteName = typeof game.white === 'string' ? game.white : game.white?.name || 'White';
                            const blackName = typeof game.black === 'string' ? game.black : game.black?.name || 'Black';
                            
                            // Get player initials
                            const getInitials = (name) => {
                                if (!name) return '?';
                                return name.split(' ').map(n => n[0]).join('').toUpperCase().slice(0, 2);
                            };

                            return (
                                <div key={game.id}
                                    onClick={() => handleView(game.id)}
                                    className="group relative bg-gradient-to-br from-slate-800/80 to-slate-900/80 hover:from-slate-800/60 hover:to-slate-900/60 border border-slate-700/40 hover:border-slate-600/50 rounded-2xl overflow-hidden transition-all duration-300 hover:scale-[1.02] hover:shadow-xl hover:shadow-black/20 cursor-pointer"
                                >
                                    {/* Result Accent Bar */}
                                    <div className={`absolute left-0 top-0 bottom-0 w-1.5 ${
                                        isWin ? 'bg-emerald-500' : isLoss ? 'bg-rose-500' : 'bg-slate-500'
                                    }`} />
                                    
                                    {/* Analysis Status Indicator */}
                                    <div className={`absolute top-3 right-3 w-2.5 h-2.5 rounded-full border-2 border-slate-900 ${
                                        status === 'completed' ? 'bg-emerald-400' : 'bg-amber-400'
                                    }`} title={`Analysis: ${status}`} />

                                    <div className="p-5 pl-7">
                                        {/* Header Row */}
                                        <div className="flex items-center justify-between mb-4">
                                            <div className="flex items-center gap-2">
                                                <span className={`px-2.5 py-1 rounded-lg text-xs font-bold uppercase tracking-wider border ${perfColor}`}>
                                                    {game.perf || 'Rapid'}
                                                </span>
                                                <span className="text-slate-500 text-xs">•</span>
                                                <span className="text-slate-400 text-xs flex items-center gap-1">
                                                    <Calendar size={12} />
                                                    {formatDate(game.date)}
                                                </span>
                                            </div>
                                            <div className={`px-3 py-1 rounded-lg text-xs font-bold uppercase tracking-wide ${
                                                isWin ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/30' :
                                                isLoss ? 'bg-rose-500/15 text-rose-400 border border-rose-500/30' :
                                                    'bg-slate-600/30 text-slate-400 border border-slate-600/50'
                                            }`}>
                                                {isWin ? 'WIN' : isLoss ? 'LOSS' : 'DRAW'}
                                            </div>
                                        </div>

                                        {/* Players Section */}
                                        <div className="space-y-3 mb-4">
                                            {/* White Player */}
                                            <div className="flex items-center justify-between group/player">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${
                                                        game.white === heroUser 
                                                            ? 'bg-gradient-to-br from-white to-slate-200 text-slate-900' 
                                                            : 'bg-slate-700/50 text-slate-300 border border-slate-600/30'
                                                    }`}>
                                                        {getInitials(whiteName)}
                                                    </div>
                                                    <div>
                                                        <span className={`text-sm font-medium block ${game.white === heroUser ? 'text-white' : 'text-slate-300'}`}>
                                                            {whiteName}
                                                        </span>
                                                        <span className="text-xs text-slate-500">White</span>
                                                    </div>
                                                </div>
                                                <span className={`text-lg font-bold font-mono ${game.result === '1-0' ? 'text-emerald-400' : game.result === '0-1' ? 'text-rose-400' : 'text-slate-500'}`}>
                                                    {game.result || '-'}
                                                </span>
                                            </div>

                                            {/* Black Player */}
                                            <div className="flex items-center justify-between group/player">
                                                <div className="flex items-center gap-3">
                                                    <div className={`w-10 h-10 rounded-xl flex items-center justify-center font-bold text-sm ${
                                                        game.black === heroUser 
                                                            ? 'bg-gradient-to-br from-amber-400 to-amber-600 text-white' 
                                                            : 'bg-slate-700/50 text-slate-300 border border-slate-600/30'
                                                    }`}>
                                                        {getInitials(blackName)}
                                                    </div>
                                                    <div>
                                                        <span className={`text-sm font-medium block ${game.black === heroUser ? 'text-white' : 'text-slate-300'}`}>
                                                            {blackName}
                                                        </span>
                                                        <span className="text-xs text-slate-500">Black</span>
                                                    </div>
                                                </div>
                                                <span className={`text-lg font-bold font-mono ${game.result === '0-1' ? 'text-emerald-400' : game.result === '1-0' ? 'text-rose-400' : 'text-slate-500'}`}>
                                                    {game.result || '-'}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Opening Info */}
                                        <div className="pt-3 border-t border-slate-700/30">
                                            <div className="flex items-center gap-2 mb-2">
                                                <Brain size={14} className="text-slate-500" />
                                                <span className="text-xs text-slate-500 uppercase tracking-wider">Opening</span>
                                            </div>
                                            <p className="text-sm text-slate-300 truncate font-mono bg-slate-800/50 rounded-lg px-3 py-2" title={opening}>
                                                {opening}
                                            </p>
                                        </div>

                                        {/* Action Button */}
                                        <button className="w-full mt-4 h-10 bg-gradient-to-r from-indigo-500/20 to-purple-500/20 hover:from-indigo-500/30 hover:to-purple-500/30 text-white text-sm font-medium rounded-xl border border-indigo-500/30 hover:border-indigo-400/50 transition-all flex items-center justify-center gap-2 group-hover:gap-3">
                                            Review Game
                                            <svg className="w-4 h-4 transition-transform group-hover:translate-x-1" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                            </svg>
                                        </button>
                                    </div>
                                </div>
                            );
                        })}
                    </div>
                )}

                {/* Enhanced Empty State */}
                {games && games.length === 0 && (
                    <div className="flex flex-col items-center justify-center py-20 sm:py-32 text-center px-4">
                        <div className="relative mb-8">
                            <div className="w-24 h-24 bg-slate-800/50 rounded-2xl flex items-center justify-center border border-slate-700/50 shadow-2xl">
                                <Search className="w-10 h-10 text-slate-500" />
                            </div>
                            <div className="absolute -bottom-2 -right-2 w-8 h-8 bg-amber-500/20 rounded-xl flex items-center justify-center border border-amber-500/30">
                                <Trophy className="w-4 h-4 text-amber-400" />
                            </div>
                        </div>
                        <h3 className="text-2xl font-bold text-white mb-3">No games found</h3>
                        <p className="text-slate-400 max-w-md mb-8">
                            We couldn't find any games matching your filters. Try adjusting them or import new games to get started.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4">
                            <button
                                onClick={() => setFilters({
                                    result: 'all', color: 'all', opening: '', analyzed: 'all', perf: 'all', dateFrom: '', dateTo: '', player: ''
                                })}
                                className="px-6 py-3 bg-slate-800/50 text-white rounded-xl border border-slate-700/50 hover:bg-slate-800 hover:border-slate-600 transition-all flex items-center gap-2"
                            >
                                <RotateCcw size={18} /> Clear Filters
                            </button>
                            <button
                                onClick={() => navigate('/import')}
                                className="px-6 py-3 bg-gradient-to-r from-amber-400 to-orange-500 text-slate-900 font-semibold rounded-xl hover:scale-105 transition-transform flex items-center gap-2"
                            >
                                <span>+</span> Import Games
                            </button>
                        </div>
                    </div>
                )}

                {/* Enhanced Pagination */}
                {totalPages > 1 && (
                    <div className="flex justify-center items-center gap-4 pb-10">
                        <button
                            className="w-12 h-12 flex items-center justify-center rounded-xl bg-slate-800/50 border border-slate-700/50 text-white hover:bg-slate-700/50 hover:border-slate-600 disabled:opacity-30 disabled:hover:bg-slate-800/50 disabled:hover:border-slate-700/50 transition-all"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        
                        <div className="flex items-center gap-2 px-4 py-2 bg-slate-900/50 rounded-xl border border-slate-700/30">
                            <span className="text-sm text-slate-400">Page</span>
                            <span className="text-white font-bold text-lg px-2">{page}</span>
                            <span className="text-slate-500">/</span>
                            <span className="text-slate-400">{totalPages}</span>
                        </div>

                        <button
                            className="w-12 h-12 flex items-center justify-center rounded-xl bg-slate-800/50 border border-slate-700/50 text-white hover:bg-slate-700/50 hover:border-slate-600 disabled:opacity-30 disabled:hover:bg-slate-800/50 disabled:hover:border-slate-700/50 transition-all"
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                        >
                            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* Loading State */}
                {games === undefined && (
                    <div className="flex items-center justify-center py-32">
                        <div className="flex flex-col items-center gap-4">
                            <div className="w-12 h-12 border-4 border-slate-700 border-t-amber-400 rounded-full animate-spin" />
                            <span className="text-slate-400 text-sm">Loading your games...</span>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
};

