import React from 'react';
import { Target, TrendingUp, Award, AlertTriangle, XCircle, MinusCircle, HelpCircle } from 'lucide-react';

export const AnalyticsPanel = ({ game, onJumpToMove }) => {
    if (!game || !game.analysisLog) return <div className="p-8 text-center text-muted">No analysis data available.</div>;

    const { analysisLog, accuracy } = game;

    // 1. Calculate Evaluation Graph Points
    const GRAPH_HEIGHT = 60;
    const GRAPH_WIDTH = 300;

    const points = analysisLog.map((entry, index) => {
        const x = (index / (analysisLog.length - 1)) * GRAPH_WIDTH;
        // Clamp score between -500 and +500 for display
        const score = Math.max(-500, Math.min(500, entry.score));
        // Map +500 -> 0 (top), -500 -> 60 (bottom)
        const y = GRAPH_HEIGHT - ((score + 500) / 1000) * GRAPH_HEIGHT;
        return `${x},${y}`;
    }).join(' ');

    // 2. Aggregate Classifications
    const whiteCounts = { brilliant: 0, great: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };
    const blackCounts = { brilliant: 0, great: 0, best: 0, good: 0, inaccuracy: 0, mistake: 0, blunder: 0 };

    analysisLog.forEach(entry => {
        const target = entry.turn === 'w' ? whiteCounts : blackCounts;
        if (target[entry.classification] !== undefined) {
            target[entry.classification]++;
        }
    });

    const rows = [
        { label: 'Brilliant', key: 'brilliant', color: 'teal', icon: Award },
        { label: 'Great', key: 'great', color: 'teal', icon: Award },
        { label: 'Best', key: 'best', color: 'green', icon: Target },
        { label: 'Good', key: 'good', color: 'green', icon: Target },
        { label: 'Inaccuracy', key: 'inaccuracy', color: 'yellow', icon: MinusCircle },
        { label: 'Mistake', key: 'mistake', color: 'orange', icon: AlertTriangle },
        { label: 'Blunder', key: 'blunder', color: 'red', icon: XCircle },
    ];

    return (
        <div className="flex flex-col h-full bg-panel">

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
                        const wCount = whiteCounts[row.key];
                        const bCount = blackCounts[row.key];
                        // Hide row if both have 0
                        if (wCount === 0 && bCount === 0) return null;

                        return (
                            <div key={row.key} className="flex items-center justify-between p-2 rounded-md hover:bg-subtle/50 transition-colors">
                                {/* White Count */}
                                <div className={`w-12 text-center font-mono font-bold ${wCount > 0 ? `text-${row.color}-400` : 'text-muted/20'}`}>
                                    {wCount || '-'}
                                </div>

                                {/* Label */}
                                <div className="flex items-center gap-2 justify-center flex-1">
                                    <row.icon size={14} className={`text-${row.color}-500`} />
                                    <span className="text-sm text-secondary">{row.label}</span>
                                </div>

                                {/* Black Count */}
                                <div className={`w-12 text-center font-mono font-bold ${bCount > 0 ? `text-${row.color}-400` : 'text-muted/20'}`}>
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
