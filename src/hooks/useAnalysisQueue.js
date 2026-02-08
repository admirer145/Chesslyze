import { useEffect, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../services/db';
import { processGame } from '../services/analyzer';

export const useAnalysisQueue = () => {
    const [isProcessing, setIsProcessing] = useState(false);
    // eslint-disable-next-line
    const [currentGameId, setCurrentGameId] = useState(null);

    // Monitor if there are ANY pending games to trigger the processor
    // distinct from the specific game we are analyzing
    const queueState = useLiveQuery(async () => {
        const pendingCount = await db.games
            .filter(g => g.analysisStatus === 'pending')
            .count();

        const now = Date.now();
        const analyzingList = await db.games
            .filter(g => g.analysisStatus === 'analyzing')
            .toArray();
        const stale = analyzingList.filter(g => g.analysisStartedAt && (now - new Date(g.analysisStartedAt).getTime()) > 10 * 60 * 1000);

        return { pendingCount, stale };
    }, []);

    useEffect(() => {
        if (isProcessing) return;
        if (!queueState || !queueState.pendingCount || queueState.pendingCount === 0) return;

        const processQueue = async () => {
            setIsProcessing(true);

            try {
                if (queueState.stale && queueState.stale.length > 0) {
                    const ids = queueState.stale.map(g => g.id);
                    await db.games.where('id').anyOf(ids).modify({ analysisStatus: 'failed', analysisStartedAt: null });
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
