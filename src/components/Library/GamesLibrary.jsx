import React, { useMemo, useState, useEffect } from 'react';
import { db } from '../../services/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Filter, Search, RotateCcw, ChevronDown, Trophy, Brain, Calendar, X } from 'lucide-react';

export const GamesLibrary = () => {
    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [activeFilterCount, setActiveFilterCount] = useState(0);
    const [sortOrder, setSortOrder] = useState('desc');
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
    const heroLower = heroUser.toLowerCase();

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
    }, [filters, sortOrder]);

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

        const sorted = filtered.sort((a, b) => new Date(b.date || 0) - new Date(a.date || 0));
        if (sortOrder === 'asc') sorted.reverse();
        return sorted;
    }, [filters, heroUser, sortOrder]);

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
        const key = (perf || '').toLowerCase();
        if (!key) return 'perf-tag';
        return `perf-tag perf-${key}`;
    };

    return (
        <div className="library-page">
            <div className="library-bg" />

            <div className="library-shell">
                <header className="library-header">
                    <div className="library-title">
                        <div className="library-title__badge">
                            <Trophy className="w-4 h-4" />
                            <span>Games</span>
                        </div>
                        <h1 className="library-title__main">Games Library</h1>
                        <p className="library-title__sub">
                            A clean archive of your chess history, built for fast review.
                        </p>
                    </div>

                    <div className="library-actions">
                        <button
                            onClick={() => setFiltersOpen(true)}
                            className="btn-chip"
                        >
                            <Filter size={16} />
                            Filters
                            {activeFilterCount > 0 && (
                                <span className="chip-count">{activeFilterCount}</span>
                            )}
                        </button>
                        <button
                            onClick={() => navigate('/import')}
                            className="btn-primary"
                        >
                            <span>+</span>
                            Import Games
                        </button>
                    </div>
                </header>

                <section className="library-search">
                    <div className="search-field">
                        <Search size={18} />
                        <input
                            value={filters.player}
                            onChange={(e) => setFilters({ ...filters, player: e.target.value })}
                            placeholder="Search opponents or players..."
                        />
                        {filters.player && (
                            <button onClick={() => clearFilter('player')} aria-label="Clear search">
                                <X size={16} />
                            </button>
                        )}
                    </div>

                    <div className="quick-filters">
                        <div className="filter-group">
                            {[
                                { v: 'all', l: 'All' },
                                { v: 'win', l: 'Wins' },
                                { v: 'loss', l: 'Losses' },
                                { v: 'draw', l: 'Draws' }
                            ].map((o) => (
                                <button
                                    key={o.v}
                                    className={`pill ${filters.result === o.v ? 'pill--active' : ''}`}
                                    onClick={() => setFilters({ ...filters, result: o.v })}
                                >
                                    {o.l}
                                </button>
                            ))}
                        </div>

                        <div className="filter-group">
                            {[
                                { v: 'all', l: 'Any Color' },
                                { v: 'white', l: 'White' },
                                { v: 'black', l: 'Black' }
                            ].map((o) => (
                                <button
                                    key={o.v}
                                    className={`pill ${filters.color === o.v ? 'pill--active' : ''}`}
                                    onClick={() => setFilters({ ...filters, color: o.v })}
                                >
                                    {o.l}
                                </button>
                            ))}
                        </div>

                        <div className="filter-group">
                            {[
                                { v: 'all', l: 'Any Speed' },
                                { v: 'bullet', l: 'Bullet' },
                                { v: 'blitz', l: 'Blitz' },
                                { v: 'rapid', l: 'Rapid' },
                                { v: 'classical', l: 'Classical' }
                            ].map((o) => (
                                <button
                                    key={o.v}
                                    className={`pill ${filters.perf === o.v ? 'pill--active' : ''}`}
                                    onClick={() => setFilters({ ...filters, perf: o.v })}
                                >
                                    {o.l}
                                </button>
                            ))}
                        </div>

                        <div className="filter-group">
                            {[
                                { v: 'all', l: 'All Status' },
                                { v: 'yes', l: 'Analyzed' },
                                { v: 'no', l: 'Pending' }
                            ].map((o) => (
                                <button
                                    key={o.v}
                                    className={`pill ${filters.analyzed === o.v ? 'pill--active' : ''}`}
                                    onClick={() => setFilters({ ...filters, analyzed: o.v })}
                                >
                                    {o.l}
                                </button>
                            ))}
                        </div>
                    </div>
                </section>

                <div className="library-meta">
                    <div className="meta-left">
                        {games ? (
                            <>
                                <span className="meta-count">{pageGames.length}</span>
                                <span className="meta-text">of {games.length} games</span>
                            </>
                        ) : (
                            <span className="meta-text">Loading games...</span>
                        )}
                    </div>
                    <div className="meta-right">
                        <div className="meta-sort">
                            <label>Sort</label>
                            <div className="select-wrap">
                                <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                                    <option value="desc">Newest</option>
                                    <option value="asc">Oldest</option>
                                </select>
                                <ChevronDown size={14} />
                            </div>
                        </div>
                    </div>
                </div>

                {/* Games List */}
                {games && games.length > 0 && (
                    <div className="games-list">
                        {pageGames.map((game) => {
                            const heroResult = getHeroResult(game) || 'result';
                            const isWin = heroResult === 'win';
                            const isLoss = heroResult === 'loss';
                            const opening = game.openingName || game.eco || 'Unknown Opening';
                            const status = game.analysisStatus || (game.analyzed ? 'completed' : 'idle');
                            const whiteName = typeof game.white === 'string' ? game.white : game.white?.name || 'White';
                            const blackName = typeof game.black === 'string' ? game.black : game.black?.name || 'Black';
                            const isHeroWhite = heroLower && whiteName.toLowerCase() === heroLower;
                            const isHeroBlack = heroLower && blackName.toLowerCase() === heroLower;
                            const whiteRating = game.whiteElo || game.whiteRating || '';
                            const blackRating = game.blackElo || game.blackRating || '';

                            return (
                                <button key={game.id} onClick={() => handleView(game.id)} className="game-card">
                                    <div className={`game-card__accent ${isWin ? 'win' : isLoss ? 'loss' : 'draw'}`} />
                                    <div className="game-card__main">
                                        <div className="game-card__row game-card__row--top">
                                            <div className="game-card__players">
                                                <div className={`player ${isHeroWhite ? 'player--hero' : ''}`}>
                                                    <span className="player__color">White</span>
                                                    <span className="player__name">{whiteName}</span>
                                                    {whiteRating && <span className="player__rating">{whiteRating}</span>}
                                                </div>
                                                <div className={`player ${isHeroBlack ? 'player--hero' : ''}`}>
                                                    <span className="player__color">Black</span>
                                                    <span className="player__name">{blackName}</span>
                                                    {blackRating && <span className="player__rating">{blackRating}</span>}
                                                </div>
                                            </div>
                                            <div className="game-card__result">
                                                <span className={`result-pill ${isWin ? 'win' : isLoss ? 'loss' : 'draw'}`}>
                                                    {isWin ? 'Win' : isLoss ? 'Loss' : 'Draw'}
                                                </span>
                                                <span className="result-score">{game.result || '-'}</span>
                                            </div>
                                        </div>

                                        <div className="game-card__row game-card__row--meta">
                                            <span className={getPerfColor(game.perf)}>{game.perf || 'Rapid'}</span>
                                            <span className="meta-sep">•</span>
                                            <span className="meta-item">{formatDate(game.date)}</span>
                                            <span className="meta-sep">•</span>
                                            <span className={`status-pill ${status === 'completed' ? 'status-ok' : 'status-pending'}`}>
                                                {status === 'completed' ? 'Analyzed' : 'Pending'}
                                            </span>
                                        </div>

                                        <div className="game-card__row game-card__row--opening">
                                            <Brain size={14} />
                                            <span className="opening-label">Opening</span>
                                            <span className="opening-name" title={opening}>{opening}</span>
                                        </div>
                                    </div>
                                    <div className="game-card__cta">
                                        Review
                                        <svg className="cta-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor">
                                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                                        </svg>
                                    </div>
                                </button>
                            );
                        })}
                    </div>
                )}

                {/* Empty State */}
                {games && games.length === 0 && (
                    <div className="library-empty">
                        <div className="empty-icon">
                            <Search size={28} />
                        </div>
                        <h3>No games found</h3>
                        <p>Try adjusting your filters or import new games to get started.</p>
                        <div className="empty-actions">
                            <button
                                onClick={() => setFilters({
                                    result: 'all', color: 'all', opening: '', analyzed: 'all', perf: 'all', dateFrom: '', dateTo: '', player: ''
                                })}
                                className="btn-secondary"
                            >
                                <RotateCcw size={16} />
                                Clear Filters
                            </button>
                            <button onClick={() => navigate('/import')} className="btn-primary">
                                <span>+</span>
                                Import Games
                            </button>
                        </div>
                    </div>
                )}

                {/* Pagination */}
                {totalPages > 1 && (
                    <div className="library-pagination">
                        <button
                            className="btn-square"
                            onClick={() => setPage((p) => Math.max(1, p - 1))}
                            disabled={page === 1}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 19l-7-7 7-7" />
                            </svg>
                        </button>
                        <div className="page-indicator">
                            Page <strong>{page}</strong> of {totalPages}
                        </div>
                        <button
                            className="btn-square"
                            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                            disabled={page === totalPages}
                        >
                            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
                            </svg>
                        </button>
                    </div>
                )}

                {/* Loading */}
                {games === undefined && (
                    <div className="library-loading">
                        {Array.from({ length: 6 }).map((_, i) => (
                            <div key={i} className="skeleton-card" />
                        ))}
                        <span>Loading your games...</span>
                    </div>
                )}
            </div>

            <div className={`filter-drawer ${filtersOpen ? 'open' : ''}`} aria-hidden={!filtersOpen}>
                <div className="filter-drawer__backdrop" onClick={() => setFiltersOpen(false)} />
                <div className="filter-drawer__panel">
                    <div className="drawer-header">
                        <div>
                            <h3>All Filters</h3>
                            <p>Refine your library with precision.</p>
                        </div>
                        <button className="btn-icon" onClick={() => setFiltersOpen(false)}>
                            <X size={18} />
                        </button>
                    </div>

                    <div className="drawer-body">
                        <div className="drawer-section">
                            <label>Opening or ECO</label>
                            <div className="drawer-input">
                                <Brain size={16} />
                                <input
                                    value={filters.opening}
                                    onChange={(e) => setFilters({ ...filters, opening: e.target.value })}
                                    placeholder="Search opening or ECO..."
                                />
                                {filters.opening && (
                                    <button onClick={() => clearFilter('opening')}>
                                        <X size={14} />
                                    </button>
                                )}
                            </div>
                        </div>

                        <div className="drawer-section">
                            <label>Date Range</label>
                            <div className="drawer-grid">
                                <div className="drawer-input">
                                    <Calendar size={16} />
                                    <input
                                        type="date"
                                        value={filters.dateFrom}
                                        onChange={(e) => setFilters({ ...filters, dateFrom: e.target.value })}
                                    />
                                </div>
                                <div className="drawer-input">
                                    <Calendar size={16} />
                                    <input
                                        type="date"
                                        value={filters.dateTo}
                                        onChange={(e) => setFilters({ ...filters, dateTo: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="drawer-section">
                            <label>Quick Reset</label>
                            <button
                                onClick={() => setFilters({
                                    result: 'all', color: 'all', opening: '', analyzed: 'all', perf: 'all', dateFrom: '', dateTo: '', player: ''
                                })}
                                className="btn-secondary w-full"
                            >
                                <RotateCcw size={16} />
                                Clear All Filters
                            </button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    );
};
