import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';
import { processGame } from '../services/analyzer';

export const useAnalysisQueue = () => {
    const [isProcessing, setIsProcessing] = useState(false);
    // eslint-disable-next-line
    const [currentGameId, setCurrentGameId] = useState(null);
    const [tick, setTick] = useState(0);

    useEffect(() => {
        const id = setInterval(() => setTick((t) => (t + 1) % 1000000), 15000);
        return () => clearInterval(id);
    }, []);

    // Monitor if there are ANY pending games to trigger the processor
    // distinct from the specific game we are analyzing
    const queueState = useLiveQuery(async () => {
        const pendingCount = await db.games
            .filter(g => g.analysisStatus === 'pending')
            .count();

        const now = Date.now();
        const depth = parseInt(localStorage.getItem('engineDepth') || '15', 10) || 15;
        const deepDepth = parseInt(localStorage.getItem('engineDeepDepth') || '0', 10) || 0;
        const effectiveDepth = Math.max(depth, deepDepth);
        const multiPv = parseInt(localStorage.getItem('engineMultiPv') || '1', 10) || 1;
        const perMoveBudgetMs = Math.min(900000, Math.max(45000, 8000 + effectiveDepth * 5000 + multiPv * 9000));
        const staleMs = Math.min(30 * 60 * 1000, Math.max(4 * 60 * 1000, perMoveBudgetMs * 3));

        const analyzingList = await db.games
            .filter(g => g.analysisStatus === 'analyzing')
            .toArray();
        const stale = analyzingList.filter(g => {
            const last = g.analysisHeartbeatAt || g.analysisStartedAt;
            if (!last) return false;
            return (now - new Date(last).getTime()) > staleMs;
        });

        return { pendingCount, stale };
    }, [tick]);

    useEffect(() => {
        if (isProcessing) return;
        if (!queueState) return;
        if ((queueState.pendingCount || 0) === 0 && (!queueState.stale || queueState.stale.length === 0)) return;

        const processQueue = async () => {
            setIsProcessing(true);

            try {
                if (queueState.stale && queueState.stale.length > 0) {
                    const ids = queueState.stale.map(g => g.id);
                    await db.games.where('id').anyOf(ids).modify({ analysisStatus: 'failed', analysisStartedAt: null, analysisHeartbeatAt: null });
                }
                // Batch process until empty
                while (true) {
                    const nextGame = await db.games
                        .filter(g => g.analysisStatus === 'pending')
                        .first();

                    if (!nextGame) break;

                    setCurrentGameId(nextGame.id);
                    // console.log(`[Queue] Processing game ${nextGame.id}...`);
                    await processGame(nextGame.id);

                    // Small delay to allow UI updates and prevent CPU hogging
                    await new Promise(r => setTimeout(r, 50));
                }
            } catch (e) {
                console.error("Queue processing error", e);
            } finally {
                setIsProcessing(false);
                setCurrentGameId(null);
            }
        };

        processQueue();
    }, [queueState, isProcessing]);

    return { isProcessing, currentGameId };
};
