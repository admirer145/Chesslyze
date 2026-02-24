import { useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';
import { useHeroProfiles } from './useHeroProfiles';
import { getHeroDisplayName, getHeroSideFromGame, isHeroGameForProfiles } from '../services/heroProfiles';

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
    const daysAgo = (days) => {
        const d = new Date(now);
        d.setDate(d.getDate() - days);
        d.setHours(0, 0, 0, 0);
        return d;
    };
    if (range === '1m') return daysAgo(30);
    if (range === '3m') return daysAgo(90);
    if (range === '1y') return daysAgo(365);
    return null;
};

const parseRatingDiff = (value) => {
    if (value === null || value === undefined) return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const readTagValue = (pgn, tag) => {
    if (!pgn || !tag) return null;
    const match = pgn.match(new RegExp(`\\[${tag} "([^"]*)"\\]`));
    return match ? match[1] : null;
};

const getHeroRatingDiff = (g, isWhite, pgn) => {
    const direct = isWhite
        ? (g.whiteRatingDiff ?? g.whiteEloDiff ?? g.whiteRatingDelta)
        : (g.blackRatingDiff ?? g.blackEloDiff ?? g.blackRatingDelta);
    const directParsed = parseRatingDiff(direct);
    if (directParsed !== null) return directParsed;

    if (!pgn) return null;
    const tags = isWhite
        ? ['WhiteRatingDiff', 'WhiteEloDiff', 'WhiteRatingDelta']
        : ['BlackRatingDiff', 'BlackEloDiff', 'BlackRatingDelta'];
    for (const tag of tags) {
        const value = readTagValue(pgn, tag);
        const parsed = parseRatingDiff(value);
        if (parsed !== null) return parsed;
    }
    return null;
};

const normalizeGame = (g, heroProfiles, extras = {}) => {
    if (!g) return null;
    const pgn = extras.pgn || '';
    const analysisLog = Array.isArray(extras.analysisLog) ? extras.analysisLog : [];
    const white = typeof g.white === 'string' ? g.white : g.white?.name || '';
    const black = typeof g.black === 'string' ? g.black : g.black?.name || '';
    const heroSide = getHeroSideFromGame(g, heroProfiles);
    if (!heroSide) return null;

    const isWhite = heroSide === 'white';
    const heroColor = isWhite ? 'white' : 'black';
    const heroRating = isWhite ? (g.whiteRating ?? g.whiteElo) : (g.blackRating ?? g.blackElo);
    const heroRatingDiff = getHeroRatingDiff(g, isWhite, pgn);
    const heroRatingPost = (typeof heroRating === 'number' && typeof heroRatingDiff === 'number')
        ? heroRating + heroRatingDiff
        : heroRating;
    const oppRating = isWhite ? (g.blackRating ?? g.blackElo) : (g.whiteRating ?? g.whiteElo);
    const opponent = isWhite ? black : white;
    const whiteTitle = (g.whiteTitle || '').trim();
    const blackTitle = (g.blackTitle || '').trim();
    const opponentTitle = isWhite ? blackTitle : whiteTitle;
    const heroTitle = isWhite ? whiteTitle : blackTitle;
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
        heroRatingDiff: typeof heroRatingDiff === 'number' ? heroRatingDiff : null,
        heroRatingPost: typeof heroRatingPost === 'number' ? heroRatingPost : null,
        oppRating: typeof oppRating === 'number' ? oppRating : null,
        opponent,
        opponentTitle,
        heroTitle: heroTitle ? heroTitle.trim().toUpperCase() : '',
        perf,
        rated,
        result,
        openingName,
        openingFamily,
        analyzed,
        accuracy,
        analysisLog
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

const normalizeTitle = (title) => (title || '').trim().toUpperCase();
const isBotTitle = (title) => normalizeTitle(title) === 'BOT';
const isBotOpponent = (game) => isBotTitle(game.opponentTitle);

export const useJourneyData = (initialFilters = null) => {
    const { activeProfiles } = useHeroProfiles();
    const heroLabel = useMemo(() => getHeroDisplayName(activeProfiles), [activeProfiles]);
    const profileKey = useMemo(() => activeProfiles.map((p) => p.id).join('|'), [activeProfiles]);
    const DEFAULT_FILTERS = {
        range: 'all',
        perf: 'all',
        color: 'all',
        rated: 'all',
        result: 'all',
        opening: '',
        opponent: ''
    };
    const [filters, setFilters] = useState(() => ({
        ...DEFAULT_FILTERS,
        ...(initialFilters && typeof initialFilters === 'object' ? initialFilters : {})
    }));

    const games = useLiveQuery(async () => {
        if (!activeProfiles.length) return [];
        const all = await db.games.toArray();
        const heroGames = all.filter((g) => isHeroGameForProfiles(g, activeProfiles));
        if (!heroGames.length) return [];
        const analyzedIds = heroGames
            .filter((g) => g?.id && (g.analyzed || g.analysisStatus === 'completed'))
            .map((g) => g.id);
        const analysisRows = analyzedIds.length ? await db.gameAnalysis.bulkGet(analyzedIds) : [];
        const analysisById = new Map(analyzedIds.map((id, idx) => [id, analysisRows[idx]?.analysisLog || []]));

        const pgnIds = heroGames.map((g) => g.id);
        const pgnRows = pgnIds.length ? await db.gameContent.bulkGet(pgnIds) : [];
        const pgnById = new Map(pgnIds.map((id, idx) => [id, pgnRows[idx]?.pgn || '']));

        return heroGames
            .map((g) => normalizeGame(g, activeProfiles, {
                pgn: pgnById.get(g.id) || '',
                analysisLog: analysisById.get(g.id) || []
            }))
            .filter(Boolean);
    }, [profileKey]);

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
        const source = filteredGames
            .filter((g) => g.perf === effectivePerf && (typeof g.heroRatingPost === 'number' || typeof g.heroRating === 'number'))
            .map((g, idx) => {
                const dateObj = toDate(g.date);
                const ts = dateObj ? dateObj.getTime() : null;
                const ratingAfterRaw = (typeof g.heroRatingPost === 'number' ? g.heroRatingPost : g.heroRating);
                const ratingAfter = Number(ratingAfterRaw);
                if (!Number.isFinite(ratingAfter)) return null;
                const ratingBeforeRaw = (typeof g.heroRating === 'number'
                    ? g.heroRating
                    : (typeof g.heroRatingPost === 'number' && typeof g.heroRatingDiff === 'number'
                        ? g.heroRatingPost - g.heroRatingDiff
                        : null));
                const ratingBefore = Number.isFinite(Number(ratingBeforeRaw)) ? Number(ratingBeforeRaw) : null;
                return {
                    date: dateObj ? dateObj.toLocaleDateString() : 'Unknown',
                    rawDate: g.date,
                    ts: typeof ts === 'number' ? ts + (idx % 1000) : idx,
                    rating: ratingAfter,
                    ratingBefore,
                    ratingAfter,
                    ratingDiff: typeof g.heroRatingDiff === 'number' ? g.heroRatingDiff : null,
                    opponent: g.opponent,
                    opponentTitle: g.opponentTitle,
                    result: g.result,
                    perf: g.perf,
                    rated: g.rated
                };
            })
            .filter(Boolean)
            .sort((a, b) => (a.ts ?? 0) - (b.ts ?? 0))
            .map((entry, index) => ({ ...entry, gameIndex: index + 1 }));
        return source;
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

    const gamesPlayedSeries = useMemo(() => {
        const buckets = {};
        filteredGames.forEach((g) => {
            const key = monthKey(g.date);
            if (!buckets[key]) buckets[key] = 0;
            buckets[key] += 1;
        });
        return Object.entries(buckets).map(([key, value]) => ({
            date: key,
            games: value
        })).sort((a, b) => a.date.localeCompare(b.date));
    }, [filteredGames]);

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
            const ratingValue = typeof g.heroRatingPost === 'number' ? g.heroRatingPost : g.heroRating;
            if (typeof ratingValue === 'number') {
                entry.peak = Math.max(entry.peak, ratingValue);
                entry.current = ratingValue;
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
            .filter((g) => g.result === 'win' && typeof g.oppRating === 'number')
            .filter((g) => !isBotOpponent(g))
            .map((g) => ({
                id: g.id,
                opponent: g.opponent,
                oppRating: g.oppRating,
                date: g.date,
                perf: g.perf
            }))
            .sort((a, b) => b.oppRating - a.oppRating)
            .slice(0, 5);
    }, [filteredGames]);

    const topAccurateGames = useMemo(() => {
        return analyzedGames
            .filter((g) => typeof g.accuracy === 'number')
            .filter((g) => !isBotOpponent(g))
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

    const mostBrilliantGames = useMemo(() => {
        const heroTurn = (g) => (g.heroColor === 'white' ? 'w' : 'b');
        return analyzedGames
            .filter((g) => !isBotOpponent(g))
            .map((g) => {
                const heroSide = heroTurn(g);
                const log = Array.isArray(g.analysisLog) ? g.analysisLog : [];
                let brilliant = 0;
                let great = 0;
                log.forEach((entry) => {
                    if (entry?.turn !== heroSide) return;
                    if (entry.classification === 'brilliant') brilliant += 1;
                    if (entry.classification === 'great') great += 1;
                });
                const total = brilliant + great;
                return {
                    id: g.id,
                    opponent: g.opponent,
                    brilliant,
                    great,
                    total,
                    date: g.date,
                    perf: g.perf
                };
            })
            .filter((g) => g.total > 0)
            .sort((a, b) => {
                if (b.total !== a.total) return b.total - a.total;
                if (b.brilliant !== a.brilliant) return b.brilliant - a.brilliant;
                return b.great - a.great;
            })
            .slice(0, 5);
    }, [analyzedGames]);

    const favoriteOpponents = useMemo(() => {
        const map = new Map();
        filteredGames.forEach((g) => {
            if (!g.opponent || isBotOpponent(g)) return;
            const existing = map.get(g.opponent) || {
                opponent: g.opponent,
                count: 0,
                lastDate: null,
                lastGameId: null,
                perf: g.perf
            };
            existing.count += 1;
            const d = toDate(g.date);
            if (d && (!existing.lastDate || d > existing.lastDate)) {
                existing.lastDate = d;
                existing.lastGameId = g.id;
                existing.perf = g.perf;
            }
            map.set(g.opponent, existing);
        });

        return Array.from(map.values())
            .sort((a, b) => b.count - a.count)
            .slice(0, 5)
            .map((entry) => ({
                id: entry.lastGameId,
                opponent: entry.opponent,
                count: entry.count,
                date: entry.lastDate ? entry.lastDate.toISOString() : null,
                perf: entry.perf
            }));
    }, [filteredGames]);

    const winsVsTitled = useMemo(() => {
        return filteredGames
            .filter((g) => g.result === 'win')
            .filter((g) => !isBotOpponent(g))
            .map((g) => ({
                id: g.id,
                opponent: g.opponent,
                opponentTitle: normalizeTitle(g.opponentTitle),
                oppRating: g.oppRating,
                date: g.date,
                perf: g.perf
            }))
            .filter((g) => g.opponentTitle && !isBotTitle(g.opponentTitle))
            .sort((a, b) => (b.oppRating || 0) - (a.oppRating || 0))
            .slice(0, 5);
    }, [filteredGames]);

    const summary = useMemo(() => {
        const totalGames = filteredGames.length;
        const wins = filteredGames.filter((g) => g.result === 'win').length;
        const draws = filteredGames.filter((g) => g.result === 'draw').length;
        const losses = filteredGames.filter((g) => g.result === 'loss').length;
        const winRate = totalGames ? Math.round((wins / totalGames) * 100) : 0;
        let highestRating = 0;
        let highestPerf = null;
        filteredGames.forEach((g) => {
            const rating = (typeof g.heroRatingPost === 'number' ? g.heroRatingPost : (g.heroRating || 0));
            if (typeof rating === 'number' && rating > highestRating) {
                highestRating = rating;
                highestPerf = g.perf || null;
            }
        });
        const avgAccuracy = average(analyzedGames.map((g) => g.accuracy).filter((v) => typeof v === 'number'));
        return {
            heroUser: heroLabel,
            totalGames,
            wins,
            draws,
            losses,
            winRate,
            highestRating,
            highestPerf,
            avgAccuracy,
            effectivePerf
        };
    }, [filteredGames, analyzedGames, effectivePerf, heroLabel]);

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
        gamesPlayedSeries,
        openings,
        openingEvolution,
        topVictories,
        topAccurateGames,
        mostBrilliantGames,
        winsVsTitled,
        favoriteOpponents
    };
};
