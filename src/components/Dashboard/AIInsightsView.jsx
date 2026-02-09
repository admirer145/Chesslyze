import React from 'react';
import { Trophy, TrendingUp, AlertTriangle, Lightbulb, Target, Brain, Flag } from 'lucide-react';

const InsightCard = ({ title, items, icon: Icon, color }) => {
    if (!items || items.length === 0) return null;
    return (
        <div className="bg-subtle/30 rounded-lg border border-white/5 p-4">
            <div className="flex items-center gap-2 mb-3">
                <Icon size={16} className={`text-${color}-400`} />
                <h4 className="text-sm font-bold text-primary">{title}</h4>
            </div>
            <ul className="space-y-2">
                {items.map((item, i) => (
                    <li key={i} className="text-sm text-secondary flex gap-2 items-start">
                        <span className={`text-${color}-400 mt-1.5 w-1 h-1 rounded-full bg-current shrink-0`} />
                        <span>{item}</span>
                    </li>
                ))}
            </ul>
        </div>
    );
};

export const AIInsightsView = ({ analysis, onJumpToMove }) => {
    if (!analysis) return null;
    const { game_summary, player_insights, moves, key_moments } = analysis;

    return (
        <div className="ai-insights flex flex-col gap-6 p-5 pb-20">
            {/* 1. Game Summary */}
            <div className="ai-section space-y-4">
                <div className="bg-purple-500/10 border border-purple-500/20 rounded-xl p-5">
                    <div className="flex items-center gap-2 mb-2">
                        <Brain size={18} className="text-purple-400" />
                        <h3 className="font-bold text-lg text-primary">Game Assessment</h3>
                    </div>
                    <p className="text-secondary leading-relaxed">{game_summary.overall_assessment}</p>

                    <div className="flex flex-wrap gap-2 mt-4">
                        {game_summary.key_themes.map(theme => (
                            <span key={theme} className="px-2 py-1 bg-purple-500/20 text-purple-300 rounded text-xs font-medium border border-purple-500/30">
                                {theme}
                            </span>
                        ))}
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-4">
                    <div className="bg-subtle/50 p-3 rounded-lg border border-white/5">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Opening</div>
                        <div className="font-medium text-primary text-sm">{game_summary.opening.name}</div>
                        <div className="text-xs text-secondary font-mono mt-1">{game_summary.opening.eco}</div>
                    </div>
                    <div className="bg-subtle/50 p-3 rounded-lg border border-white/5">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Decisive Phase</div>
                        <div className="font-medium text-primary text-sm capitalize">{game_summary.decisive_phase}</div>
                    </div>
                </div>
            </div>

            {/* 2. Key Moments */}
            <div className="ai-section">
                <h3 className="ai-section__title flex items-center gap-2">
                    <Flag size={14} /> Key Moments
                </h3>
                <div className="space-y-3">
                    {key_moments.map((moment, i) => (
                        <div
                            key={i}
                            onClick={() => onJumpToMove && onJumpToMove((2*moment.move_number) - (moment.side === 'black' ? 1 : 2))} // Adjust for 0-based index if needed
                            className="group cursor-pointer bg-subtle/30 hover:bg-subtle border border-white/5 rounded-lg p-3 transition-colors"
                        >
                            <div className="flex items-center justify-between mb-1">
                                <span className="text-xs font-mono text-purple-400 group-hover:text-purple-300">Move {moment.move_number}</span>
                            </div>
                            <div className="text-sm font-medium text-primary mb-1">{moment.impact}</div>
                            <div className="text-xs text-secondary">{moment.description}</div>
                        </div>
                    ))}
                </div>
            </div>

            {/* 3. Player Insights */}
            <div className="ai-section">
                <h3 className="ai-section__title flex items-center gap-2">
                    <Target size={14} /> Player Insights
                </h3>
                <div className="grid grid-cols-1 gap-4">
                    <InsightCard
                        title="Strengths"
                        items={player_insights.strengths}
                        icon={Trophy}
                        color="green"
                    />
                    <InsightCard
                        title="Recurring Mistakes"
                        items={player_insights.recurring_mistakes}
                        icon={AlertTriangle}
                        color="red"
                    />
                    <InsightCard
                        title="Improvements"
                        items={player_insights.notable_improvements}
                        icon={TrendingUp}
                        color="blue"
                    />
                </div>
            </div>

            {/* 4. Annotated Moves List */}
            <div className="ai-section">
                <h3 className="ai-section__title flex items-center gap-2">
                    <Lightbulb size={14} /> Annotated Moves
                </h3>
                <div className="space-y-4">
                    {moves.map((move, i) => {
                        const classificationColors = {
                            brilliant: 'teal',
                            great: 'blue',
                            best: 'green',
                            good: 'green',
                            inaccuracy: 'yellow',
                            mistake: 'orange',
                            blunder: 'red',
                            book: 'stone'
                        };
                        const color = classificationColors[move.evaluation.classification] || 'gray';

                        return (
                            <div key={i} className="border-l-2 border-white/10 pl-4 py-1">
                                <div className="flex items-baseline gap-2 mb-1">
                                    <span className="font-mono text-xs text-muted">{move.move_number}{move.side === 'white' ? '.' : '...'}</span>
                                    <span
                                        className="font-bold text-primary cursor-pointer hover:underline"
                                    >
                                        {move.notation}
                                    </span>
                                    <span className={`text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-${color}-500/10 text-${color}-400`}>
                                        {move.evaluation.classification}
                                    </span>
                                </div>
                                <p className="text-sm text-secondary mb-2">{move.reasoning}</p>
                                {move.best_alternative && (
                                    <div className="text-xs text-muted bg-black/20 p-2 rounded">
                                        <span className="font-semibold text-green-400">Better: {move.best_alternative.move}</span>
                                        <span className="opacity-70"> - {move.best_alternative.explanation}</span>
                                    </div>
                                )}
                            </div>
                        );
                    })}
                </div>
            </div>
        </div>
    );
};
