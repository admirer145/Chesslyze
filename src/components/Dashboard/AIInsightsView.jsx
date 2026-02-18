import React from 'react';
import { Trophy, TrendingUp, AlertTriangle, Lightbulb, Target, Brain, Flag, Sparkles, ArrowUpRight } from 'lucide-react';

const InsightCard = ({ title, items, icon: Icon, tone = 'blue' }) => {
    if (!items || items.length === 0) return null;
    return (
        <div className={`ai-insight-card ai-insight-card--${tone}`}>
            <div className="ai-insight-card__header">
                <span className={`ai-insight-card__icon ai-insight-card__icon--${tone}`}>
                    <Icon size={16} />
                </span>
                <h4 className="ai-insight-card__title">{title}</h4>
            </div>
            <ul className="ai-insight-card__list">
                {items.map((item, i) => (
                    <li key={i} className="ai-insight-card__item">
                        <span className={`ai-dot ai-dot--${tone}`} />
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
    const safeMoves = Array.isArray(moves) ? moves : [];
    const safeMoments = Array.isArray(key_moments) ? key_moments : [];
    const safeThemes = Array.isArray(game_summary?.key_themes) ? game_summary.key_themes : [];

    const jumpTo = (moveNumber, side) => {
        if (!onJumpToMove || typeof moveNumber !== 'number') return;
        const normalizedSide = (side === 'black' || side === 'b') ? 'black' : 'white';
        const idx = (2 * moveNumber) - (normalizedSide === 'black' ? 1 : 2);
        if (Number.isFinite(idx) && idx >= 0) {
            onJumpToMove(idx);
        }
    };

    const classificationTokens = {
        brilliant: 'teal',
        great: 'blue',
        best: 'green',
        good: 'green',
        inaccuracy: 'yellow',
        mistake: 'orange',
        blunder: 'red',
        book: 'stone'
    };

    return (
        <div className="ai-insights">
            {/* 1. Game Summary */}
            <section className="ai-hero">
                <div className="ai-hero__header">
                    <span className="ai-hero__badge">
                        <Brain size={16} />
                    </span>
                    <div>
                        <div className="ai-hero__title">AI Coach</div>
                        <div className="ai-hero__subtitle">Game Assessment</div>
                    </div>
                </div>
                <p className="ai-hero__body">{game_summary?.overall_assessment || 'No assessment available yet.'}</p>
                {safeThemes.length > 0 && (
                    <div className="ai-chips">
                        {safeThemes.map((theme) => (
                            <span key={theme} className="ai-chip">
                                <Sparkles size={12} />
                                {theme}
                            </span>
                        ))}
                    </div>
                )}
                <div className="ai-summary-grid">
                    <div className="ai-summary-card">
                        <div className="ai-summary-card__label">Opening</div>
                        <div className="ai-summary-card__value">{game_summary?.opening?.name || '—'}</div>
                        <div className="ai-summary-card__meta">{game_summary?.opening?.eco || ''}</div>
                    </div>
                    <div className="ai-summary-card">
                        <div className="ai-summary-card__label">Decisive Phase</div>
                        <div className="ai-summary-card__value">{game_summary?.decisive_phase || '—'}</div>
                        <div className="ai-summary-card__meta">When the game turned</div>
                    </div>
                </div>
            </section>

            {/* 2. Key Moments */}
            <section className="ai-section">
                <div className="ai-section__header">
                    <Flag size={14} />
                    <span>Key Moments</span>
                </div>
                <div className="ai-moment-list">
                    {safeMoments.length === 0 && (
                        <div className="ai-empty">No key moments detected for this game.</div>
                    )}
                    {safeMoments.map((moment, i) => {
                        const momentSide = (moment?.side === 'black' || moment?.side === 'b') ? 'black' : 'white';
                        return (
                            <button
                                key={i}
                                type="button"
                                className="ai-moment-card"
                                onClick={() => jumpTo(moment.move_number, moment.side)}
                            >
                                <div className="ai-moment__meta">
                                    Move {moment.move_number}{momentSide === 'black' ? '...' : '.'}
                                </div>
                                <div className="ai-moment__title">{moment.impact}</div>
                                <div className="ai-moment__desc">{moment.description}</div>
                                <div className="ai-moment__cta">Jump to move <ArrowUpRight size={12} /></div>
                            </button>
                        );
                    })}
                </div>
            </section>

            {/* 3. Player Insights */}
            <section className="ai-section">
                <div className="ai-section__header">
                    <Target size={14} />
                    <span>Player Insights</span>
                </div>
                <div className="ai-insight-grid">
                    <InsightCard
                        title="Strengths"
                        items={player_insights?.strengths}
                        icon={Trophy}
                        tone="green"
                    />
                    <InsightCard
                        title="Recurring Mistakes"
                        items={player_insights?.recurring_mistakes}
                        icon={AlertTriangle}
                        tone="red"
                    />
                    <InsightCard
                        title="Improvements"
                        items={player_insights?.notable_improvements}
                        icon={TrendingUp}
                        tone="blue"
                    />
                </div>
            </section>

            {/* 4. Annotated Moves List */}
            <section className="ai-section">
                <div className="ai-section__header">
                    <Lightbulb size={14} />
                    <span>Annotated Moves</span>
                </div>
                <div className="ai-move-list">
                    {safeMoves.length === 0 && (
                        <div className="ai-empty">No annotated moves available yet.</div>
                    )}
                    {safeMoves.map((move, i) => {
                        const classification = move?.evaluation?.classification || 'unknown';
                        const tone = classificationTokens[classification] || 'slate';
                        const moveSide = (move?.side === 'black' || move?.side === 'b') ? 'black' : 'white';
                        return (
                            <button
                                key={i}
                                type="button"
                                className="ai-move-card"
                                onClick={() => jumpTo(move.move_number, move.side)}
                            >
                                <div className="ai-move__row">
                                    <span className="ai-move__num">{move.move_number}{moveSide === 'white' ? '.' : '...'}</span>
                                    <span className="ai-move__notation">{move.notation}</span>
                                    <span className={`ai-pill ai-pill--${tone}`}>{classification}</span>
                                </div>
                                {move.reasoning && (
                                    <div className="ai-move__reason">{move.reasoning}</div>
                                )}
                                {move.best_alternative && (
                                    <div className="ai-move__alt">
                                        <span className="ai-move__alt-label">Better: {move.best_alternative.move}</span>
                                        <span className="ai-move__alt-desc">{move.best_alternative.explanation}</span>
                                    </div>
                                )}
                                <div className="ai-move__cta">Jump to move <ArrowUpRight size={12} /></div>
                            </button>
                        );
                    })}
                </div>
            </section>
        </div>
    );
};
