import { db } from './db';

const PUZZLE_GEN_KEY = 'puzzleGenerationEnabled';
const PUZZLE_GEN_EVENT = 'puzzle-generation-changed';
const PUZZLE_LIMIT_KEY = 'puzzleStorageLimit';

export const DEFAULT_PUZZLE_LIMIT = 5000;

export const getPuzzleGenerationEnabled = () => {
    if (typeof window === 'undefined') return true;
    const raw = localStorage.getItem(PUZZLE_GEN_KEY);
    if (raw === null) return false; // explicit opt-in
    return raw === 'true';
};

export const setPuzzleGenerationEnabled = (enabled) => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(PUZZLE_GEN_KEY, enabled ? 'true' : 'false');
    window.dispatchEvent(new CustomEvent(PUZZLE_GEN_EVENT, { detail: enabled }));
};

export const subscribePuzzleGeneration = (handler) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener(PUZZLE_GEN_EVENT, handler);
    return () => window.removeEventListener(PUZZLE_GEN_EVENT, handler);
};

export const getPuzzleStorageLimit = () => {
    if (typeof window === 'undefined') return DEFAULT_PUZZLE_LIMIT;
    const raw = localStorage.getItem(PUZZLE_LIMIT_KEY);
    const parsed = parseInt(raw || '', 10);
    if (!Number.isFinite(parsed) || parsed <= 0) return DEFAULT_PUZZLE_LIMIT;
    return parsed;
};

export const computePuzzlePriority = (pos) => {
    const cls = (pos?.classification || '').toLowerCase();
    let score = 2;
    if (['brilliant', 'great'].includes(cls)) score = 5;
    else if (['blunder', 'mistake'].includes(cls)) score = 4;
    else if (['inaccuracy'].includes(cls)) score = 3;
    else if (['best', 'good'].includes(cls)) score = 2;

    if (pos?.questionType === 'find_brilliant') score += 1;
    if (pos?.reviewFlag) score += 2;

    // Lower priority: winning-move / defense conversions
    if (pos?.missedWin || pos?.missedDefense || ['convert_win', 'find_defense'].includes(pos?.questionType)) {
        score -= 1;
    }

    return score;
};

export const preparePuzzleRecords = (positions, timestamp = new Date().toISOString()) => {
    return (positions || []).map((pos) => ({
        ...pos,
        createdAt: pos.createdAt || timestamp,
        priority: typeof pos.priority === 'number' ? pos.priority : computePuzzlePriority(pos)
    }));
};

export const enforcePuzzleStorageLimit = async (limit = getPuzzleStorageLimit()) => {
    if (!limit || limit <= 0) return;
    const total = await db.positions.count();
    if (total <= limit) return;

    const all = await db.positions.toArray();
    const scored = all.map((pos) => {
        const lastSeen = pos.lastSeenAt ? Date.parse(pos.lastSeenAt) : null;
        const created = pos.createdAt ? Date.parse(pos.createdAt) : null;
        const fallback = Number.isFinite(pos.id) ? pos.id : 0;
        const time = Number.isFinite(lastSeen) ? lastSeen : Number.isFinite(created) ? created : fallback;
        return {
            id: pos.id,
            score: computePuzzlePriority(pos),
            time
        };
    });

    scored.sort((a, b) => {
        if (a.score !== b.score) return a.score - b.score;
        return a.time - b.time;
    });

    const removeCount = total - limit;
    const toDelete = scored.slice(0, removeCount).map((row) => row.id).filter((id) => id != null);
    if (toDelete.length > 0) {
        await db.positions.bulkDelete(toDelete);
    }
};

export const storePuzzlePositions = async (positions) => {
    if (!positions || positions.length === 0) return;
    if (!getPuzzleGenerationEnabled()) return;
    try {
        const prepared = preparePuzzleRecords(positions);
        await db.positions.bulkAdd(prepared);
        await enforcePuzzleStorageLimit();
    } catch (err) {
        console.warn('Failed to store puzzle positions', err);
    }
};
