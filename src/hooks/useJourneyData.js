import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';

const toDate = (value) => {
    if (!value) return null;
    const d = new Date(value);
    return Number.isNaN(d.getTime()) ? null : d;
};

const monthKey = (date) => {
    const d = toDate(date);
    if (!d) return 'unknown';
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    return `${y}-${m}`;
};

const rangeToDate = (range) => {
    const now = new Date();
    if (range === '1m') return new Date(now.getFullYear(), now.getMonth() - 1, now.getDate());
    if (range === '3m') return new Date(now.getFullYear(), now.getMonth() - 3, now.getDate());
    if (range === '1y') return new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
    return null;
};

const normalizeGame = (g, heroLower) => {
    if (!g) return null;
    const white = typeof g.white === 'string' ? g.white : g.white?.name || '';
    const black = typeof g.black === 'string' ? g.black : g.black?.name || '';
    const whiteLower = white.toLowerCase();
    const blackLower = black.toLowerCase();
    const isWhite = heroLower && whiteLower === heroLower;
    const isBlack = heroLower && blackLower === heroLower;
    if (!isWhite && !isBlack) return null;

    const heroColor = isWhite ? 'white' : 'black';
    const heroRating = isWhite ? (g.whiteRating ?? g.whiteElo) : (g.blackRating ?? g.blackElo);
    const oppRating = isWhite ? (g.blackRating ?? g.blackElo) : (g.whiteRating ?? g.whiteElo);
    const opponent = isWhite ? black : white;
    const perf = (g.perf || g.speed || 'standard').toLowerCase();
    const openingName = g.openingName || g.eco || 'Unknown Opening';
    const openingFamily = openingName.split(':')[0]?.trim() || openingName;
    const rated = typeof g.rated === 'boolean' ? g.rated : null;

    let result = 'draw';
    if (g.result === '1-0') result = isWhite ? 'win' : 'loss';
    if (g.result === '0-1') result = isWhite ? 'loss' : 'win';

    const analyzed = g.analysisStatus === 'completed' || !!g.analyzed;
    const accuracy = analyzed && g.accuracy ? (heroColor === 'white' ? g.accuracy.white : g.accuracy.black) : null;

    return {
        id: g.id,
        raw: g,
        date: g.date || g.timestamp || null,
        heroColor,
        heroRating: typeof heroRating === 'number' ? heroRating : null,
        oppRating: typeof oppRating === 'number' ? oppRating : null,
        opponent,
        perf,
        rated,
        result,
        openingName,
        openingFamily,
        analyzed,
        accuracy
    };
};

const applyFilters = (games, filters, opts = {}) => {
    const ignore = new Set(opts.ignore || []);
    let out = games;

    if (!ignore.has('range')) {
        const from = rangeToDate(filters.range);
        if (from) out = out.filter((g) => toDate(g.date) && toDate(g.date) >= from);
    }

    if (!ignore.has('perf') && filters.perf !== 'all') {
        out = out.filter((g) => g.perf === filters.perf);
    }

    if (!ignore.has('color') && filters.color !== 'all') {
        out = out.filter((g) => g.heroColor === filters.color);
    }

    if (!ignore.has('rated') && filters.rated !== 'all') {
        out = out.filter((g) => {
            if (typeof g.rated !== 'boolean') return true;
            return filters.rated === 'rated' ? g.rated : !g.rated;
        });
    }

    if (!ignore.has('opening') && filters.opening) {
        const q = filters.opening.toLowerCase();
        out = out.filter((g) => `${g.openingName}`.toLowerCase().includes(q));
    }

    if (!ignore.has('opponent') && filters.opponent) {
        const q = filters.opponent.toLowerCase();
        out = out.filter((g) => `${g.opponent}`.toLowerCase().includes(q));
    }

    if (!ignore.has('result') && filters.result !== 'all') {
        out = out.filter((g) => g.result === filters.result);
    }

    return out.sort((a, b) => {
        const da = toDate(a.date)?.getTime() || 0;
        const db = toDate(b.date)?.getTime() || 0;
        return da - db;
    });
};

const average = (values) => {
    if (!values.length) return null;
    return Math.round(values.reduce((a, b) => a + b, 0) / values.length);
};

export const useJourneyData = () => {
    const heroUser = useMemo(() => (localStorage.getItem('heroUser') || '').toLowerCase(), []);
    const [filters, setFilters] = useState({
        range: 'all',
        perf: 'all',
        color: 'all',
        rated: 'all',
        result: 'all',
        opening: '',
        opponent: ''
    });

    const games = useLiveQuery(async () => {
        if (!heroUser) return [];
        const all = await db.games.toArray();
        const heroGames = all.filter((g) => {
            if (typeof g.isHero === 'boolean') return g.isHero;
            return g.white?.toLowerCase() === heroUser || g.black?.toLowerCase() === heroUser;
        });
        return heroGames.map((g) => normalizeGame(g, heroUser)).filter(Boolean);
    }, [heroUser]);

    const filteredGames = useMemo(() => applyFilters(games || [], filters), [games, filters]);
    const filteredNoPerf = useMemo(() => applyFilters(games || [], filters, { ignore: ['perf'] }), [games, filters]);
    const analyzedGames = useMemo(() => filteredGames.filter((g) => g.analyzed), [filteredGames]);

    const perfCounts = useMemo(() => {
        const counts = {};
        filteredNoPerf.forEach((g) => {
            counts[g.perf] = (counts[g.perf] || 0) + 1;
        });
        return Object.entries(counts).map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value);
    }, [filteredNoPerf]);

    const mostPlayedPerf = perfCounts[0]?.name || 'standard';
    const effectivePerf = filters.perf === 'all' ? mostPlayedPerf : filters.perf;

    const ratingHistory = useMemo(() => {
        const source = filteredGames.filter((g) => g.perf === effectivePerf && typeof g.heroRating === 'number');
        return source.map((g) => ({
            date: toDate(g.date)?.toLocaleDateString() || 'Unknown',
            rawDate: g.date,
            rating: g.heroRating
        }));
    }, [filteredGames, effectivePerf]);

    const accuracySeries = useMemo(() => {
        const buckets = {};
        analyzedGames.forEach((g) => {
            if (typeof g.accuracy !== 'number') return;
            const key = monthKey(g.date);
            if (!buckets[key]) buckets[key] = [];
            buckets[key].push(g.accuracy);
        });
        return Object.entries(buckets).map(([key, values]) => ({
            date: key,
            accuracy: average(values)
        })).sort((a, b) => a.date.localeCompare(b.date));
    }, [analyzedGames]);

    const accuracyByPerf = useMemo(() => {
        const buckets = {};
        analyzedGames.forEach((g) => {
            if (typeof g.accuracy !== 'number') return;
            if (!buckets[g.perf]) buckets[g.perf] = [];
            buckets[g.perf].push(g.accuracy);
        });
        return Object.entries(buckets).map(([perf, values]) => ({
            perf,
            accuracy: average(values)
        })).sort((a, b) => b.accuracy - a.accuracy);
    }, [analyzedGames]);

    const openings = useMemo(() => {
        const map = {};
        filteredGames.forEach((g) => {
            if (!map[g.openingFamily]) {
                map[g.openingFamily] = { name: g.openingFamily, count: 0, wins: 0, losses: 0, draws: 0 };
            }
            map[g.openingFamily].count += 1;
            if (g.result === 'win') map[g.openingFamily].wins += 1;
            if (g.result === 'loss') map[g.openingFamily].losses += 1;
            if (g.result === 'draw') map[g.openingFamily].draws += 1;
        });
        return Object.values(map).sort((a, b) => b.count - a.count).slice(0, 8);
    }, [filteredGames]);

    const perfStats = useMemo(() => {
        const map = {};
        filteredNoPerf.forEach((g) => {
            if (!map[g.perf]) {
                map[g.perf] = {
                    perf: g.perf,
                    total: 0,
                    wins: 0,
                    losses: 0,
                    draws: 0,
                    peak: 0,
                    current: null,
                    accuracyValues: []
                };
            }
            const entry = map[g.perf];
            entry.total += 1;
            if (g.result === 'win') entry.wins += 1;
            if (g.result === 'loss') entry.losses += 1;
            if (g.result === 'draw') entry.draws += 1;
            if (typeof g.heroRating === 'number') {
                entry.peak = Math.max(entry.peak, g.heroRating);
                entry.current = g.heroRating;
            }
            if (typeof g.accuracy === 'number') entry.accuracyValues.push(g.accuracy);
        });

        return Object.values(map)
            .map((entry) => ({
                perf: entry.perf,
                total: entry.total,
                winRate: entry.total ? Math.round((entry.wins / entry.total) * 100) : 0,
                peak: entry.peak || null,
                current: entry.current,
                avgAccuracy: average(entry.accuracyValues)
            }))
            .sort((a, b) => b.total - a.total);
    }, [filteredNoPerf]);

    const openingEvolution = useMemo(() => {
        const topNames = openings.map((o) => o.name);
        const buckets = {};
        filteredGames.forEach((g) => {
            if (!topNames.includes(g.openingFamily)) return;
            const key = monthKey(g.date);
            if (!buckets[key]) buckets[key] = { date: key };
            buckets[key][g.openingFamily] = (buckets[key][g.openingFamily] || 0) + 1;
        });
        return Object.values(buckets).sort((a, b) => a.date.localeCompare(b.date));
    }, [filteredGames, openings]);

    const topVictories = useMemo(() => {
        return filteredGames
            .filter((g) => g.result === 'win' && typeof g.oppRating === 'number' && typeof g.heroRating === 'number')
            .map((g) => ({
                id: g.id,
                opponent: g.opponent,
                ratingDiff: g.oppRating - g.heroRating,
                date: g.date,
                perf: g.perf
            }))
            .sort((a, b) => b.ratingDiff - a.ratingDiff)
            .slice(0, 5);
    }, [filteredGames]);

    const favoriteGames = useMemo(() => {
        return analyzedGames
            .filter((g) => g.result === 'win' && typeof g.accuracy === 'number')
            .map((g) => ({
                id: g.id,
                opponent: g.opponent,
                accuracy: g.accuracy,
                date: g.date,
                perf: g.perf
            }))
            .sort((a, b) => b.accuracy - a.accuracy)
            .slice(0, 5);
    }, [analyzedGames]);

    const summary = useMemo(() => {
        const totalGames = filteredGames.length;
        const wins = filteredGames.filter((g) => g.result === 'win').length;
        const draws = filteredGames.filter((g) => g.result === 'draw').length;
        const losses = filteredGames.filter((g) => g.result === 'loss').length;
        const winRate = totalGames ? Math.round((wins / totalGames) * 100) : 0;
        const highestRating = Math.max(0, ...filteredGames.map((g) => g.heroRating || 0));
        const avgAccuracy = average(analyzedGames.map((g) => g.accuracy).filter((v) => typeof v === 'number'));
        return {
            heroUser,
            totalGames,
            wins,
            draws,
            losses,
            winRate,
            highestRating,
            avgAccuracy,
            effectivePerf
        };
    }, [filteredGames, analyzedGames, effectivePerf, heroUser]);

    return {
        filters,
        setFilters,
        games,
        filteredGames,
        analyzedGames,
        summary,
        ratingHistory,
        perfCounts,
        perfStats,
        accuracySeries,
        accuracyByPerf,
        openings,
        openingEvolution,
        topVictories,
        favoriteGames
    };
};
