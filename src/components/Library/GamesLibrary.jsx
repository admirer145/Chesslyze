import React, { useMemo, useState, useEffect } from 'react';
import { db } from '../../services/db';
import { useLiveQuery } from 'dexie-react-hooks';
import { useNavigate } from 'react-router-dom';
import { Filter, Search, RotateCcw, ChevronDown, ChevronUp, Trophy, Brain, Calendar, X, Zap, SlidersHorizontal } from 'lucide-react';
import { ConfirmModal } from '../common/ConfirmModal';

export const GamesLibrary = () => {
    const FILTERS_KEY = 'gamesLibraryFilters';
    const SORT_BY_KEY = 'gamesLibrarySortBy';
    const SORT_ORDER_KEY = 'gamesLibrarySortOrder';
    const DEFAULT_FILTERS = {
        scope: 'all',
        result: 'all',
        color: 'all',
        opening: '',
        analyzed: 'all',
        perf: 'all',
        rated: 'all',
        dateFrom: '',
        dateTo: '',
        player: '',
        myRatingOp: 'any',
        myRatingVal: '',
        oppRatingOp: 'any',
        oppRatingVal: '',
        titledOnly: false,
        botOnly: false
    };

    const loadFilters = () => {
        if (typeof window === 'undefined') return DEFAULT_FILTERS;
        try {
            const raw = localStorage.getItem(FILTERS_KEY);
            if (!raw) return DEFAULT_FILTERS;
            const parsed = JSON.parse(raw);
            if (!parsed || typeof parsed !== 'object') return DEFAULT_FILTERS;
            return { ...DEFAULT_FILTERS, ...parsed };
        } catch {
            return DEFAULT_FILTERS;
        }
    };

    const navigate = useNavigate();
    const [page, setPage] = useState(1);
    const [filtersOpen, setFiltersOpen] = useState(false);
    const [activeFilterCount, setActiveFilterCount] = useState(0);
    const [queueing, setQueueing] = useState(false);
    const [confirmAnalyzeOpen, setConfirmAnalyzeOpen] = useState(false);
    const [mobileFiltersExpanded, setMobileFiltersExpanded] = useState(false);
    const [isMobile, setIsMobile] = useState(() => typeof window !== 'undefined' && window.innerWidth < 768);

    useEffect(() => {
        const mq = window.matchMedia('(max-width: 768px)');
        const handler = (e) => setIsMobile(e.matches);
        mq.addEventListener('change', handler);
        return () => mq.removeEventListener('change', handler);
    }, []);
    const [sortOrder, setSortOrder] = useState(() => {
        if (typeof window === 'undefined') return 'desc';
        return localStorage.getItem(SORT_ORDER_KEY) || 'desc';
    });
    const [sortBy, setSortBy] = useState(() => {
        if (typeof window === 'undefined') return 'date';
        return localStorage.getItem(SORT_BY_KEY) || 'date';
    });
    const [filters, setFilters] = useState(loadFilters);

    const heroUser = useMemo(() => localStorage.getItem('heroUser') || '', []);
    const heroLower = heroUser.toLowerCase();

    // Calculate active filter count
    useEffect(() => {
        let count = 0;
        if (filters.result !== 'all') count++;
        if (filters.scope !== 'all') count++;
        if (filters.color !== 'all') count++;
        if (filters.opening !== '') count++;
        if (filters.analyzed !== 'all') count++;
        if (filters.perf !== 'all') count++;
        if (filters.rated !== 'all') count++;
        if (filters.dateFrom !== '') count++;
        if (filters.dateTo !== '') count++;
        if (filters.player !== '') count++;
        if (filters.myRatingOp !== 'any' && filters.myRatingVal !== '') count++;
        if (filters.oppRatingOp !== 'any' && filters.oppRatingVal !== '') count++;
        if (filters.titledOnly) count++;
        if (filters.botOnly) count++;
        setActiveFilterCount(count);
    }, [filters]);

    useEffect(() => {
        setPage(1);
    }, [filters, sortOrder, sortBy]);

    useEffect(() => {
        try {
            localStorage.setItem(FILTERS_KEY, JSON.stringify(filters));
            localStorage.setItem(SORT_BY_KEY, sortBy);
            localStorage.setItem(SORT_ORDER_KEY, sortOrder);
        } catch {
            // Ignore persistence failures
        }
    }, [filters, sortBy, sortOrder]);

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

    const handleAnalyzeFiltered = async () => {
        if (!games || games.length === 0) return;
        setQueueing(true);
        try {
            const ordered = [...games];
            const basePriority = Date.now();
            await db.transaction('rw', db.games, async () => {
                for (let i = 0; i < ordered.length; i++) {
                    const g = ordered[i];
                    if (!g?.id) continue;
                    await db.games.update(g.id, {
                        analyzed: false,
                        analysisStatus: 'pending',
                        analysisStartedAt: null,
                        analysisHeartbeatAt: null,
                        analysisProgress: 0,
                        analysisLog: [],
                        priority: basePriority + (ordered.length - i)
                    });
                }
            });
        } catch (error) {
            console.error('Failed to queue filtered analysis', error);
        } finally {
            setQueueing(false);
        }
    };

    const games = useLiveQuery(async () => {
        const normalizeTitle = (title) => (title || '').trim().toUpperCase();
        const isBotTitle = (title) => normalizeTitle(title) === 'BOT';
        const getMyRating = (game) => {
            if (!heroUser) return null;
            const isWhite = game.white?.toLowerCase() === heroUser.toLowerCase();
            return isWhite ? (game.whiteRating ?? game.whiteElo) : (game.blackRating ?? game.blackElo);
        };
        const getOppRating = (game) => {
            if (!heroUser) return null;
            const isWhite = game.white?.toLowerCase() === heroUser.toLowerCase();
            return isWhite ? (game.blackRating ?? game.blackElo) : (game.whiteRating ?? game.whiteElo);
        };
        const getOppTitle = (game) => {
            if (!heroUser) {
                return normalizeTitle(game.blackTitle || game.whiteTitle || '');
            }
            const isWhite = game.white?.toLowerCase() === heroUser.toLowerCase();
            const title = isWhite ? (game.blackTitle || '') : (game.whiteTitle || '');
            return normalizeTitle(title);
        };

        const all = await db.games.toArray();
        const filtered = all.filter((game) => {
            const isHeroGame = typeof game.isHero === 'boolean'
                ? game.isHero
                : heroUser && (game.white?.toLowerCase() === heroUser.toLowerCase() || game.black?.toLowerCase() === heroUser.toLowerCase());

            if (filters.scope === 'hero' && !isHeroGame) return false;
            if (filters.scope === 'others' && isHeroGame) return false;

            if (filters.result !== 'all') {
                const heroResult = getHeroResult(game);
                if (!heroResult || heroResult !== filters.result) return false;
            }
            if (filters.analyzed !== 'all') {
                const status = game.analysisStatus;

                // Precedence: Analyzing > Failed > Completed > Pending > Idle
                const isAnalyzing = status === 'analyzing';
                const isFailed = status === 'failed';

                // Completed only if not analyzing/failed AND (explicitly completed OR legacy analyzed flag)
                const isCompleted = !isAnalyzing && !isFailed && (status === 'completed' || !!game.analyzed);

                // Pending = Explicitly pending (in queue)
                const isPending = !isAnalyzing && !isFailed && !isCompleted && status === 'pending';

                // Idle = No status and not analyzed (or explicitly idle)
                const isIdle = !isAnalyzing && !isFailed && !isCompleted && !isPending;

                if (filters.analyzed === 'yes' && !isCompleted) return false;
                if (filters.analyzed === 'no' && !isPending) return false;
                if (filters.analyzed === 'idle' && !isIdle) return false;
                if (filters.analyzed === 'analyzing' && !isAnalyzing) return false;
                if (filters.analyzed === 'failed' && !isFailed) return false;
            }
            if (filters.perf !== 'all' && (game.perf || '').toLowerCase() !== filters.perf) return false;
            if (filters.rated !== 'all') {
                if (filters.rated === 'rated' && game.rated !== true) return false;
                if (filters.rated === 'unrated' && game.rated !== false) return false;
            }
            if (filters.opening) {
                const target = `${game.openingName || ''} ${game.eco || ''}`.toLowerCase();
                if (!target.includes(filters.opening.toLowerCase())) return false;
            }

            if (filters.player) {
                const playerTarget = `${game.whiteTitle || ''} ${game.white || ''} ${game.blackTitle || ''} ${game.black || ''}`.toLowerCase();
                if (!playerTarget.includes(filters.player.toLowerCase())) return false;
            }

            if (filters.color !== 'all' && heroUser) {
                const isWhite = game.white?.toLowerCase() === heroUser.toLowerCase();
                const isBlack = game.black?.toLowerCase() === heroUser.toLowerCase();
                if (filters.color === 'white' && !isWhite) return false;
                if (filters.color === 'black' && !isBlack) return false;
            }

            if (filters.myRatingOp !== 'any' && filters.myRatingVal !== '') {
                const isWhite = game.white?.toLowerCase() === heroUser.toLowerCase();
                const myRating = isWhite ? (game.whiteRating ?? game.whiteElo) : (game.blackRating ?? game.blackElo);
                const target = Number(filters.myRatingVal);
                if (!Number.isFinite(target) || typeof myRating !== 'number') return false;
                if (filters.myRatingOp === 'eq' && myRating !== target) return false;
                if (filters.myRatingOp === 'gte' && myRating < target) return false;
                if (filters.myRatingOp === 'lte' && myRating > target) return false;
            }

            if (filters.oppRatingOp !== 'any' && filters.oppRatingVal !== '') {
                const oppRating = getOppRating(game);
                const target = Number(filters.oppRatingVal);
                if (!Number.isFinite(target) || typeof oppRating !== 'number') return false;
                if (filters.oppRatingOp === 'eq' && oppRating !== target) return false;
                if (filters.oppRatingOp === 'gte' && oppRating < target) return false;
                if (filters.oppRatingOp === 'lte' && oppRating > target) return false;
            }

            if (filters.botOnly) {
                const oppTitle = getOppTitle(game);
                if (!isBotTitle(oppTitle)) return false;
            } else if (filters.titledOnly) {
                const oppTitle = getOppTitle(game);
                if (!oppTitle || isBotTitle(oppTitle)) return false;
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

        const titleRank = (title) => {
            // Higher number = higher title. This keeps "Low to High" intuitive.
            const map = {
                BOT: 0,
                WCM: 1,
                WFM: 2,
                CM: 3,
                WIM: 4,
                WNM: 5,
                NM: 6,
                FM: 7,
                WGM: 8,
                IM: 9,
                GM: 10
            };
            return map[normalizeTitle(title)] || -1;
        };

        const getSortValue = (game) => {
            if (sortBy === 'myRating') return getMyRating(game);
            if (sortBy === 'oppRating') return getOppRating(game);
            if (sortBy === 'oppTitle') return titleRank(getOppTitle(game));
            return new Date(game.date || 0).getTime();
        };

        const sorted = filtered.sort((a, b) => {
            const aVal = getSortValue(a);
            const bVal = getSortValue(b);
            if (aVal == null && bVal == null) return 0;
            if (aVal == null) return 1;
            if (bVal == null) return -1;
            if (aVal < bVal) return -1;
            if (aVal > bVal) return 1;
            return 0;
        });

        if (sortOrder === 'desc') sorted.reverse();
        return sorted;
    }, [filters, heroUser, sortOrder, sortBy]);

    const pageSize = 24;
    const totalPages = games ? Math.max(1, Math.ceil(games.length / pageSize)) : 1;
    const pageGames = games ? games.slice((page - 1) * pageSize, page * pageSize) : [];

    const handleView = (gameId) => {
        localStorage.setItem('activeGameId', String(gameId));
        window.dispatchEvent(new Event('activeGameChanged'));
        navigate('/');
    };

    const clearFilter = (key) => {
        setFilters({ ...filters, [key]: DEFAULT_FILTERS[key] });
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
                            onClick={() => setConfirmAnalyzeOpen(true)}
                            className="btn-secondary"
                            disabled={queueing || !games || games.length === 0}
                        >
                            <Zap size={16} />
                            {queueing ? 'Queueing...' : `Analyze Filtered${games ? ` (${games.length})` : ''}`}
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
                            placeholder="Search opponents, titles..."
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

                        {isMobile && (
                            <button
                                className={`pill pill--more-filters ${mobileFiltersExpanded ? 'pill--active' : ''}`}
                                onClick={() => setMobileFiltersExpanded(v => !v)}
                            >
                                <SlidersHorizontal size={13} />
                                More{activeFilterCount > (filters.result !== 'all' ? 1 : 0) ? ` (${activeFilterCount - (filters.result !== 'all' ? 1 : 0)})` : ''}
                                {mobileFiltersExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                            </button>
                        )}

                        <div className={`quick-filters__secondary ${isMobile && !mobileFiltersExpanded ? 'is-collapsed' : ''}`}>
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
                                    { v: 'all', l: 'All Games' },
                                    { v: 'rated', l: 'Rated' },
                                    { v: 'unrated', l: 'Unrated' }
                                ].map((o) => (
                                    <button
                                        key={o.v}
                                        className={`pill ${filters.rated === o.v ? 'pill--active' : ''}`}
                                        onClick={() => setFilters({ ...filters, rated: o.v })}
                                    >
                                        {o.l}
                                    </button>
                                ))}
                            </div>

                            <div className="filter-group">
                                {[
                                    { v: 'all', l: 'All Games' },
                                    { v: 'hero', l: 'Hero Only' },
                                    { v: 'others', l: 'Others' }
                                ].map((o) => (
                                    <button
                                        key={o.v}
                                        className={`pill ${filters.scope === o.v ? 'pill--active' : ''}`}
                                        onClick={() => setFilters({ ...filters, scope: o.v })}
                                    >
                                        {o.l}
                                    </button>
                                ))}
                            </div>

                            <div className="filter-group">
                                {[
                                    { v: 'all', l: 'All Status' },
                                    { v: 'yes', l: 'Analyzed' },
                                    { v: 'no', l: 'Pending' },
                                    { v: 'idle', l: 'Idle' },
                                    { v: 'analyzing', l: 'Analyzing' },
                                    { v: 'failed', l: 'Failed' }
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

                            <div className="filter-group">
                                <button
                                    className={`pill ${filters.titledOnly ? 'pill--active' : ''}`}
                                    onClick={() => setFilters({ ...filters, titledOnly: !filters.titledOnly })}
                                >
                                    Titled Only
                                </button>
                                <button
                                    className={`pill pill--bot ${filters.botOnly ? 'pill--active' : ''}`}
                                    onClick={() => setFilters({ ...filters, botOnly: !filters.botOnly })}
                                >
                                    Bots
                                </button>
                            </div>
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
                            <label>Sort By</label>
                            <div className="select-wrap">
                                <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}>
                                    <option value="date">Date</option>
                                    <option value="myRating">My Rating</option>
                                    <option value="oppRating">Opponent Rating</option>
                                    <option value="oppTitle">Opponent Title</option>
                                </select>
                                <ChevronDown size={14} />
                            </div>
                            <div className="select-wrap">
                                <select value={sortOrder} onChange={(e) => setSortOrder(e.target.value)}>
                                    <option value="desc">High to Low</option>
                                    <option value="asc">Low to High</option>
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
                            const whiteTitle = (game.whiteTitle || '').trim();
                            const blackTitle = (game.blackTitle || '').trim();
                            const renderName = (title, name) => {
                                const badge = title?.toUpperCase() === 'BOT'
                                    ? <span className="title-badge title-badge--bot">BOT</span>
                                    : (title ? <span className="title-badge">{title}</span> : null);
                                return (
                                    <span className="player__identity">
                                        {badge}
                                        <span className="player__name-text">{name}</span>
                                    </span>
                                );
                            };
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
                                                    {renderName(whiteTitle, whiteName)}
                                                    {whiteRating && <span className="player__rating">{whiteRating}</span>}
                                                </div>
                                                <div className={`player ${isHeroBlack ? 'player--hero' : ''}`}>
                                                    <span className="player__color">Black</span>
                                                    {renderName(blackTitle, blackName)}
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
                                            <span className={`status-pill status-${status === 'completed' ? 'ok' : status}`}>
                                                {status.charAt(0).toUpperCase() + status.slice(1)}
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
                                    ...DEFAULT_FILTERS
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
                            <label>Game Scope</label>
                            <div className="drawer-input">
                                <select
                                    value={filters.scope}
                                    onChange={(e) => setFilters({ ...filters, scope: e.target.value })}
                                >
                                    <option value="all">All Games</option>
                                    <option value="hero">Hero Only</option>
                                    <option value="others">Others</option>
                                </select>
                            </div>
                        </div>

                        <div className="drawer-section">
                            <label>Rated Games</label>
                            <div className="drawer-input">
                                <select
                                    value={filters.rated}
                                    onChange={(e) => setFilters({ ...filters, rated: e.target.value })}
                                >
                                    <option value="all">All</option>
                                    <option value="rated">Rated</option>
                                    <option value="unrated">Unrated</option>
                                </select>
                            </div>
                        </div>

                        <div className="drawer-section">
                            <label>My Rating</label>
                            <div className="drawer-grid">
                                <div className="drawer-input">
                                    <select
                                        value={filters.myRatingOp}
                                        onChange={(e) => setFilters({ ...filters, myRatingOp: e.target.value })}
                                    >
                                        <option value="any">Any</option>
                                        <option value="eq">Equal</option>
                                        <option value="gte">Greater or equal</option>
                                        <option value="lte">Less or equal</option>
                                    </select>
                                </div>
                                <div className="drawer-input">
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="Rating"
                                        value={filters.myRatingVal}
                                        onChange={(e) => setFilters({ ...filters, myRatingVal: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="drawer-section">
                            <label>Opponent Rating</label>
                            <div className="drawer-grid">
                                <div className="drawer-input">
                                    <select
                                        value={filters.oppRatingOp}
                                        onChange={(e) => setFilters({ ...filters, oppRatingOp: e.target.value })}
                                    >
                                        <option value="any">Any</option>
                                        <option value="eq">Equal</option>
                                        <option value="gte">Greater or equal</option>
                                        <option value="lte">Less or equal</option>
                                    </select>
                                </div>
                                <div className="drawer-input">
                                    <input
                                        type="number"
                                        min="0"
                                        placeholder="Rating"
                                        value={filters.oppRatingVal}
                                        onChange={(e) => setFilters({ ...filters, oppRatingVal: e.target.value })}
                                    />
                                </div>
                            </div>
                        </div>

                        <div className="drawer-section">
                            <label>Titled Opponents</label>
                            <div className="drawer-input drawer-toggle">
                                <input
                                    type="checkbox"
                                    checked={filters.titledOnly}
                                    onChange={(e) => setFilters({ ...filters, titledOnly: e.target.checked })}
                                />
                                <span>Only games vs titled players (GM/IM/FM/WGM etc.)</span>
                            </div>
                        </div>

                        <div className="drawer-section">
                            <label>Bot Opponents</label>
                            <div className="drawer-input drawer-toggle">
                                <input
                                    type="checkbox"
                                    checked={filters.botOnly}
                                    onChange={(e) => setFilters({ ...filters, botOnly: e.target.checked })}
                                />
                                <span>Only games vs bots (BOT)</span>
                            </div>
                        </div>

                        <div className="drawer-section">
                            <label>Quick Reset</label>
                            <button
                                onClick={() => setFilters({
                                    ...DEFAULT_FILTERS
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

            <ConfirmModal
                open={confirmAnalyzeOpen}
                title="Analyze filtered games?"
                description="This will queue analysis for every game in the current filtered list. Existing analyses will be re-run."
                meta={games ? `${games.length} games will be queued in the current order.` : null}
                confirmText="Queue Analysis"
                cancelText="Cancel"
                onCancel={() => setConfirmAnalyzeOpen(false)}
                onConfirm={async () => {
                    setConfirmAnalyzeOpen(false);
                    await handleAnalyzeFiltered();
                }}
            />
        </div>
    );
};
