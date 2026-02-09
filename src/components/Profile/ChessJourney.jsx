import React from 'react';
import { useJourneyData } from '../../hooks/useJourneyData';
import { Trophy, Zap, Shield, Flame, Activity, Filter, Share2, Settings, Download, Search } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid, LineChart, Line } from 'recharts';
import { useNavigate } from 'react-router-dom';

const SummaryCard = ({ label, value, trend }) => (
    <div className="journey-card">
        <div className="journey-card__label">{label}</div>
        <div className="journey-card__value">{value}</div>
        {trend && <div className="journey-card__trend">{trend}</div>}
    </div>
);

const InsightCard = ({ title, value, description, icon: Icon, tone }) => (
    <div className={`insight-card insight-card--${tone}`}>
        <div className="insight-card__icon">
            <Icon size={20} />
        </div>
        <div>
            <div className="insight-card__title">{title}</div>
            <div className="insight-card__value">{value}</div>
            <div className="insight-card__desc">{description}</div>
        </div>
    </div>
);

export const ChessJourney = () => {
    const {
        filters,
        setFilters,
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
    } = useJourneyData();

    const heroInitial = summary?.heroUser ? summary.heroUser.charAt(0).toUpperCase() : '?';
    const navigate = useNavigate();

    const handleShare = async () => {
        const shareData = {
            title: 'Chess Journey',
            text: 'Check out my Chess Journey stats on ReelChess.',
            url: window.location.href
        };
        try {
            if (navigator.share) {
                await navigator.share(shareData);
            } else if (navigator.clipboard) {
                await navigator.clipboard.writeText(shareData.url);
                alert('Link copied to clipboard.');
            }
        } catch {
            // ignore
        }
    };

    const handleExport = () => {
        const payload = {
            generatedAt: new Date().toISOString(),
            filters,
            summary,
            ratingHistory,
            perfCounts,
            accuracySeries,
            accuracyByPerf,
            openings,
            openingEvolution,
            topVictories,
            favoriteGames
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'chess-journey-export.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    if (!summary) {
        return (
            <div className="journey-loading">
                <div className="journey-loading__card" />
                <div className="journey-loading__card" />
                <div className="journey-loading__card" />
                <span>Loading your journey...</span>
            </div>
        );
    }

    return (
        <div className="journey-page">
            <header className="journey-header">
                <div className="journey-title">
                    <div className="journey-title__badge">
                        <Trophy size={14} />
                        Chess Journey
                    </div>
                    <h1>Personal Analytics</h1>
                    <p>Track progress across variants, openings, and accuracy with live analysis updates.</p>
                </div>
                <div className="journey-header__actions">
                    <button className="btn-chip" onClick={handleShare}>
                        <Share2 size={16} />
                        Share
                    </button>
                    <button className="btn-chip" onClick={handleExport}>
                        <Download size={16} />
                        Export
                    </button>
                    <button className="btn-chip" onClick={() => navigate('/settings')}>
                        <Settings size={16} />
                        Settings
                    </button>
                </div>
            </header>

            <section className="journey-hero">
                <div className="journey-identity">
                    <div className="journey-avatar">{heroInitial}</div>
                    <div>
                        <div className="journey-identity__name">Your Journey</div>
                        <div className="journey-identity__meta">
                            Peak rating {summary.highestRating || '-'} • {summary.totalGames} games • {summary.winRate}% win rate
                        </div>
                    </div>
                </div>
                <div className="journey-summary">
                    <SummaryCard label="Peak Rating" value={summary.highestRating || '-'} />
                    <SummaryCard label="Total Games" value={summary.totalGames} />
                    <SummaryCard label="Win Rate" value={`${summary.winRate}%`} />
                    <SummaryCard label="Avg Accuracy" value={summary.avgAccuracy ? `${summary.avgAccuracy}%` : '-'} trend="Analyzed games only" />
                </div>
            </section>

            <section className="journey-timeline">
                <div className="section-header">
                    <div>
                        <h2>Rating Timeline</h2>
                        <p>Timeline is scoped to the selected variant.</p>
                    </div>
                    <div className="section-controls">
                        <div className="chip-group">
                            {['1m', '3m', '1y', 'all'].map((key) => (
                                <button
                                    key={key}
                                    className={`pill ${filters.range === key ? 'pill--active' : ''}`}
                                    onClick={() => setFilters({ ...filters, range: key })}
                                >
                                    {key.toUpperCase()}
                                </button>
                            ))}
                        </div>
                        <div className="chip-group">
                            {['all', 'rated', 'unrated'].map((key) => (
                                <button
                                    key={key}
                                    className={`pill ${filters.rated === key ? 'pill--active' : ''}`}
                                    onClick={() => setFilters({ ...filters, rated: key })}
                                >
                                    {key}
                                </button>
                            ))}
                        </div>
                        <div className="chip-group">
                            {['all', 'bullet', 'blitz', 'rapid', 'classical'].map((key) => (
                                <button
                                    key={key}
                                    className={`pill ${filters.perf === key ? 'pill--active' : ''}`}
                                    onClick={() => setFilters({ ...filters, perf: key })}
                                >
                                    {key}
                                </button>
                            ))}
                        </div>
                    </div>
                </div>

                <div className="timeline-card">
                    {(!ratingHistory || ratingHistory.length === 0) ? (
                        <div className="timeline-empty">
                            <Filter size={24} />
                            <h3>No rating history for this filter</h3>
                            <p>Adjust filters or import more games.</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height="100%">
                            <AreaChart data={ratingHistory}>
                                <defs>
                                    <linearGradient id="journeyRating" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <XAxis dataKey="date" hide />
                                <YAxis domain={['auto', 'auto']} hide />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc', borderRadius: 12 }}
                                    itemStyle={{ color: '#38bdf8' }}
                                    formatter={(value) => [`${value}`, 'Rating']}
                                    labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                                />
                                <Area
                                    type="monotone"
                                    dataKey="rating"
                                    stroke="#38bdf8"
                                    strokeWidth={2.5}
                                    fillOpacity={1}
                                    fill="url(#journeyRating)"
                                />
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </section>

            <section className="journey-variants">
                <div className="section-header">
                    <div>
                        <h2>Variant Performance</h2>
                        <p>Peak and current ratings by format.</p>
                    </div>
                </div>
                <div className="variant-grid">
                    {perfStats.length === 0 ? (
                        <div className="list-empty">No games found for variant stats.</div>
                    ) : (
                        perfStats.map((row) => (
                            <div key={row.perf} className="variant-card">
                                <div className="variant-card__title">{row.perf}</div>
                                <div className="variant-card__row">
                                    <span>Games</span>
                                    <strong>{row.total}</strong>
                                </div>
                                <div className="variant-card__row">
                                    <span>Win Rate</span>
                                    <strong>{row.winRate}%</strong>
                                </div>
                                <div className="variant-card__row">
                                    <span>Peak</span>
                                    <strong>{row.peak || '-'}</strong>
                                </div>
                                <div className="variant-card__row">
                                    <span>Current</span>
                                    <strong>{row.current || '-'}</strong>
                                </div>
                                <div className="variant-card__row">
                                    <span>Avg Accuracy</span>
                                    <strong>{row.avgAccuracy ? `${row.avgAccuracy}%` : '-'}</strong>
                                </div>
                            </div>
                        ))
                    )}
                </div>
            </section>

            <section className="journey-filters">
                <div className="section-header">
                    <div>
                        <h2>Search & Filters</h2>
                        <p>Filters update every chart in real time.</p>
                    </div>
                </div>
                <div className="journey-filter-grid">
                    <div className="journey-filter-field">
                        <Search size={16} />
                        <input
                            placeholder="Search opponent..."
                            value={filters.opponent}
                            onChange={(e) => setFilters({ ...filters, opponent: e.target.value })}
                        />
                    </div>
                    <div className="journey-filter-field">
                        <Search size={16} />
                        <input
                            placeholder="Search opening..."
                            value={filters.opening}
                            onChange={(e) => setFilters({ ...filters, opening: e.target.value })}
                        />
                    </div>
                    <div className="journey-filter-field">
                        <select
                            value={filters.color}
                            onChange={(e) => setFilters({ ...filters, color: e.target.value })}
                        >
                            <option value="all">Any Color</option>
                            <option value="white">White</option>
                            <option value="black">Black</option>
                        </select>
                    </div>
                    <div className="journey-filter-field">
                        <select
                            value={filters.result}
                            onChange={(e) => setFilters({ ...filters, result: e.target.value })}
                        >
                            <option value="all">All Results</option>
                            <option value="win">Wins</option>
                            <option value="loss">Losses</option>
                            <option value="draw">Draws</option>
                        </select>
                    </div>
                </div>
            </section>

            <section className="journey-insights">
                <div className="section-header">
                    <div>
                        <h2>Accuracy & Trends</h2>
                        <p>Accuracy is computed only on analyzed games.</p>
                    </div>
                </div>

                <div className="journey-chart-grid">
                    <div className="journey-chart-card">
                        <div className="chart-title">Accuracy Over Time</div>
                        {accuracySeries.length === 0 ? (
                            <div className="timeline-empty">
                                <Shield size={20} />
                                <h3>No analyzed games yet</h3>
                                <p>Run analysis to unlock accuracy trends.</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={240}>
                                <LineChart data={accuracySeries}>
                                    <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                                    <XAxis dataKey="date" hide />
                                    <YAxis domain={[0, 100]} hide />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc', borderRadius: 12 }}
                                        itemStyle={{ color: '#22c55e' }}
                                        formatter={(value) => [`${value}%`, 'Accuracy']}
                                        labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                                    />
                                    <Line type="monotone" dataKey="accuracy" stroke="#22c55e" strokeWidth={2.5} dot={false} />
                                </LineChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <div className="journey-chart-card">
                        <div className="chart-title">Accuracy by Variant</div>
                        {accuracyByPerf.length === 0 ? (
                            <div className="timeline-empty">
                                <Zap size={20} />
                                <h3>No analyzed games yet</h3>
                                <p>Accuracy appears once analysis is complete.</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={240}>
                                <BarChart data={accuracyByPerf}>
                                    <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                                    <XAxis dataKey="perf" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                    <YAxis domain={[0, 100]} hide />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc', borderRadius: 12 }}
                                        formatter={(value) => [`${value}%`, 'Accuracy']}
                                        labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                                    />
                                    <Bar dataKey="accuracy" fill="#38bdf8" radius={[8, 8, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
            </section>

            <section className="journey-highlights">
                <div className="section-header">
                    <div>
                        <h2>Variants & Openings</h2>
                        <p>See what you play most and how openings evolve.</p>
                    </div>
                </div>

                <div className="journey-chart-grid">
                    <div className="journey-chart-card">
                        <div className="chart-title">Variants Played</div>
                        {perfCounts.length === 0 ? (
                            <div className="timeline-empty">
                                <Activity size={20} />
                                <h3>No games found</h3>
                                <p>Import games to build your journey.</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={240}>
                                <BarChart data={perfCounts}>
                                    <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 12 }} />
                                    <YAxis hide />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc', borderRadius: 12 }}
                                        formatter={(value) => [`${value}`, 'Games']}
                                        labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                                    />
                                    <Bar dataKey="value" fill="#f5c84b" radius={[8, 8, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                    <div className="journey-chart-card">
                        <div className="chart-title">Top Openings</div>
                        {openings.length === 0 ? (
                            <div className="timeline-empty">
                                <Flame size={20} />
                                <h3>No openings yet</h3>
                                <p>Openings appear once games are imported.</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={240}>
                                <BarChart data={openings}>
                                    <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                                    <XAxis dataKey="name" tick={{ fill: '#94a3b8', fontSize: 11 }} interval={0} />
                                    <YAxis hide />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc', borderRadius: 12 }}
                                        formatter={(value) => [`${value}`, 'Games']}
                                        labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                                    />
                                    <Bar dataKey="count" fill="#8b5cf6" radius={[8, 8, 0, 0]} />
                                </BarChart>
                            </ResponsiveContainer>
                        )}
                    </div>
                </div>
                <div className="journey-chart-card">
                    <div className="chart-title">Opening Evolution</div>
                    {openingEvolution.length === 0 ? (
                        <div className="timeline-empty">
                            <Flame size={20} />
                            <h3>No opening evolution yet</h3>
                            <p>Play more games to build this trend.</p>
                        </div>
                    ) : (
                        <ResponsiveContainer width="100%" height={260}>
                            <AreaChart data={openingEvolution}>
                                <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                                <XAxis dataKey="date" tick={{ fill: '#94a3b8', fontSize: 11 }} />
                                <YAxis hide />
                                <Tooltip
                                    contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc', borderRadius: 12 }}
                                    labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                                />
                                {openings.map((opening, idx) => (
                                    <Area
                                        key={opening.name}
                                        type="monotone"
                                        dataKey={opening.name}
                                        stackId="1"
                                        stroke={['#38bdf8', '#f59e0b', '#a78bfa', '#22c55e', '#fb7185'][idx % 5]}
                                        fillOpacity={0.25}
                                        fill={['#38bdf8', '#f59e0b', '#a78bfa', '#22c55e', '#fb7185'][idx % 5]}
                                    />
                                ))}
                            </AreaChart>
                        </ResponsiveContainer>
                    )}
                </div>
            </section>

            <section className="journey-highlights">
                <div className="section-header">
                    <div>
                        <h2>Top Wins & Favorites</h2>
                        <p>Highlights update as analysis completes.</p>
                    </div>
                </div>
                <div className="journey-list-grid">
                    <div className="journey-list-card">
                        <div className="chart-title">Top Rated Victories</div>
                        {topVictories.length === 0 ? (
                            <div className="list-empty">No victories yet.</div>
                        ) : (
                            topVictories.map((g) => (
                                <div key={g.id} className="list-row">
                                    <div>
                                        <div className="list-title">{g.opponent}</div>
                                        <div className="list-meta">{g.perf} • {new Date(g.date).toLocaleDateString()}</div>
                                    </div>
                                    <div className="list-value">+{g.ratingDiff}</div>
                                </div>
                            ))
                        )}
                    </div>
                    <div className="journey-list-card">
                        <div className="chart-title">Favorite Games (Accuracy)</div>
                        {favoriteGames.length === 0 ? (
                            <div className="list-empty">Analyze games to surface favorites.</div>
                        ) : (
                            favoriteGames.map((g) => (
                                <div key={g.id} className="list-row">
                                    <div>
                                        <div className="list-title">{g.opponent}</div>
                                        <div className="list-meta">{g.perf} • {new Date(g.date).toLocaleDateString()}</div>
                                    </div>
                                    <div className="list-value">{g.accuracy}%</div>
                                </div>
                            ))
                        )}
                    </div>
                </div>
            </section>

            <footer className="journey-footer">
                <div>Generated by ReelChess</div>
                <div>Your journey continues with every move.</div>
            </footer>
        </div>
    );
};
