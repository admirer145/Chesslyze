import { useMemo } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';
import { useHeroProfiles } from './useHeroProfiles';
import { getHeroDisplayName, getHeroSideFromGame, isHeroGameForProfiles } from '../services/heroProfiles';

export const useUserStats = () => {
    const { activeProfiles } = useHeroProfiles();
    const profileKey = useMemo(() => activeProfiles.map((p) => p.id).join('|'), [activeProfiles]);

    return useLiveQuery(async () => {
        if (!activeProfiles.length) return null;
        const heroLabel = getHeroDisplayName(activeProfiles);

        const all = await db.games.toArray();
        const games = all.filter((g) => isHeroGameForProfiles(g, activeProfiles));

        const analyzedIds = games
            .filter((g) => g?.id && (g.analyzed || g.analysisStatus === 'completed'))
            .map((g) => g.id);
        const analysisRows = analyzedIds.length ? await db.gameAnalysis.bulkGet(analyzedIds) : [];
        const analysisById = new Map(analyzedIds.map((id, idx) => [id, analysisRows[idx]?.analysisLog || []]));

        if (!games.length) return null;

        // Sort by date ascending
        games.sort((a, b) => a.date - b.date);

        let totalGames = 0;
        let wins = 0;
        let losses = 0;
        let draws = 0;

        // Narrative tracking
        let highestRating = 0;
        let currentRating = 0;

        let bestWin = null; // { opponent, rating, date, gameId }
        let biggestUpset = null; // { opponent, ratingDiff, date, gameId, rating }
        let wildestGame = null; // { opponent, swing, date, gameId }
        let fastestWin = null; // { opponent, ply, date, gameId }
        let longestGame = null; // { opponent, ply, date, gameId }

        const ratingHistory = [];
        const openings = {};

        // Mistakes Evolution
        // We'll split games into "Early" (first 20%) and "Recent" (last 20%) to compare stats
        const earlyCount = Math.ceil(games.length * 0.2);
        const recentStartDate = games[games.length - Math.ceil(games.length * 0.2)]?.date;

        let earlyBlunders = 0;
        let earlyMoves = 0;
        let recentBlunders = 0;
        let recentMoves = 0;

        let totalSolidMoves = 0; // for Archetype (low ACPL)
        let totalAggressiveMoves = 0; // for Archetype (high ACPL/swings but winning)

        games.forEach((g, index) => {
            const heroSide = getHeroSideFromGame(g, activeProfiles);
            const isWhite = heroSide === 'white';
            const myRating = isWhite ? g.whiteRating : g.blackRating;
            const oppRating = isWhite ? g.blackRating : g.whiteRating;
            const oppName = isWhite ? g.black : g.white;
            const log = analysisById.get(g.id) || [];

            totalGames++;
            if (myRating > highestRating) highestRating = myRating;
            currentRating = myRating;

            if (g.date) {
                // Smoother history: only add if rating changed or significant time passed
                // For now add all, Chart can downsample
                ratingHistory.push({
                    date: new Date(g.date).toLocaleDateString(),
                    rawDate: g.date,
                    rating: myRating,
                });
            }

            // Outcome
            let result = 'draw';
            if (g.result === '1-0') result = isWhite ? 'win' : 'loss';
            else if (g.result === '0-1') result = isWhite ? 'loss' : 'win';

            if (result === 'win') {
                wins++;
                // Best Win (Highest Rated Opponent)
                if (oppRating > (bestWin?.rating || 0)) {
                    bestWin = { opponent: oppName, rating: oppRating, date: g.date, gameId: g.id };
                }
                // Biggest Upset (Rating Diff)
                const diff = oppRating - myRating;
                if (diff > (biggestUpset?.ratingDiff || -9999)) {
                    biggestUpset = { opponent: oppName, ratingDiff: diff, rating: oppRating, date: g.date, gameId: g.id };
                }
                // Fastest Win
                const ply = Array.isArray(g.history) ? g.history.length : (log.length || 999);
                if (ply > 0 && ply < (fastestWin?.ply || 999)) {
                    fastestWin = { opponent: oppName, ply, date: g.date, gameId: g.id };
                }
            } else if (result === 'loss') losses++;
            else draws++;

            // Wildest Game (Max Swing)
            if (g.maxEvalSwing && g.maxEvalSwing > (wildestGame?.swing || 0)) {
                wildestGame = { opponent: oppName, swing: g.maxEvalSwing, date: g.date, gameId: g.id };
            }

            // Openings
            const opening = g.openingName || 'Unknown';
            const family = opening.split(':')[0];
            if (!openings[family]) openings[family] = { name: family, count: 0, wins: 0, losses: 0, draws: 0, lastPlayed: 0 };
            openings[family].count++;
            if (result === 'win') openings[family].wins++;
            else if (result === 'loss') openings[family].losses++;
            else openings[family].draws++;
            if (g.date > openings[family].lastPlayed) openings[family].lastPlayed = g.date;

            // Evolution / Archetype Stats (Approximate based on Analysis Log if available)
            if (g.analyzed && log.length) {
                const blunders = log.filter(l => l.classification === 'blunder').length;
                const moveCount = log.length;

                if (index < earlyCount) {
                    earlyBlunders += blunders;
                    earlyMoves += moveCount;
                } else if (index >= games.length - earlyCount) {
                    recentBlunders += blunders;
                    recentMoves += moveCount;
                }
            }
        });

        // Archetype Calculation
        // Simple heuristic: 
        // High Blunders + High Wins = "Wild Gambler"
        // Low Blunders + High Draws = "Fortress Builder"
        // High Wins + Low Avg Game Length = "Blitz Assassin"

        const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

        let archetype = "Balanced Player";
        const blunderRate = recentMoves > 0 ? (recentBlunders / recentMoves) * 100 : 0;
        const drawRate = totalGames > 0 ? (draws / totalGames) * 100 : 0;

        if (blunderRate < 1.0 && drawRate > 15) archetype = "The Solid Rock";
        else if (blunderRate > 3.0 && wins > losses) archetype = "The Chaos Master";
        else if (winRate > 60) archetype = "The Crusher";
        else if (wins < losses && blunderRate < 2.0) archetype = "The Tragic Hero"; // Plays well but loses

        // Mistakes Evolution
        // Normalized "Blunders per 100 moves"
        const earlyRate = earlyMoves > 0 ? (earlyBlunders / earlyMoves) * 100 : 0;
        const recentRate = recentMoves > 0 ? (recentBlunders / recentMoves) * 100 : 0;
        const improvement = earlyRate > 0 ? Math.round(((earlyRate - recentRate) / earlyRate) * 100) : 0;

        // Sort openings by frequency
        const topOpenings = Object.values(openings)
            .sort((a, b) => b.count - a.count)
            .slice(0, 8);

        return {
            heroUser: heroLabel,
            totalGames,
            wins, losses, draws, winRate,
            currentRating,
            highestRating,
            ratingHistory,
            openings: topOpenings,

            // Narrative Props
            archetype,
            bestWin,
            biggestUpset,
            wildestGame,
            fastestWin,
            mistakeEvolution: {
                earlyRate: earlyRate.toFixed(1),
                recentRate: recentRate.toFixed(1),
                improvement: Math.max(0, improvement)
            }
        };

    }, [profileKey]);
};
