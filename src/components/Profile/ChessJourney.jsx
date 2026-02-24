import React, { useEffect, useMemo, useState, useRef, useId } from 'react';
import { useJourneyData } from '../../hooks/useJourneyData';
import { Trophy, Zap, Shield, Flame, Activity, Filter, Share2, Settings, Download, Search, X } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, CartesianGrid, LineChart, Line } from 'recharts';
import { useNavigate } from 'react-router-dom';
import { useHeroProfiles } from '../../hooks/useHeroProfiles';

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

const formatOpeningTick = (value, maxLen = 14) => {
    if (!value || typeof value !== 'string') return '';
    if (value.length <= maxLen) return value;
    return `${value.slice(0, maxLen - 3)}...`;
};

const OpeningEvolutionTooltip = ({ active, payload, label }) => {
    if (!active || !payload || payload.length === 0) return null;
    const sorted = payload
        .filter((entry) => typeof entry?.value === 'number')
        .sort((a, b) => b.value - a.value);

    if (sorted.length === 0) return null;

    return (
        <div className="journey-tooltip">
            <div className="journey-tooltip__label">{label}</div>
            <div className="journey-tooltip__list">
                {sorted.map((entry) => (
                    <div key={entry.dataKey} className="journey-tooltip__row">
                        <div className="journey-tooltip__name">
                            <span className="journey-tooltip__dot" style={{ background: entry.color }} />
                            <span>{entry.dataKey}</span>
                        </div>
                        <div className="journey-tooltip__value">{entry.value}</div>
                    </div>
                ))}
            </div>
        </div>
    );
};

const formatShortDate = (value) => {
    if (!value) return '';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

const formatLongDate = (value) => {
    if (!value) return 'Unknown date';
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return String(value);
    return date.toLocaleString(undefined, { year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
};

const RatingTimelineTooltip = ({ active, payload }) => {
    if (!active || !payload || payload.length === 0) return null;
    const entry = payload[0]?.payload;
    if (!entry) return null;
    const opponentLabel = entry.opponentTitle ? `${entry.opponentTitle} ${entry.opponent}` : entry.opponent;
    return (
        <div className="journey-tooltip">
            <div className="journey-tooltip__label">{formatLongDate(entry.rawDate || entry.ts)}</div>
            <div className="journey-tooltip__list">
                <div className="journey-tooltip__row">
                    <div className="journey-tooltip__name">Rating</div>
                    <div className="journey-tooltip__value">
                        {typeof entry.ratingAfter === 'number' ? entry.ratingAfter : entry.rating}
                    </div>
                </div>
            </div>
        </div>
    );
};

const formatPerfLabel = (perf) => {
    if (!perf) return '';
    const key = perf.toLowerCase();
    const map = {
        rapid: 'Rapid',
        blitz: 'Blitz',
        bullet: 'Bullet',
        classical: 'Classical',
        correspondence: 'Corr',
        standard: 'Standard'
    };
    return map[key] || `${key.charAt(0).toUpperCase()}${key.slice(1)}`;
};

const clampText = (value, max = 26) => {
    if (!value) return '';
    const str = String(value);
    if (str.length <= max) return str;
    return `${str.slice(0, Math.max(0, max - 3))}...`;
};

const textFitProps = (text, maxWidth, threshold = 18) => {
    if (!text || !maxWidth) return {};
    const raw = String(text);
    if (raw.length <= threshold) return {};
    return { textLength: maxWidth, lengthAdjust: 'spacingAndGlyphs' };
};

const JourneyShareCard = React.forwardRef(({ variant = 'story', data }, ref) => {
    const uidRaw = useId();
    const uid = uidRaw ? uidRaw.replace(/:/g, '') : 'share';
    const width = 1080;
    const height = variant === 'post' ? 1350 : 1920;
    const headerH = Math.round(height * 0.12);
    const heroH = Math.round(height * 0.18);
    const statH = Math.round(height * 0.22);
    const ratingH = Math.round(height * 0.12);
    const highlightH = Math.round(height * 0.26);
    const footerH = height - headerH - heroH - statH - ratingH - highlightH;
    const pad = Math.round(width * 0.07);
    const gap = Math.round(width * 0.02);

    const name = data?.name || 'Hero';
    const handle = data?.handle || 'Chesslyze Profile';
    const ratingsLine = data?.ratingsLine || 'No rated games yet';
    const ratingParts = Array.isArray(data?.ratingParts) ? data.ratingParts : [];
    const peakRating = Number.isFinite(data?.peakRating) ? Math.round(data.peakRating) : null;
    const winRate = Number.isFinite(data?.winRate) ? Math.round(data.winRate) : null;
    const totalGames = Number.isFinite(data?.totalGames) ? Math.round(data.totalGames) : null;
    const peakPerf = data?.peakPerf || null;
    const highlights = Array.isArray(data?.highlights) ? data.highlights : [];
    const theme = data?.theme === 'light' ? 'light' : 'dark';
    const heroTitle = (data?.heroTitle || '').toString().trim();

    const palette = theme === 'light'
        ? {
            bgStart: '#f8fafc',
            bgEnd: '#e2e8f0',
            panel: '#ffffff',
            panelStroke: '#e2e8f0',
            text: '#0f172a',
            muted: '#475569',
            accent: '#d97706',
            accentSoft: 'rgba(217, 119, 6, 0.18)',
            chip: '#f1f5f9',
            chipText: '#0f172a',
            chipStroke: '#e2e8f0'
        }
        : {
            bgStart: '#0b1220',
            bgEnd: '#0f172a',
            panel: 'rgba(15, 23, 42, 0.88)',
            panelStroke: 'rgba(148, 163, 184, 0.2)',
            text: '#f8fafc',
            muted: 'rgba(226, 232, 240, 0.75)',
            accent: '#fbbf24',
            accentSoft: 'rgba(251, 191, 36, 0.18)',
            chip: 'rgba(30, 41, 59, 0.7)',
            chipText: '#f8fafc',
            chipStroke: 'rgba(148, 163, 184, 0.24)'
        };

    const heroY = headerH;
    const avatarSize = Math.round(heroH * 0.72);
    const avatarX = pad;
    const avatarY = Math.round(heroY + (heroH - avatarSize) / 2);
    const nameX = avatarX + avatarSize + Math.round(pad * 0.6);
    const nameY = avatarY + Math.round(avatarSize * 0.48);
    const titleBadgeY = nameY + 18;
    const handleBaseY = nameY + Math.round(avatarSize * 0.28);
    const badgeH = 36;
    const badgePad = 16;
    const badgeTextSize = 20;
    const badgeW = heroTitle ? Math.max(72, Math.min(220, heroTitle.length * 18 + badgePad * 2)) : 0;
    const handleY = heroTitle ? titleBadgeY + badgeH + 18 : handleBaseY;
    const heroTextMaxW = width - nameX - pad;

    const statY = heroY + heroH + Math.round(height * 0.02);
    const statCardX = pad;
    const statCardY = statY + Math.round(statH * 0.12);
    const statCardW = width - pad * 2;
    const statCardH = statH - Math.round(statH * 0.22);
    const statLabelY = statCardY + Math.round(statCardH * 0.38);
    const statValueY = statCardY + Math.round(statCardH * 0.72);
    const statInnerPad = 48;
    const statColGap = 24;
    const statColW = Math.floor((statCardW - statInnerPad * 2 - statColGap * 2) / 3);
    const statColX1 = statCardX + statInnerPad;
    const statColX2 = statColX1 + statColW + statColGap;
    const statColX3 = statColX2 + statColW + statColGap;

    const ratingY = statY + statH;
    const ratingRowY = ratingY + Math.round(ratingH * 0.3);
    const chipH = Math.round(ratingH * 0.42);
    const ratingCount = ratingParts.length;
    const ratingSlotCount = ratingCount ? Math.min(3, ratingCount) : 1;
    const chipW = Math.round((width - pad * 2 - gap * (ratingSlotCount - 1)) / ratingSlotCount);

    const highlightY = ratingY + ratingH;
    const cardW = Math.floor((width - pad * 2 - gap * 2) / 3);
    const cardH = Math.round(highlightH * 0.72);
    const cardY = highlightY + Math.round(highlightH * 0.14);

    const footerY = highlightY + highlightH;
    const footerTextY = footerY + Math.round(footerH * 0.55);

    const safeHighlights = [...highlights];
    while (safeHighlights.length < 3) {
        safeHighlights.push({
            title: 'Next Milestone',
            value: 'Keep playing',
            meta: 'Highlights unlock soon'
        });
    }

    return (
        <svg
            ref={ref}
            width={width}
            height={height}
            viewBox={`0 0 ${width} ${height}`}
            xmlns="http://www.w3.org/2000/svg"
            className="journey-share-card"
        >
            <defs>
                <linearGradient id={`journey-bg-${uid}`} x1="0" y1="0" x2="1" y2="1">
                    <stop offset="0%" stopColor={palette.bgStart} />
                    <stop offset="100%" stopColor={palette.bgEnd} />
                </linearGradient>
                <radialGradient id={`journey-glow-${uid}`} cx="0.2" cy="0.1" r="0.9">
                    <stop offset="0%" stopColor={theme === 'light' ? 'rgba(59, 130, 246, 0.16)' : 'rgba(56, 189, 248, 0.28)'} />
                    <stop offset="70%" stopColor="rgba(0, 0, 0, 0)" />
                </radialGradient>
                <linearGradient id={`journey-accent-${uid}`} x1="0" y1="0" x2="1" y2="0">
                    <stop offset="0%" stopColor={palette.accent} />
                    <stop offset="100%" stopColor={theme === 'light' ? '#f59e0b' : '#fde68a'} />
                </linearGradient>
            </defs>

            <rect width={width} height={height} fill={`url(#journey-bg-${uid})`} />
            <rect width={width} height={height} fill={`url(#journey-glow-${uid})`} />

            <text
                x={pad}
                y={Math.round(headerH * 0.6)}
                fill={palette.text}
                fontSize="32"
                fontFamily="Space Grotesk, sans-serif"
                letterSpacing="4"
                textTransform="uppercase"
            >
                Chess Journey
            </text>

            <rect x={pad} y={heroY} width={width - pad * 2} height={heroH} rx="28" fill={palette.panel} stroke={palette.panelStroke} />
            <circle cx={avatarX + avatarSize / 2} cy={avatarY + avatarSize / 2} r={avatarSize / 2} fill={palette.accentSoft} />
            <circle cx={avatarX + avatarSize / 2} cy={avatarY + avatarSize / 2} r={avatarSize / 2 - 6} fill={palette.panel} stroke={palette.panelStroke} strokeWidth="2" />
            <text
                x={avatarX + avatarSize / 2}
                y={avatarY + avatarSize / 2 + 16}
                textAnchor="middle"
                fill={palette.text}
                fontSize={Math.round(avatarSize * 0.42)}
                fontFamily="Space Grotesk, sans-serif"
                fontWeight="700"
            >
                {name.charAt(0).toUpperCase()}
            </text>

            <text
                x={nameX}
                y={nameY}
                fill={palette.text}
                fontSize="58"
                fontFamily="Space Grotesk, sans-serif"
                fontWeight="700"
                {...textFitProps(clampText(name, 20), heroTextMaxW, 14)}
            >
                {clampText(name, 20)}
            </text>
            <text
                x={nameX}
                y={handleY}
                fill={palette.muted}
                fontSize="26"
                fontFamily="Space Grotesk, sans-serif"
                {...textFitProps(clampText(handle, 24), heroTextMaxW, 16)}
            >
                {clampText(handle, 24)}
            </text>

            {heroTitle && (
                <>
                    <rect
                        x={nameX}
                        y={titleBadgeY}
                        width={badgeW}
                        height={badgeH}
                        rx="18"
                        fill={palette.accentSoft}
                        stroke={palette.accent}
                        strokeWidth="1"
                    />
                    <text
                        x={nameX + badgeW / 2}
                        y={titleBadgeY + badgeH / 2 + 7}
                        textAnchor="middle"
                        fill={palette.accent}
                        fontSize={badgeTextSize}
                        fontFamily="Space Grotesk, sans-serif"
                        fontWeight="700"
                        letterSpacing="1"
                    >
                        {heroTitle}
                    </text>
                </>
            )}

            <rect x={statCardX} y={statCardY} width={statCardW} height={statCardH} rx="32" fill={palette.panel} stroke={palette.panelStroke} />
            <rect x={statCardX + 24} y={statCardY + 18} width={statCardW - 48} height="6" rx="4" fill={`url(#journey-accent-${uid})`} opacity="0.9" />
            <text x={statColX1} y={statLabelY} fill={palette.muted} fontSize="22" fontFamily="Space Grotesk, sans-serif" fontWeight="600">
                Peak Rating{peakPerf ? ` (${formatPerfLabel(peakPerf)})` : ''}
            </text>
            <text x={statColX1} y={statValueY} fill={palette.accent} fontSize="64" fontFamily="Space Grotesk, sans-serif" fontWeight="700">
                {peakRating ?? '--'}
            </text>
            <text x={statColX2} y={statLabelY} fill={palette.muted} fontSize="22" fontFamily="Space Grotesk, sans-serif" fontWeight="600">
                Win Rate
            </text>
            <text x={statColX2} y={statValueY} fill={palette.accent} fontSize="64" fontFamily="Space Grotesk, sans-serif" fontWeight="700">
                {winRate ?? '--'}%
            </text>
            <text x={statColX3} y={statLabelY} fill={palette.muted} fontSize="22" fontFamily="Space Grotesk, sans-serif" fontWeight="600">
                Total Games
            </text>
            <text x={statColX3} y={statValueY} fill={palette.accent} fontSize="64" fontFamily="Space Grotesk, sans-serif" fontWeight="700">
                {totalGames ?? '--'}
            </text>

            {ratingCount > 0 ? (
                ratingParts.slice(0, 3).map((part, idx) => {
                    const x = pad + idx * (chipW + gap);
                    return (
                        <g key={`${part}-${idx}`}>
                            <rect x={x} y={ratingRowY} width={chipW} height={chipH} rx="18" fill={palette.chip} stroke={palette.chipStroke} />
                            <text
                                x={x + chipW / 2}
                                y={ratingRowY + chipH / 2 + 8}
                                textAnchor="middle"
                                fill={palette.chipText}
                                fontSize="24"
                                fontFamily="IBM Plex Mono, ui-monospace, monospace"
                                {...textFitProps(part, chipW - 24, 12)}
                            >
                                {part}
                            </text>
                        </g>
                    );
                })
            ) : (
                <text
                    x={pad}
                    y={ratingRowY + chipH / 2 + 8}
                    fill={palette.muted}
                    fontSize="24"
                    fontFamily="IBM Plex Mono, ui-monospace, monospace"
                >
                    {ratingsLine}
                </text>
            )}

            {safeHighlights.slice(0, 3).map((card, idx) => {
                const x = pad + idx * (cardW + gap);
                const labelY = cardY + Math.round(cardH * 0.28);
                const valueY = cardY + Math.round(cardH * 0.56);
                const metaY = cardY + Math.round(cardH * 0.8);
                return (
                    <g key={`${card.title}-${idx}`}>
                        <rect x={x} y={cardY} width={cardW} height={cardH} rx="24" fill={palette.panel} stroke={palette.panelStroke} />
                        <text
                            x={x + 24}
                            y={labelY}
                            fill={palette.muted}
                            fontSize="22"
                            fontFamily="Space Grotesk, sans-serif"
                            {...textFitProps(clampText(card.title, 18), cardW - 48, 14)}
                        >
                            {clampText(card.title, 18)}
                        </text>
                        {card.valueSplit ? (
                            <>
                                <text
                                    x={x + 24}
                                    y={valueY}
                                    fill={palette.text}
                                    fontSize="30"
                                    fontFamily="Space Grotesk, sans-serif"
                                    fontWeight="600"
                                    {...textFitProps(`Beat ${card.valueSplit.name}`, cardW - 48, 14)}
                                >
                                    {`Beat ${card.valueSplit.name}`}
                                </text>
                                <rect
                                    x={x + 24}
                                    y={valueY + 10}
                                    width={Math.max(58, Math.min(140, (card.valueSplit.title || '').length * 16 + 28))}
                                    height="28"
                                    rx="14"
                                    fill={palette.accentSoft}
                                    stroke={palette.accent}
                                    strokeWidth="1"
                                />
                                <text
                                    x={x + 24 + Math.max(58, Math.min(140, (card.valueSplit.title || '').length * 16 + 28)) / 2}
                                    y={valueY + 30}
                                    textAnchor="middle"
                                    fill={palette.accent}
                                    fontSize="18"
                                    fontFamily="Space Grotesk, sans-serif"
                                    fontWeight="700"
                                    letterSpacing="0.6"
                                >
                                    {card.valueSplit.title}
                                </text>
                            </>
                        ) : (
                            <text
                                x={x + 24}
                                y={valueY}
                                fill={palette.text}
                                fontSize="30"
                                fontFamily="Space Grotesk, sans-serif"
                                fontWeight="600"
                                {...textFitProps(clampText(card.value, 20), cardW - 48, 16)}
                            >
                                {clampText(card.value, 20)}
                            </text>
                        )}
                        <text
                            x={x + 24}
                            y={metaY}
                            fill={palette.muted}
                            fontSize="20"
                            fontFamily="IBM Plex Mono, ui-monospace, monospace"
                            {...textFitProps(clampText(card.meta, 22), cardW - 48, 16)}
                        >
                            {clampText(card.meta, 22)}
                        </text>
                    </g>
                );
            })}

            <text x={width / 2} y={footerTextY} textAnchor="middle" fill={palette.muted} fontSize="26" fontFamily="Space Grotesk, sans-serif">
                Analyze your games on Chesslyze
            </text>
        </svg>
    );
});

JourneyShareCard.displayName = 'JourneyShareCard';

export const ChessJourney = () => {
    const FILTERS_STORAGE_KEY = 'journeyFilters';
    const RATING_ZOOM_STORAGE_KEY = 'journeyRatingZoom';
    const [initialFilters] = useState(() => {
        if (typeof window === 'undefined') return null;
        try {
            const raw = localStorage.getItem(FILTERS_STORAGE_KEY);
            if (!raw) return null;
            const parsed = JSON.parse(raw);
            return parsed && typeof parsed === 'object' ? parsed : null;
        } catch {
            return null;
        }
    });
    const {
        filters,
        setFilters,
        filteredGames,
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
    } = useJourneyData(initialFilters);

    const { activeProfiles } = useHeroProfiles();

    const heroInitial = summary?.heroUser ? summary.heroUser.charAt(0).toUpperCase() : '?';
    const navigate = useNavigate();
    const [ratingZoom, setRatingZoom] = useState(() => {
        if (typeof window === 'undefined') return 'all';
        try {
            const raw = localStorage.getItem(RATING_ZOOM_STORAGE_KEY);
            if (!raw) return 'all';
            if (raw === 'all') return 'all';
            const asNumber = Number(raw);
            return Number.isFinite(asNumber) ? asNumber : 'all';
        } catch {
            return 'all';
        }
    });
    const [shareOpen, setShareOpen] = useState(false);
    const [shareVariant, setShareVariant] = useState('story');
    const [shareBusy, setShareBusy] = useState(false);
    const [shareMessage, setShareMessage] = useState('');
    const shareCardRef = useRef(null);
    const [themeMode, setThemeMode] = useState(() => {
        if (typeof document === 'undefined') return 'dark';
        return document.documentElement.getAttribute('data-theme') === 'light' ? 'light' : 'dark';
    });

    const primaryProfile = useMemo(() => {
        if (!activeProfiles || activeProfiles.length !== 1) return null;
        return activeProfiles[0];
    }, [activeProfiles]);

    const heroTitle = useMemo(() => {
        const counts = new Map();
        (filteredGames || []).forEach((g) => {
            const raw = (g?.heroTitle || '').trim().toUpperCase();
            if (!raw || raw === 'BOT') return;
            counts.set(raw, (counts.get(raw) || 0) + 1);
        });
        let best = null;
        let bestCount = 0;
        for (const [title, count] of counts.entries()) {
            if (count > bestCount) {
                best = title;
                bestCount = count;
            }
        }
        return best;
    }, [filteredGames]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(FILTERS_STORAGE_KEY, JSON.stringify(filters));
        } catch {
            // ignore write failures (private mode, storage full, etc.)
        }
    }, [filters]);

    useEffect(() => {
        if (typeof window === 'undefined') return;
        try {
            localStorage.setItem(RATING_ZOOM_STORAGE_KEY, String(ratingZoom));
        } catch {
            // ignore write failures (private mode, storage full, etc.)
        }
    }, [ratingZoom]);

    useEffect(() => {
        if (typeof document === 'undefined') return;
        const root = document.documentElement;
        const update = () => {
            setThemeMode(root.getAttribute('data-theme') === 'light' ? 'light' : 'dark');
        };
        update();
        const observer = new MutationObserver(update);
        observer.observe(root, { attributes: true, attributeFilter: ['data-theme'] });
        return () => observer.disconnect();
    }, []);

    const openGame = (gameId) => {
        if (!gameId) return;
        localStorage.setItem('activeGameId', String(gameId));
        window.dispatchEvent(new Event('activeGameChanged'));
        navigate('/');
    };

    const handleShare = () => {
        setShareMessage('');
        setShareOpen(true);
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
            gamesPlayedSeries,
            openings,
            openingEvolution,
            topVictories,
            topAccurateGames,
            mostBrilliantGames,
            winsVsTitled,
            favoriteOpponents
        };
        const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'chess-journey-export.json';
        a.click();
        URL.revokeObjectURL(url);
    };

    const visibleRatingHistory = useMemo(() => {
        if (!ratingHistory || ratingHistory.length === 0) return [];
        if (ratingZoom === 'all') return ratingHistory;
        const size = Math.min(Number(ratingZoom) || ratingHistory.length, ratingHistory.length);
        return ratingHistory.slice(ratingHistory.length - size);
    }, [ratingHistory, ratingZoom]);

    const ratingStart = visibleRatingHistory.length ? visibleRatingHistory[0] : null;
    const ratingEnd = visibleRatingHistory.length ? visibleRatingHistory[visibleRatingHistory.length - 1] : null;
    const ratingIndexToDate = useMemo(() => {
        const map = new Map();
        visibleRatingHistory.forEach((entry) => {
            if (typeof entry.gameIndex === 'number') {
                map.set(entry.gameIndex, entry.rawDate || entry.date);
            }
        });
        return map;
    }, [visibleRatingHistory]);

    const ratingTickIndices = useMemo(() => {
        const ticks = [];
        let lastLabel = null;
        for (const entry of visibleRatingHistory) {
            if (typeof entry.gameIndex !== 'number') continue;
            const label = formatShortDate(entry.rawDate || entry.date);
            if (label && label !== lastLabel) {
                ticks.push(entry.gameIndex);
                lastLabel = label;
            }
        }
        if (ticks.length > 6) {
            const step = Math.ceil(ticks.length / 6);
            return ticks.filter((_, idx) => idx % step === 0);
        }
        return ticks;
    }, [visibleRatingHistory]);

    const formatGameIndexTick = (value) => {
        const dateValue = ratingIndexToDate.get(value);
        return formatShortDate(dateValue || value);
    };

    const shareHighlights = useMemo(() => {
        const cards = [];
        const bestWin = topVictories[0];
        if (bestWin) {
            cards.push({
                title: 'Best Win',
                value: `vs ${bestWin.opponent || 'Opponent'}`,
                meta: `${bestWin.oppRating || '-'} • ${formatPerfLabel(bestWin.perf)}`
            });
        }

        const titledWin = winsVsTitled[0];
        if (titledWin) {
            const title = (titledWin.opponentTitle || '').trim();
            cards.push({
                title: 'Win vs Titled',
                value: `Beat ${title ? `${title} ` : ''}${titledWin.opponent || 'Opponent'}`.trim(),
                valueSplit: title ? { title, name: titledWin.opponent || 'Opponent' } : null,
                meta: `${titledWin.oppRating || '-'} • ${formatPerfLabel(titledWin.perf)}`
            });
        }

        const topOpening = openings[0];
        if (cards.length < 3 && topOpening) {
            cards.push({
                title: 'Most Played Opening',
                value: topOpening.name || 'Opening',
                meta: `${topOpening.count || 0} games`
            });
        }

        const favorite = favoriteOpponents[0];
        if (cards.length < 3 && favorite) {
            cards.push({
                title: 'Favorite Opponent',
                value: favorite.opponent || 'Opponent',
                meta: `${favorite.count || 0} games`
            });
        }

        return cards;
    }, [topVictories, winsVsTitled, openings, favoriteOpponents]);

    const shareData = useMemo(() => {
        const perfOrder = ['rapid', 'blitz', 'bullet', 'classical', 'correspondence', 'standard'];
        const ratingParts = (perfStats || [])
            .map((entry) => {
                const value = Number.isFinite(entry.current) ? entry.current : entry.peak;
                return {
                    perf: entry.perf,
                    value: Number.isFinite(value) ? value : null
                };
            })
            .filter((entry) => Number.isFinite(entry.value))
            .sort((a, b) => {
                if (b.value !== a.value) return b.value - a.value;
                const aKey = (a.perf || '').toLowerCase();
                const bKey = (b.perf || '').toLowerCase();
                return perfOrder.indexOf(aKey) - perfOrder.indexOf(bKey);
            })
            .slice(0, 3)
            .map((entry) => `${formatPerfLabel(entry.perf)} ${Math.round(entry.value)}`);

        return {
            name: summary?.heroUser || 'Hero',
            handle: primaryProfile?.usernameLower ? `@${primaryProfile.usernameLower}` : null,
            heroTitle,
            ratingsLine: ratingParts.length ? ratingParts.join(' • ') : 'No rated games yet',
            ratingParts,
            peakRating: summary?.highestRating,
            peakPerf: summary?.highestPerf,
            winRate: summary?.winRate,
            totalGames: summary?.totalGames,
            highlights: shareHighlights,
            theme: themeMode
        };
    }, [summary, perfStats, shareHighlights, primaryProfile, themeMode, heroTitle]);

    const serializeShareSvg = (node) => {
        if (!node) return null;
        const serializer = new XMLSerializer();
        return serializer.serializeToString(node);
    };

    const renderSharePng = async (node) => {
        if (!node) return null;
        if (document?.fonts?.ready) {
            try {
                await document.fonts.ready;
            } catch {
                // ignore
            }
        }
        const width = node.viewBox?.baseVal?.width || Number(node.getAttribute('width')) || 1080;
        const height = node.viewBox?.baseVal?.height || Number(node.getAttribute('height')) || 1920;
        const raw = serializeShareSvg(node);
        if (!raw) return null;
        const svgBlob = new Blob([raw], { type: 'image/svg+xml;charset=utf-8' });
        const url = URL.createObjectURL(svgBlob);
        try {
            const image = await new Promise((resolve, reject) => {
                const img = new Image();
                img.onload = () => resolve(img);
                img.onerror = reject;
                img.src = url;
            });
            const canvas = document.createElement('canvas');
            canvas.width = width;
            canvas.height = height;
            const ctx = canvas.getContext('2d');
            if (!ctx) return null;
            ctx.fillStyle = '#0b1220';
            ctx.fillRect(0, 0, width, height);
            ctx.drawImage(image, 0, 0, width, height);
            return await new Promise((resolve) => canvas.toBlob((blob) => resolve(blob), 'image/png', 0.92));
        } finally {
            URL.revokeObjectURL(url);
        }
    };

    const triggerDownload = (blob, filename) => {
        if (!blob) return;
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
    };

    const handleShareDownload = async () => {
        if (shareBusy) return;
        const node = shareCardRef.current;
        if (!node) return;
        setShareBusy(true);
        setShareMessage('');
        try {
            const png = await renderSharePng(node);
            if (png) {
                triggerDownload(png, `chesslyze-${shareVariant}.png`);
                return;
            }
            const svgRaw = serializeShareSvg(node);
            if (svgRaw) {
                const svgBlob = new Blob([svgRaw], { type: 'image/svg+xml;charset=utf-8' });
                triggerDownload(svgBlob, `chesslyze-${shareVariant}.svg`);
            }
        } catch {
            setShareMessage('Unable to export image in this browser.');
        } finally {
            setShareBusy(false);
        }
    };

    const handleShareSend = async () => {
        if (shareBusy) return;
        const node = shareCardRef.current;
        if (!node) return;
        setShareBusy(true);
        setShareMessage('');
        try {
            const png = await renderSharePng(node);
            if (!png) {
                setShareMessage('Unable to render image for sharing.');
                return;
            }
            const file = new File([png], `chesslyze-${shareVariant}.png`, { type: 'image/png' });
            if (navigator?.canShare && navigator.canShare({ files: [file] }) && navigator.share) {
                await navigator.share({
                    files: [file],
                    title: 'Chess Journey',
                    text: 'My Chesslyze profile'
                });
            } else {
                triggerDownload(png, `chesslyze-${shareVariant}.png`);
                setShareMessage('Download ready. Share it on Instagram.');
            }
        } catch {
            setShareMessage('Sharing cancelled or not supported.');
        } finally {
            setShareBusy(false);
        }
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
                        <p>
                            Timeline is scoped to the selected variant.
                            {ratingStart && ratingEnd
                                ? ` ${formatShortDate(ratingStart.rawDate || ratingStart.date)} → ${formatShortDate(ratingEnd.rawDate || ratingEnd.date)}`
                                : ''}
                        </p>
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
                            {[25, 50, 100, 'all'].map((value) => (
                                <button
                                    key={value}
                                    className={`pill ${ratingZoom === value ? 'pill--active' : ''}`}
                                    onClick={() => setRatingZoom(value)}
                                    title={value === 'all' ? 'Show all games' : `Show last ${value} games`}
                                >
                                    {value === 'all' ? 'All' : `${value}G`}
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
                            <AreaChart data={visibleRatingHistory} margin={{ left: 12, right: 12, top: 8, bottom: 12 }}>
                                <defs>
                                    <linearGradient id="journeyRating" x1="0" y1="0" x2="0" y2="1">
                                        <stop offset="5%" stopColor="#38bdf8" stopOpacity={0.35} />
                                        <stop offset="95%" stopColor="#38bdf8" stopOpacity={0} />
                                    </linearGradient>
                                </defs>
                                <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                                <XAxis
                                    dataKey="gameIndex"
                                    type="number"
                                    scale="linear"
                                    domain={['dataMin', 'dataMax']}
                                    tickFormatter={formatGameIndexTick}
                                    ticks={ratingTickIndices}
                                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                                    tickMargin={8}
                                    tickLine={false}
                                    axisLine={false}
                                    minTickGap={12}
                                />
                                <YAxis
                                    domain={['auto', 'auto']}
                                    tick={{ fill: '#94a3b8', fontSize: 11 }}
                                    tickLine={false}
                                    axisLine={false}
                                    width={40}
                                />
                                <Tooltip content={<RatingTimelineTooltip />} />
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
                    <div className="journey-chart-card">
                        <div className="chart-title">Games Played Over Time</div>
                        {gamesPlayedSeries.length === 0 ? (
                            <div className="timeline-empty">
                                <Activity size={20} />
                                <h3>No games found</h3>
                                <p>Import games to build a timeline.</p>
                            </div>
                        ) : (
                            <ResponsiveContainer width="100%" height={240}>
                                <AreaChart data={gamesPlayedSeries}>
                                    <defs>
                                        <linearGradient id="journeyGames" x1="0" y1="0" x2="0" y2="1">
                                            <stop offset="5%" stopColor="#f59e0b" stopOpacity={0.35} />
                                            <stop offset="95%" stopColor="#f59e0b" stopOpacity={0} />
                                        </linearGradient>
                                    </defs>
                                    <CartesianGrid stroke="rgba(148,163,184,0.15)" vertical={false} />
                                    <XAxis dataKey="date" hide />
                                    <YAxis hide />
                                    <Tooltip
                                        contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc', borderRadius: 12 }}
                                        itemStyle={{ color: '#f59e0b' }}
                                        formatter={(value) => [`${value}`, 'Games']}
                                        labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                                    />
                                    <Area
                                        type="monotone"
                                        dataKey="games"
                                        stroke="#f59e0b"
                                        strokeWidth={2.5}
                                        fillOpacity={1}
                                        fill="url(#journeyGames)"
                                    />
                                </AreaChart>
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
                                <BarChart data={openings} margin={{ bottom: 16 }}>
                                    <CartesianGrid stroke="rgba(148,163,184,0.12)" vertical={false} />
                                    <XAxis
                                        dataKey="name"
                                        tick={{ fill: '#94a3b8', fontSize: 10, angle: -35, textAnchor: 'end' }}
                                        height={60}
                                        interval="preserveStartEnd"
                                        minTickGap={8}
                                        tickMargin={8}
                                        tickFormatter={formatOpeningTick}
                                    />
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
                                <Tooltip content={<OpeningEvolutionTooltip />} />
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
                    {topVictories.length > 0 && (
                        <div className="journey-list-card">
                            <div className="chart-title">Top Rated Victories</div>
                            <div className={`list-rows ${topVictories.length < 5 ? 'list-rows--spaced' : ''}`}>
                                {topVictories.map((g) => (
                                    <button key={g.id} type="button" className="list-row list-row--link" onClick={() => openGame(g.id)}>
                                        <div>
                                            <div className="list-title">{g.opponent}</div>
                                            <div className="list-meta">{g.perf} • {new Date(g.date).toLocaleDateString()}</div>
                                        </div>
                                        <div className="list-value">{g.oppRating}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {topAccurateGames.length > 0 && (
                        <div className="journey-list-card">
                            <div className="chart-title">Top Accurate Games</div>
                            <div className={`list-rows ${topAccurateGames.length < 5 ? 'list-rows--spaced' : ''}`}>
                                {topAccurateGames.map((g) => (
                                    <button key={g.id} type="button" className="list-row list-row--link" onClick={() => openGame(g.id)}>
                                        <div>
                                            <div className="list-title">{g.opponent}</div>
                                            <div className="list-meta">{g.perf} • {new Date(g.date).toLocaleDateString()}</div>
                                        </div>
                                        <div className="list-value">{g.accuracy}%</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {mostBrilliantGames.length > 0 && (
                        <div className="journey-list-card">
                            <div className="chart-title">Most Brilliant Games</div>
                            <div className={`list-rows ${mostBrilliantGames.length < 5 ? 'list-rows--spaced' : ''}`}>
                                {mostBrilliantGames.map((g) => (
                                    <button key={g.id} type="button" className="list-row list-row--link" onClick={() => openGame(g.id)}>
                                        <div>
                                            <div className="list-title">{g.opponent}</div>
                                            <div className="list-meta">
                                                Brilliant {g.brilliant} • Great {g.great} • {g.perf} • {new Date(g.date).toLocaleDateString()}
                                            </div>
                                        </div>
                                        <div className="list-value">{g.total}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {favoriteOpponents.length > 0 && (
                        <div className="journey-list-card">
                            <div className="chart-title">Favorite Opponents</div>
                            <div className={`list-rows ${favoriteOpponents.length < 5 ? 'list-rows--spaced' : ''}`}>
                                {favoriteOpponents.map((g) => (
                                    <button key={g.opponent} type="button" className="list-row list-row--link" onClick={() => openGame(g.id)}>
                                        <div>
                                            <div className="list-title">{g.opponent}</div>
                                            <div className="list-meta">
                                                {g.perf} • {g.date ? new Date(g.date).toLocaleDateString() : 'Unknown date'}
                                            </div>
                                        </div>
                                        <div className="list-value">{g.count}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {winsVsTitled.length > 0 && (
                        <div className="journey-list-card">
                            <div className="chart-title">Wins vs Titled Players</div>
                            <div className={`list-rows ${winsVsTitled.length < 5 ? 'list-rows--spaced' : ''}`}>
                                {winsVsTitled.map((g) => (
                                    <button key={g.id} type="button" className="list-row list-row--link" onClick={() => openGame(g.id)}>
                                        <div>
                                            <div className={`list-title ${g.opponentTitle ? 'list-title--titled' : ''}`}>
                                                {g.opponentTitle && <span className="journey-title-badge">{g.opponentTitle}</span>}
                                                <span>{g.opponent}</span>
                                            </div>
                                            <div className="list-meta">{g.perf} • {new Date(g.date).toLocaleDateString()}</div>
                                        </div>
                                        <div className="list-value">{g.oppRating || '-'}</div>
                                    </button>
                                ))}
                            </div>
                        </div>
                    )}
                    {(winsVsTitled.length === 0
                        && topVictories.length === 0
                        && topAccurateGames.length === 0
                        && mostBrilliantGames.length === 0
                        && favoriteOpponents.length === 0) && (
                            <div className="list-empty">No highlights yet. Analyze or import more games.</div>
                        )}
                </div>
            </section>

            <footer className="journey-footer">
                <div>Generated by Chesslyze</div>
                <div>Your journey continues with every move.</div>
            </footer>

            {shareOpen && (
                <div
                    className="journey-share-modal"
                    role="dialog"
                    aria-modal="true"
                    onClick={(e) => {
                        if (e.target === e.currentTarget) setShareOpen(false);
                    }}
                >
                    <div className="journey-share-dialog">
                        <div className="journey-share-header">
                            <div>
                                <div className="journey-share-title">Share your Chess Journey</div>
                                <div className="journey-share-subtitle">Choose a format and export</div>
                            </div>
                            <button className="btn-icon" type="button" onClick={() => setShareOpen(false)} aria-label="Close">
                                <X size={18} />
                            </button>
                        </div>
                        <div className="journey-share-preview">
                            <JourneyShareCard ref={shareCardRef} variant={shareVariant} data={shareData} />
                        </div>
                        <div className="journey-share-controls">
                            <div className="journey-share-toggle">
                                <button
                                    type="button"
                                    className={`share-toggle ${shareVariant === 'story' ? 'is-active' : ''}`}
                                    onClick={() => setShareVariant('story')}
                                >
                                    Story 1080x1920
                                </button>
                                <button
                                    type="button"
                                    className={`share-toggle ${shareVariant === 'post' ? 'is-active' : ''}`}
                                    onClick={() => setShareVariant('post')}
                                >
                                    Post 1080x1350
                                </button>
                            </div>
                            <div className="journey-share-actions">
                                <button className="btn-chip" type="button" onClick={handleShareDownload} disabled={shareBusy}>
                                    <Download size={16} />
                                    {shareBusy ? 'Preparing...' : 'Download'}
                                </button>
                                <button className="btn-primary" type="button" onClick={handleShareSend} disabled={shareBusy}>
                                    <Share2 size={16} />
                                    Share
                                </button>
                            </div>
                            {shareMessage && <div className="journey-share-message">{shareMessage}</div>}
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
