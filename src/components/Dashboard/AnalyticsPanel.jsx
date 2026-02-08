import React, { useMemo } from 'react';
import { TrendingUp } from 'lucide-react';
import { Chess } from 'chess.js';

const MOVE_BADGES = {
    book: { label: 'B', tone: 'book', name: 'Book' },
    brilliant: { label: '!!', tone: 'brilliant', name: 'Brilliant' },
    great: { label: '!', tone: 'great', name: 'Great' },
    best: { label: '★', tone: 'best', name: 'Best' },
    good: { label: '✓', tone: 'good', name: 'Good' },
    inaccuracy: { label: '?!', tone: 'inaccuracy', name: 'Inaccuracy' },
    mistake: { label: '?', tone: 'mistake', name: 'Mistake' },
    blunder: { label: '??', tone: 'blunder', name: 'Blunder' }
};

const uciToMove = (uci) => {
    if (!uci || typeof uci !== 'string' || uci.length < 4) return null;
    const from = uci.substring(0, 2);
    const to = uci.substring(2, 4);
    const promotion = uci.length > 4 ? uci.substring(4, 5) : undefined;
    return { from, to, promotion };
};

const uciToSan = (fen, uci) => {
    const m = uciToMove(uci);
    if (!fen || !m) return uci || '-';
    try {
        const chess = new Chess(fen);
        const res = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
        return res?.san || uci;
    } catch {
        return uci;
    }
};

const pvToSan = (fen, pv, maxPlies = 10) => {
    if (!fen || typeof pv !== 'string' || pv.length === 0) return '';
    try {
        const chess = new Chess(fen);
        const tokens = pv.split(' ').filter(Boolean).slice(0, maxPlies);
        const out = [];
        for (const uci of tokens) {
            const m = uciToMove(uci);
            if (!m) break;
            const res = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
            if (!res) break;
            out.push(res.san);
        }
        return out.join(' ');
    } catch {
        return pv.split(' ').slice(0, maxPlies).join(' ');
    }
};

const pvToSanSteps = (fen, pv, maxPlies = 10) => {
    if (!fen || typeof pv !== 'string' || pv.length === 0) return [];
    try {
        const chess = new Chess(fen);
        const tokens = pv.split(' ').filter(Boolean).slice(0, maxPlies);
        const steps = [];
        for (const uci of tokens) {
            const m = uciToMove(uci);
            if (!m) break;
            const res = chess.move({ from: m.from, to: m.to, promotion: m.promotion });
            if (!res) break;
            steps.push({ san: res.san, fen: chess.fen() });
        }
        return steps;
    } catch {
        return [];
    }
};

export const AnalyticsPanel = ({ game, onJumpToMove, activeIndex = -1, onBestHover, onPreviewFen }) => {
    if (!game || !game.analysisLog) return <div className="p-8 text-center text-muted">No analysis data available.</div>;

    const { analysisLog, accuracy } = game;
    const activeEntry = activeIndex >= 0 ? analysisLog[activeIndex] : null;
    const afterEntry = activeIndex >= 0 ? analysisLog[activeIndex + 1] : null;

    const formatEval = (entry) => {
        if (!entry) return '-';
        if (typeof entry.mate === 'number') return `${entry.mate > 0 ? '#' : '#'}${entry.mate}`;
        const cp = typeof entry.score === 'number' ? entry.score : null;
        if (cp === null) return '-';
        const pawns = (cp / 100).toFixed(2);
        return `${cp >= 0 ? '+' : ''}${pawns}`;
    };

    // 1. Calculate Evaluation Graph Points
    const GRAPH_HEIGHT = 60;
    const GRAPH_WIDTH = 300;

    const safeScore = (v) => {
        const n = typeof v === 'number' ? v : Number(v);
        return Number.isFinite(n) ? n : 0;
    };

    const points = analysisLog.map((entry, index) => {
        const denom = Math.max(1, analysisLog.length - 1);
        const x = (index / denom) * GRAPH_WIDTH;
        // Clamp score between -500 and +500 for display
        const scoreRaw = safeScore(entry?.score);
        const score = Math.max(-500, Math.min(500, scoreRaw));
        // Map +500 -> 0 (top), -500 -> 60 (bottom)
        const y = GRAPH_HEIGHT - ((score + 500) / 1000) * GRAPH_HEIGHT;
        return `${x},${y}`;
    }).join(' ');

    const { whiteCounts, blackCounts } = useMemo(() => {
        const w = { book: 0, brilliant: 0, great: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
        const b = { book: 0, brilliant: 0, great: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
        analysisLog.forEach((entry) => {
            const target = entry.turn === 'w' ? w : b;
            // Back-compat: older analysis stored book as `bookMove: true` but kept `classification` as best/good.
            // Treat book as its own bucket and exclude it from other move-quality counts.
            if (entry.bookMove && entry.classification !== 'book') {
                target.book += 1;
                return;
            }
            if (target[entry.classification] !== undefined) target[entry.classification] += 1;
        });
        return { whiteCounts: w, blackCounts: b };
    }, [analysisLog]);

    const rows = [
        MOVE_BADGES.book,
        MOVE_BADGES.brilliant,
        MOVE_BADGES.great,
        MOVE_BADGES.best,
        MOVE_BADGES.good,
        MOVE_BADGES.inaccuracy,
        MOVE_BADGES.mistake,
        MOVE_BADGES.blunder
    ];

    return (
        <div className="flex flex-col h-full bg-panel">

            {/* Active Move Details */}
            {activeEntry && (
                <div className="p-4 border-b">
                    {(() => {
                        const playedSan = uciToSan(activeEntry.fen, activeEntry.move);
                        const bestSan = uciToSan(activeEntry.fen, activeEntry.bestMove);
                        const topEntry = (afterEntry && Array.isArray(afterEntry.pvLines) && afterEntry.pvLines.length > 0) ? afterEntry : activeEntry;
                        const topTitle = topEntry === afterEntry ? 'Top Lines (After Played Move)' : 'Top Lines';

                        return (
                            <>
                    <div className="flex items-center justify-between mb-2">
                        <h4 className="text-xs font-bold text-muted uppercase tracking-wider">Current Move</h4>
                        <div className="text-xs text-secondary">
                            Ply {activeEntry.ply} • {activeEntry.phase}
                            {activeEntry.bookMove ? ' • Book' : ''}
                        </div>
                    </div>
                    <div className="text-sm text-secondary mb-2">
                        <span className="text-primary font-semibold">{activeEntry.classification}</span>
                        {typeof activeEntry.evalDiff === 'number' ? ` • Loss ${Math.round(activeEntry.evalDiff)}cp` : ''}
                        {typeof activeEntry.score === 'number' ? ` • Eval ${formatEval(activeEntry)}` : ''}
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="p-3 rounded-lg bg-subtle border border-white/5">
                            <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Played</div>
                            <div className="text-sm text-primary font-semibold">{playedSan || '-'}</div>
                        </div>
                        <div
                            className="p-3 rounded-lg bg-subtle border border-white/5"
                            onMouseEnter={() => onBestHover && onBestHover(activeEntry.bestMove, activeEntry.fen)}
                            onMouseLeave={() => onBestHover && onBestHover(null, null)}
                        >
                            <div className="text-[10px] text-muted uppercase tracking-wider mb-1">Best</div>
                            <div className="text-sm text-primary font-semibold">{bestSan || '-'}</div>
                        </div>
                    </div>

                    {Array.isArray(topEntry?.pvLines) && topEntry.pvLines.length > 0 && (
                        <div className="mt-3">
                            <div className="text-[10px] text-muted uppercase tracking-wider mb-2">{topTitle}</div>
                            <div className="space-y-2">
                                {topEntry.pvLines.slice(0, 5).map((line) => {
                                    const pv = typeof line.pv === 'string' ? line.pv : '';
                                    const scoreText = typeof line.mate === 'number'
                                        ? `#${line.mate}`
                                        : typeof line.score === 'number'
                                            ? `${line.score >= 0 ? '+' : ''}${(line.score / 100).toFixed(2)}`
                                            : '-';
                                    const steps = pvToSanSteps(topEntry.fen, pv, 10);
                                    return (
                                        <div key={line.multipv || pv} className="p-2 rounded bg-subtle/30 border border-white/5">
                                            <div className="flex items-center justify-between text-xs">
                                                <div className="text-secondary">#{line.multipv || 1}</div>
                                                <div className="font-mono text-primary">{scoreText}</div>
                                            </div>
                                            <div
                                                className="mt-1 text-xs text-secondary break-words"
                                                onMouseLeave={() => onPreviewFen && onPreviewFen(null)}
                                            >
                                                {steps.length > 0 ? steps.map((s, idx) => (
                                                    <span
                                                        key={`${line.multipv || 1}-${idx}-${s.san}`}
                                                        className="inline-block mr-2 px-1 rounded hover:bg-white/10 cursor-default"
                                                        onMouseEnter={() => onPreviewFen && onPreviewFen(s.fen)}
                                                    >
                                                        {s.san}
                                                    </span>
                                                )) : '-'}
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    )}
                            </>
                        );
                    })()}
                </div>
            )}

            {/* Accuracy Section */}
            <div className="p-4 border-b grid grid-cols-2 gap-4">
                <div className="flex flex-col items-center p-3 bg-subtle rounded-lg border border-transparent hover:border-white/10 transition-colors">
                    <span className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1">White</span>
                    <div className="text-2xl font-bold text-white">{accuracy?.white || 0}%</div>
                    <span className="text-[10px] text-muted">Accuracy</span>
                </div>
                <div className="flex flex-col items-center p-3 bg-subtle rounded-lg border border-transparent hover:border-black/50 transition-colors">
                    <span className="text-xs font-semibold text-secondary uppercase tracking-wider mb-1">Black</span>
                    <div className="text-2xl font-bold text-white">{accuracy?.black || 0}%</div>
                    <span className="text-[10px] text-muted">Accuracy</span>
                </div>
            </div>

            {/* Evaluation Graph */}
            <div className="p-4 border-b">
                <div className="flex items-center justify-between mb-2">
                    <h4 className="text-xs font-bold text-muted uppercase tracking-wider">Evaluation</h4>
                    <TrendingUp size={14} className="text-secondary" />
                </div>
                <div className="h-[60px] w-full bg-subtle/30 rounded overflow-hidden relative border border-white/5">
                    {/* Zero line */}
                    <div className="absolute top-1/2 left-0 right-0 h-px bg-white/10 border-t border-dashed border-white/20"></div>
                    <svg width="100%" height="100%" viewBox={`0 0 ${GRAPH_WIDTH} ${GRAPH_HEIGHT}`} preserveAspectRatio="none" className="overflow-visible">
                        <defs>
                            <linearGradient id="scoreGradient" x1="0" x2="0" y1="0" y2="1">
                                <stop offset="0%" stopColor="#4ade80" stopOpacity="0.5" />
                                <stop offset="50%" stopColor="#fbbf24" stopOpacity="0.2" />
                                <stop offset="100%" stopColor="#f87171" stopOpacity="0.5" />
                            </linearGradient>
                        </defs>
                        <path
                            d={`M0,${GRAPH_HEIGHT / 2} L${points}`}
                            fill="none"
                            stroke="url(#scoreGradient)"
                            strokeWidth="2"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                            className="drop-shadow-sm"
                        />
                    </svg>
                </div>
            </div>

            {/* Classification List */}
            <div className="flex-1 overflow-y-auto p-4">
                <div className="flex justify-between items-center mb-4 px-2">
                    <span className="text-xs font-bold text-muted uppercase tracking-wider w-12 text-center">White</span>
                    <span className="text-xs font-bold text-center text-muted uppercase tracking-wider flex-1">Move Quality</span>
                    <span className="text-xs font-bold text-muted uppercase tracking-wider w-12 text-center">Black</span>
                </div>

                <div className="space-y-1">
                    {rows.map(row => {
                        const wCount = whiteCounts[row.tone] ?? 0;
                        const bCount = blackCounts[row.tone] ?? 0;
                        // Hide row if both have 0
                        if (wCount === 0 && bCount === 0) return null;

                        return (
                            <div key={row.tone} className="flex items-center justify-between p-2 rounded-md hover:bg-subtle/50 transition-colors">
                                {/* White Count */}
                                <div className={`w-12 text-center font-mono font-bold ${wCount > 0 ? 'text-primary' : 'text-muted/20'}`}>
                                    {wCount || '-'}
                                </div>

                                {/* Label */}
                                <div className="flex items-center gap-2 justify-center flex-1">
                                    <span className={`quality-badge badge-${row.tone}`}>{row.label}</span>
                                    <span className="text-sm text-secondary">{row.name}</span>
                                </div>

                                {/* Black Count */}
                                <div className={`w-12 text-center font-mono font-bold ${bCount > 0 ? 'text-primary' : 'text-muted/20'}`}>
                                    {bCount || '-'}
                                </div>
                            </div>
                        );
                    })}
                </div>
            </div>

        </div>
    );
};
