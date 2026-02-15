import React, { useEffect, useMemo, useState } from 'react';
import { useLiveQuery } from 'dexie-react-hooks';
import { db } from '../../services/db';
import { engine } from '../../services/engine';
import { AlertCircle, CheckCircle } from 'lucide-react';
import { ConfirmModal } from '../common/ConfirmModal';
import { useHeroProfiles } from '../../hooks/useHeroProfiles';
import { getHeroDisplayName, isHeroGameForProfiles } from '../../services/heroProfiles';

const ENGINE_PROFILES_KEY = 'engineProfiles';
const ENGINE_ACTIVE_KEY = 'activeEngineProfileId';
const BOARD_LIGHT_KEY = 'boardLightSquare';
const BOARD_DARK_KEY = 'boardDarkSquare';
const BOARD_FLASH_WHITE_KEY = 'boardFlashWhite';
const BOARD_FLASH_BLACK_KEY = 'boardFlashBlack';
const DEFAULT_BOARD_LIGHT = '#e2e8f0';
const DEFAULT_BOARD_DARK = '#475569';
const DEFAULT_FLASH_WHITE = '#D9C64A';
const DEFAULT_FLASH_BLACK = '#D9C64A';

const clampInt = (value, min, max, fallback) => {
    const parsed = parseInt(value, 10);
    if (Number.isNaN(parsed)) return fallback;
    return Math.min(max, Math.max(min, parsed));
};

const buildLegacyProfile = () => {
    const depth = clampInt(localStorage.getItem('engineDepth') || '15', 8, 60, 15);
    const multiPv = clampInt(localStorage.getItem('engineMultiPv') || '3', 1, 5, 3);
    const deepDepth = clampInt(localStorage.getItem('engineDeepDepth') || '0', 0, 60, 0);
    const hash = clampInt(localStorage.getItem('engineHash') || '32', 16, 32, 32);
    const threads = clampInt(localStorage.getItem('engineThreads') || '1', 1, 16, 1);
    const stored = localStorage.getItem('engineUseNNUE');
    const useNNUE = stored === null ? true : stored === 'true';
    const preset = localStorage.getItem('enginePreset') || 'custom';

    return {
        id: 'stockfish-default',
        name: 'Stockfish Default',
        type: 'stockfish',
        preset,
        depth,
        multiPv,
        deepDepth,
        hash,
        threads,
        useNNUE
    };
};

const normalizeProfile = (profile, fallbackId) => {
    const safe = profile && typeof profile === 'object' ? profile : {};
    return {
        id: String(safe.id || fallbackId),
        name: String(safe.name || 'Engine Profile'),
        type: safe.type || 'stockfish',
        preset: safe.preset || 'custom',
        depth: clampInt(safe.depth ?? 15, 8, 60, 15),
        multiPv: clampInt(safe.multiPv ?? 3, 1, 5, 3),
        deepDepth: clampInt(safe.deepDepth ?? 0, 0, 60, 0),
        hash: clampInt(safe.hash ?? 32, 16, 2048, 32), // Allow up to 2048MB
        threads: clampInt(safe.threads ?? 1, 1, 128, 1), // Allow more threads (clamped by UI later)
        timePerMove: clampInt(safe.timePerMove ?? 0, 0, 60000, 0), // 0 = off, max 60s
        useNNUE: typeof safe.useNNUE === 'boolean' ? safe.useNNUE : true,
        version: safe.version || '17.1-single'
    };
};

const getInitialEngineState = () => {
    let profiles = [];
    try {
        const raw = localStorage.getItem(ENGINE_PROFILES_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) {
                profiles = parsed.map((p, idx) => normalizeProfile(p, `stockfish-${idx + 1}`));
            }
        }
    } catch {
        profiles = [];
    }

    if (!profiles.length) {
        profiles = [buildLegacyProfile()];
    }

    let activeId = localStorage.getItem(ENGINE_ACTIVE_KEY);
    if (!activeId || !profiles.find((p) => p.id === activeId)) {
        activeId = profiles[0].id;
    }

    return { profiles, activeId };
};

export const Settings = () => {
    const { profiles: heroProfiles, activeProfiles, filterIds, setFilterIds } = useHeroProfiles();
    const heroLabel = useMemo(() => getHeroDisplayName(activeProfiles), [activeProfiles]);
    const [status, setStatus] = useState(null);
    const [engineInfo, setEngineInfo] = useState(() => engine.getInfo());
    const [boardLight, setBoardLight] = useState(() => localStorage.getItem(BOARD_LIGHT_KEY) || DEFAULT_BOARD_LIGHT);
    const [boardDark, setBoardDark] = useState(() => localStorage.getItem(BOARD_DARK_KEY) || DEFAULT_BOARD_DARK);
    const [flashWhite, setFlashWhite] = useState(() => localStorage.getItem(BOARD_FLASH_WHITE_KEY) || DEFAULT_FLASH_WHITE);
    const [flashBlack, setFlashBlack] = useState(() => localStorage.getItem(BOARD_FLASH_BLACK_KEY) || DEFAULT_FLASH_BLACK);
    const initialEngineState = useMemo(() => getInitialEngineState(), []);
    const [profiles, setProfiles] = useState(initialEngineState.profiles);
    const [activeProfileId, setActiveProfileId] = useState(initialEngineState.activeId);
    const [newProfileName, setNewProfileName] = useState('');
    const [confirmAnalyzeAllOpen, setConfirmAnalyzeAllOpen] = useState(false);
    const [confirmStopOpen, setConfirmStopOpen] = useState(false);
    const [confirmDeleteProfileOpen, setConfirmDeleteProfileOpen] = useState(false);

    // Get system thread count
    const maxThreads = typeof navigator !== 'undefined' ? (navigator.hardwareConcurrency || 16) : 16;

    const activeProfile = useMemo(() => {
        if (!profiles.length) return null;
        return profiles.find((p) => p.id === activeProfileId) || profiles[0];
    }, [profiles, activeProfileId]);

    const depth = activeProfile?.depth ?? 15;
    const multiPv = activeProfile?.multiPv ?? 3;
    const preset = activeProfile?.preset ?? 'custom';
    const deepDepth = activeProfile?.deepDepth ?? 0;
    const hash = activeProfile?.hash ?? 32;
    const threads = activeProfile?.threads ?? 1;
    const timePerMove = activeProfile?.timePerMove ?? 0;
    const useNNUE = activeProfile?.useNNUE ?? true;

    const games = useLiveQuery(async () => {
        return await db.games.toArray();
    }, []);

    useEffect(() => {
        // Ensure worker initialized so we can read id name / caps.
        // Use the active profile's version if available, or default to 17.1-single
        const version = activeProfile?.version || '17.1-single';
        engine.init(version).then(() => setEngineInfo(engine.getInfo())).catch(() => { });

        const t = setTimeout(() => setEngineInfo(engine.getInfo()), 400);

        return () => clearTimeout(t);
    }, [activeProfile?.version]); // Re-run if version setting changes (though profiles change usually triggers re-render)

    useEffect(() => {
        if (!profiles.length) return;
        if (!profiles.find((p) => p.id === activeProfileId)) {
            setActiveProfileId(profiles[0].id);
        }
    }, [profiles, activeProfileId]);

    useEffect(() => {
        try {
            localStorage.setItem(ENGINE_PROFILES_KEY, JSON.stringify(profiles));
            localStorage.setItem(ENGINE_ACTIVE_KEY, activeProfileId);
        } catch {
            // Ignore persistence failures
        }
    }, [profiles, activeProfileId]);

    useEffect(() => {
        try {
            localStorage.setItem(BOARD_LIGHT_KEY, boardLight);
            localStorage.setItem(BOARD_DARK_KEY, boardDark);
            localStorage.setItem(BOARD_FLASH_WHITE_KEY, flashWhite);
            localStorage.setItem(BOARD_FLASH_BLACK_KEY, flashBlack);
            window.dispatchEvent(new Event('boardColorsChanged'));
        } catch {
            // Ignore persistence failures
        }
    }, [boardLight, boardDark, flashWhite, flashBlack]);

    useEffect(() => {
        if (!activeProfile) return;
        try {
            localStorage.setItem('engineDepth', String(depth));
            localStorage.setItem('engineMultiPv', String(multiPv));
            localStorage.setItem('engineDeepDepth', String(deepDepth));
            localStorage.setItem('engineHash', String(hash));
            localStorage.setItem('engineThreads', String(threads));
            localStorage.setItem('engineTimePerMove', String(timePerMove));
            localStorage.setItem('engineUseNNUE', String(useNNUE));
            localStorage.setItem('enginePreset', String(preset));
        } catch {
            // Ignore persistence failures
        }
    }, [activeProfile, depth, multiPv, deepDepth, hash, threads, useNNUE, preset]);

    // Sync options
    // Sync options with debounce
    const isFirstRun = React.useRef(true);
    useEffect(() => {
        if (isFirstRun.current) {
            isFirstRun.current = false;
            return;
        }

        const t = setTimeout(() => {
            engine.setOptions([
                { name: 'Hash', value: hash },
                { name: 'Threads', value: threads },
                { name: 'Use NNUE', value: useNNUE },
            ]);
        }, 500); // 500ms debounce
        return () => clearTimeout(t);
    }, [hash, threads, useNNUE]);

    const stats = useMemo(() => {
        if (!games) return { total: 0, heroTotal: 0, analyzed: 0, pending: 0, ignored: 0 };
        let heroTotal = 0;
        let analyzed = 0;
        let pending = 0;
        let ignored = 0;
        let analyzing = 0;
        let failed = 0;
        games.forEach((g) => {
            const isHero = isHeroGameForProfiles(g, activeProfiles);
            if (isHero) heroTotal += 1;

            if (g.analysisStatus === 'analyzing') {
                analyzing += 1;
            } else if (g.analysisStatus === 'failed') {
                failed += 1;
            } else if (g.analysisStatus === 'ignored') {
                ignored += 1;
            } else if (g.analysisStatus === 'completed' || (g.analyzed && g.analysisStatus !== 'failed')) {
                // Completed or Legacy Analyzed (excluding failed)
                analyzed += 1;
            } else if (g.analysisStatus === 'pending') {
                // Explicitly pending
                pending += 1;
            } else {
                // No status = Idle
                // We track this as part of "pending" in the summary object if we want generic "unanalyzed", 
                // but let's separate them if we want to show distinct stats.
                // For now, let's keep the return object simple or add 'idle'.
                // The user wants to differentiate.
            }
        });

        // Recalculate generic "idle" as total - (analyzed + pending + analyzing + failed + ignored)
        // Or just count them explicitly:
        const idle = games.length - (analyzed + pending + analyzing + failed + ignored);

        return { total: games.length, heroTotal, analyzed, pending, ignored, analyzing, failed, idle };
    }, [games, activeProfiles]);

    const analyzeAllCount = useMemo(() => {
        if (!games) return 0;
        let count = 0;
        games.forEach((g) => {
            const isHero = isHeroGameForProfiles(g, activeProfiles);
            const needsAnalysis = !g.analyzed || g.analysisStatus === 'failed';
            if (isHero && needsAnalysis) count += 1;
        });
        return count;
    }, [games, activeProfiles]);

    const handleAnalyzeAll = async () => {
        if (!games) return;
        setStatus({ type: 'loading', message: 'Queueing analysis for unanalyzed games...' });
        try {
            // Only target games that are NOT analyzed OR have failed
            const targetGames = await db.games
                .filter((g) => {
                    const isHero = isHeroGameForProfiles(g, activeProfiles);
                    const needsAnalysis = !g.analyzed || g.analysisStatus === 'failed';
                    return isHero && needsAnalysis;
                })
                .modify({
                    analysisStatus: 'pending',
                    priority: 1 // Low priority for bulk analysis
                });

            setStatus({ type: 'success', message: `Queued ${targetGames} games for analysis.` });
        } catch (err) {
            console.error(err);
            setStatus({ type: 'error', message: 'Failed to queue analysis.' });
        }
    };

    const handleStopAnalysis = async () => {
        setStatus({ type: 'loading', message: 'Stopping analysis...' });
        try {
            engine.stop();
            engine.terminate();

            // 1. Valid pending games in the queue revert to IDLE (so they can be re-queued later)
            // We strip the analysisStatus entirely to make them "idle"
            await db.games.where('analysisStatus').equals('pending').modify({
                analysisStatus: null, // This makes them 'idle' based on our filters
                analysisStartedAt: null,
                analysisHeartbeatAt: null
            });

            // 2. The game currently being analyzed is marked as FAILED (interrupted)
            await db.games.where('analysisStatus').equals('analyzing').modify({
                analysisStatus: 'failed',
                analyzed: true, // It did run, but failed.
                analysisStartedAt: null,
                analysisHeartbeatAt: null
            });

            setStatus({ type: 'success', message: 'Analysis stopped. Current game failed, queue reset to idle.' });
        } catch (err) {
            console.error(err);
            setStatus({ type: 'error', message: 'Failed to stop analysis.' });
        }
    };

    const updateActiveProfile = (patch) => {
        if (!activeProfile) return;
        setProfiles((prev) => prev.map((p) => (p.id === activeProfileId ? { ...p, ...patch } : p)));
    };

    const canDeleteProfile = profiles.length > 1;
    const handleDeleteProfile = () => {
        if (!activeProfile || !canDeleteProfile) return;
        const remaining = profiles.filter((p) => p.id !== activeProfileId);
        if (!remaining.length) return;
        setProfiles(remaining);
        setActiveProfileId(remaining[0].id);
    };

    const handleDepthChange = (value) => {
        updateActiveProfile({ depth: value, preset: 'custom' });
    };

    const handleMultiPvChange = (value) => {
        updateActiveProfile({ multiPv: value, preset: 'custom' });
    };

    const handleDeepDepthChange = (value) => {
        updateActiveProfile({ deepDepth: value });
    };

    const handleHashChange = (value) => {
        const v = Math.min(2048, Math.max(16, value));
        updateActiveProfile({ hash: v });
    };

    const handleThreadsChange = (value) => {
        const v = Math.max(1, Math.min(maxThreads, value));
        updateActiveProfile({ threads: v });
    };

    const handleTimePerMoveChange = (value) => {
        const v = Math.min(60000, Math.max(0, value));
        updateActiveProfile({ timePerMove: v });
    };

    const handleNNUEChange = (enabled) => {
        updateActiveProfile({ useNNUE: enabled });
    };

    const handlePresetChange = (value) => {
        const presets = {
            fast: { depth: 10, multiPv: 1 },
            balanced: { depth: 14, multiPv: 2 },
            deep: { depth: 20, multiPv: 3 }
        };
        if (value === 'custom') {
            updateActiveProfile({ preset: 'custom' });
            return;
        }
        const next = presets[value];
        if (!next) return;
        updateActiveProfile({ preset: value, depth: next.depth, multiPv: next.multiPv });
    };

    const handleAddProfile = () => {
        if (!activeProfile) return;
        const trimmed = newProfileName.trim();
        const name = trimmed || `Profile ${profiles.length + 1}`;
        const id = `engine-${Date.now()}`;
        const next = { ...activeProfile, id, name, preset: 'custom' };
        setProfiles((prev) => [...prev, next]);
        setActiveProfileId(id);
        setNewProfileName('');
    };

    const toggleProfileFilter = (id) => {
        if (!id) return;
        if (!filterIds.length) {
            setFilterIds([id]);
            return;
        }
        if (filterIds.includes(id)) {
            const next = filterIds.filter((pid) => pid !== id);
            setFilterIds(next);
            return;
        }
        setFilterIds([...filterIds, id]);
    };

    const clearProfileFilter = () => setFilterIds([]);

    return (
        <div className="settings-page h-full w-full bg-app p-4 md:p-8 overflow-y-auto">
            <div className="flex flex-col gap-6" style={{ maxWidth: 900, margin: '0 auto' }}>
                <div className="flex items-center justify-between">
                    <div>
                        <h2 className="text-2xl font-semibold text-primary">Settings</h2>
                        <p className="text-secondary">Manage analysis runs and local data.</p>
                    </div>
                    <div className="text-s text-muted">Hero: {heroLabel || 'Not set'}</div>
                </div>

                <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Total Games</div>
                        <div className="text-2xl font-bold text-primary">{stats.total}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Hero Games</div>
                        <div className="text-2xl font-bold text-primary">{stats.heroTotal}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Analyzed</div>
                        <div className="text-2xl font-bold text-green-400">{stats.analyzed}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Pending</div>
                        <div className="text-2xl font-bold text-orange-400">{stats.pending}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Idle</div>
                        <div className="text-2xl font-bold text-secondary">{stats.idle}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Analyzing</div>
                        <div className="text-2xl font-bold text-blue-400">{stats.analyzing}</div>
                    </div>
                    <div className="p-4 rounded-lg border bg-panel text-center">
                        <div className="text-xs text-muted uppercase tracking-wider mb-1">Failed</div>
                        <div className="text-2xl font-bold text-rose-400">{stats.failed}</div>
                    </div>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Hero Profiles</h3>
                    <p className="text-sm text-secondary mb-4">
                        Choose which profiles power your hero analytics. Leave it on “All Profiles” for a unified view.
                    </p>
                    {heroProfiles.length === 0 ? (
                        <div className="text-xs text-muted">Connect a Lichess or Chess.com account to add hero profiles.</div>
                    ) : (
                        <div className="flex flex-wrap gap-2">
                            <button
                                type="button"
                                className={`pill ${filterIds.length === 0 ? 'pill--active' : ''}`}
                                onClick={clearProfileFilter}
                            >
                                All Profiles
                            </button>
                            {heroProfiles.map((profile) => {
                                const active = filterIds.includes(profile.id);
                                const label = `${profile.platform === 'chesscom' ? 'Chess.com' : 'Lichess'} · ${profile.displayName || profile.usernameLower}`;
                                return (
                                    <button
                                        key={profile.id}
                                        type="button"
                                        className={`pill ${active ? 'pill--active' : ''}`}
                                        onClick={() => toggleProfileFilter(profile.id)}
                                    >
                                        {label}
                                    </button>
                                );
                            })}
                        </div>
                    )}
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Analyze All Games</h3>
                    <p className="text-sm text-secondary mb-4">
                        Queue analysis for all games that haven't been analyzed yet. Already analyzed games will be skipped.
                    </p>
                    <button className="btn btn-primary" onClick={() => setConfirmAnalyzeAllOpen(true)} disabled={analyzeAllCount === 0}>
                        Analyze All (Unanalyzed)
                    </button>

                    {status && (
                        <div className="mt-4 flex items-center gap-2 text-sm">
                            {status.type === 'success' && <CheckCircle size={16} className="text-green-400" />}
                            {status.type === 'error' && <AlertCircle size={16} className="text-red-400" />}
                            <span className="text-secondary">{status.message}</span>
                        </div>
                    )}
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Stop Analysis</h3>
                    <p className="text-sm text-secondary mb-4">
                        Halts the engine and clears any queued games. Already running analysis may finish its current move.
                    </p>
                    <button className="btn btn-secondary" onClick={() => setConfirmStopOpen(true)}>
                        Stop Analysis
                    </button>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Board Colors</h3>
                    <p className="text-sm text-secondary mb-4">
                        Customize light and dark square colors for the dashboard board.
                    </p>
                    <div className="board-color-grid">
                        <div className="board-color-controls">
                            <div className="board-color-card">
                                <label className="text-xs text-muted uppercase tracking-wider">Light Square</label>
                                <div className="board-color-row">
                                    <input
                                        type="color"
                                        value={boardLight}
                                        onChange={(e) => setBoardLight(e.target.value)}
                                        className="color-input"
                                    />
                                    <span className="text-sm text-primary">{boardLight.toUpperCase()}</span>
                                </div>
                            </div>
                            <div className="board-color-card">
                                <label className="text-xs text-muted uppercase tracking-wider">Dark Square</label>
                                <div className="board-color-row">
                                    <input
                                        type="color"
                                        value={boardDark}
                                        onChange={(e) => setBoardDark(e.target.value)}
                                        className="color-input"
                                    />
                                    <span className="text-sm text-primary">{boardDark.toUpperCase()}</span>
                                </div>
                            </div>
                            <div className="board-color-card">
                                <label className="text-xs text-muted uppercase tracking-wider">White Move Flash</label>
                                <div className="board-color-row">
                                    <input
                                        type="color"
                                        value={flashWhite}
                                        onChange={(e) => setFlashWhite(e.target.value)}
                                        className="color-input"
                                    />
                                    <span className="text-sm text-primary">{flashWhite.toUpperCase()}</span>
                                </div>
                            </div>
                            <div className="board-color-card">
                                <label className="text-xs text-muted uppercase tracking-wider">Black Move Flash</label>
                                <div className="board-color-row">
                                    <input
                                        type="color"
                                        value={flashBlack}
                                        onChange={(e) => setFlashBlack(e.target.value)}
                                        className="color-input"
                                    />
                                    <span className="text-sm text-primary">{flashBlack.toUpperCase()}</span>
                                </div>
                            </div>
                        </div>
                        <div className="board-preview board-preview--large">
                            {Array.from({ length: 16 }).map((_, idx) => {
                                const isLight = (Math.floor(idx / 4) + (idx % 4)) % 2 === 0;
                                return (
                                    <div
                                        key={idx}
                                        className="board-preview__cell"
                                        style={{ background: isLight ? boardLight : boardDark }}
                                    />
                                );
                            })}
                        </div>
                    </div>
                    <div className="mt-4 flex items-center gap-3">
                        <button
                            className="btn btn-secondary"
                            onClick={() => {
                                setBoardLight(DEFAULT_BOARD_LIGHT);
                                setBoardDark(DEFAULT_BOARD_DARK);
                                setFlashWhite(DEFAULT_FLASH_WHITE);
                                setFlashBlack(DEFAULT_FLASH_BLACK);
                            }}
                        >
                            Reset to Default
                        </button>
                        <div className="text-xs text-muted">Applies immediately to the dashboard board.</div>
                    </div>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Engine Profiles</h3>
                    <p className="text-sm text-secondary mb-4">
                        Group engine settings by profile so you can switch between fast and deep analysis modes.
                    </p>
                    <div className="text-xs text-muted mb-4">
                        Engine: {engineInfo?.name || 'Unknown'} • NNUE: {engineInfo?.caps?.nnue ? 'Yes' : 'No'} • MultiPV: {engineInfo?.caps?.multipv ? 'Yes' : 'No'}
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                        <div>
                            <label className="text-xs text-muted uppercase tracking-wider">Engine Version</label>
                            <select
                                value={activeProfile?.version || '17.1-single'}
                                onChange={(e) => updateActiveProfile({ version: e.target.value })}
                                className="bg-subtle border rounded px-3 py-2 text-sm text-primary w-full mt-2"
                            >
                                <option value="17.1-single">Stockfish 17.1 (Standard, Single-Thread)</option>
                                <option value="17.1-multi">Stockfish 17.1 (High Perf, Multi-Thread)</option>
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-muted uppercase tracking-wider">Active Profile</label>
                            <select
                                value={activeProfileId}
                                onChange={(e) => setActiveProfileId(e.target.value)}
                                className="bg-subtle border rounded px-3 py-2 text-sm text-primary w-full mt-2"
                            >
                                {profiles.map((profile) => (
                                    <option key={profile.id} value={profile.id}>
                                        {profile.name}
                                    </option>
                                ))}
                            </select>
                        </div>
                        <div>
                            <label className="text-xs text-muted uppercase tracking-wider">Profile Name</label>
                            <input
                                value={activeProfile?.name || ''}
                                onChange={(e) => updateActiveProfile({ name: e.target.value })}
                                className="bg-subtle border rounded px-3 py-2 text-sm text-primary w-full mt-2"
                                placeholder="e.g. Deep Analysis"
                            />
                        </div>
                        <div>
                            <label className="text-xs text-muted uppercase tracking-wider">New Profile</label>
                            <div className="flex items-center gap-2 mt-2">
                                <input
                                    value={newProfileName}
                                    onChange={(e) => setNewProfileName(e.target.value)}
                                    className="bg-subtle border rounded px-3 py-2 text-sm text-primary w-full"
                                    placeholder="Profile name"
                                />
                                <button className="btn btn-secondary" onClick={handleAddProfile}>
                                    Add
                                </button>
                            </div>
                        </div>
                        <div>
                            <label className="text-xs text-muted uppercase tracking-wider">Delete Profile</label>
                            <div className="flex items-center gap-2 mt-2">
                                <button
                                    className="btn-danger"
                                    onClick={() => setConfirmDeleteProfileOpen(true)}
                                    disabled={!canDeleteProfile}
                                >
                                    Delete Active
                                </button>
                                {!canDeleteProfile && (
                                    <span className="text-xs text-muted">Keep at least one profile.</span>
                                )}
                            </div>
                        </div>
                    </div>

                    <div className="flex items-center gap-3 mt-4">
                        <select
                            value={preset}
                            onChange={(e) => handlePresetChange(e.target.value)}
                            className="bg-subtle border rounded px-3 py-2 text-sm text-primary"
                        >
                            <option value="fast">Fast</option>
                            <option value="balanced">Balanced</option>
                            <option value="deep">Deep</option>
                            <option value="custom">Custom</option>
                        </select>
                        <div className="text-xs text-muted">Applies to new analysis runs for {activeProfile?.name || 'this profile'}.</div>
                    </div>
                </div>

                <div className="p-6 rounded-lg border bg-panel">
                    <h3 className="text-sm font-semibold text-primary mb-3">Active Engine Settings</h3>
                    <p className="text-sm text-secondary mb-4">
                        Tuning for <span className="text-primary font-medium">{activeProfile?.name || 'Active Profile'}</span>.
                    </p>

                    <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
                        <div className="rounded-lg border border-white/5 bg-subtle/40 p-4">
                            <h4 className="text-sm font-semibold text-primary mb-2">Performance Tuning</h4>
                            <p className="text-xs text-secondary mb-4">
                                Optimize engine performance for your device.
                            </p>
                            <div className="grid grid-cols-1 gap-4">
                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-medium text-primary">Hash Size (MB)</label>
                                        <span className="text-xs text-muted">{hash} MB</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="16"
                                        max="2048"
                                        step="16"
                                        value={hash}
                                        onChange={(e) => handleHashChange(parseInt(e.target.value, 10))}
                                        className="w-full"
                                    />
                                    <p className="text-xs text-muted mt-1">Higher hash helps at high depths. Max 2048MB.</p>
                                </div>

                                <div>
                                    <div className="flex items-center justify-between mb-2">
                                        <label className="text-sm font-medium text-primary">Threads</label>
                                        <span className="text-xs text-muted">{threads} Core{threads !== 1 ? 's' : ''}</span>
                                    </div>
                                    <input
                                        type="range"
                                        min="1"
                                        max={maxThreads}
                                        step="1"
                                        value={threads}
                                        onChange={(e) => handleThreadsChange(parseInt(e.target.value, 10))}
                                        className="w-full"
                                    />
                                    <p className="text-xs text-muted mt-1">More threads = faster analysis. Don't exceed your CPU core count.</p>
                                </div>

                                <div className="flex items-center gap-3">
                                    <input
                                        type="checkbox"
                                        id="nnue-toggle"
                                        checked={useNNUE}
                                        onChange={(e) => handleNNUEChange(e.target.checked)}
                                        className="w-4 h-4"
                                    />
                                    <label htmlFor="nnue-toggle" className="text-sm font-medium text-primary cursor-pointer select-none">
                                        Enable NNUE (Neural Net)
                                    </label>
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-white/5 bg-subtle/40 p-4">
                            <h4 className="text-sm font-semibold text-primary mb-2">Time Per Move</h4>
                            <p className="text-xs text-secondary mb-4">
                                Limit analysis time per move. Engine stops at depth OR time, whichever comes first.
                            </p>
                            <div className="flex items-center gap-4">
                                <input
                                    type="range"
                                    min="0"
                                    max="10000"
                                    step="100"
                                    value={timePerMove}
                                    onChange={(e) => handleTimePerMoveChange(parseInt(e.target.value, 10))}
                                />
                                <div className="text-sm text-primary">
                                    {timePerMove === 0 ? 'Off (Depth only)' : `${(timePerMove / 1000).toFixed(1)}s`}
                                </div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-white/5 bg-subtle/40 p-4">
                            <h4 className="text-sm font-semibold text-primary mb-2">Engine Depth</h4>
                            <p className="text-xs text-secondary mb-4">
                                Higher depth improves accuracy but is slower. Depth 50+ is expensive in WASM; consider using MultiPV first.
                            </p>
                            <div className="flex items-center gap-4">
                                <input
                                    type="range"
                                    min="8"
                                    max="60"
                                    value={depth}
                                    onChange={(e) => handleDepthChange(parseInt(e.target.value, 10))}
                                />
                                <div className="text-sm text-primary">Depth {depth}</div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-white/5 bg-subtle/40 p-4">
                            <h4 className="text-sm font-semibold text-primary mb-2">Top Lines (MultiPV)</h4>
                            <p className="text-xs text-secondary mb-4">
                                Show more than one best line. This also helps avoid false "opening mistakes" by considering multiple strong candidates.
                            </p>
                            <div className="flex items-center gap-4">
                                <input
                                    type="range"
                                    min="1"
                                    max="5"
                                    value={multiPv}
                                    onChange={(e) => handleMultiPvChange(parseInt(e.target.value, 10))}
                                />
                                <div className="text-sm text-primary">{multiPv} line{multiPv === 1 ? '' : 's'}</div>
                            </div>
                        </div>

                        <div className="rounded-lg border border-white/5 bg-subtle/40 p-4">
                            <h4 className="text-sm font-semibold text-primary mb-2">Deep Verification Depth</h4>
                            <p className="text-xs text-secondary mb-4">
                                Optional second-pass depth used only to re-check moves the engine flags as blunders.
                                This reduces false positives without analyzing every move at depth 50+.
                            </p>
                            <div className="flex items-center gap-4">
                                <input
                                    type="range"
                                    min="0"
                                    max="60"
                                    value={deepDepth}
                                    onChange={(e) => handleDeepDepthChange(parseInt(e.target.value, 10))}
                                />
                                <div className="text-sm text-primary">{deepDepth === 0 ? 'Off' : `Depth ${deepDepth}`}</div>
                            </div>
                        </div>
                    </div>
                </div>

            </div>

            <ConfirmModal
                open={confirmAnalyzeAllOpen}
                title="Analyze all unanalyzed games?"
                description="This will queue analysis for all eligible games in your library."
                meta={analyzeAllCount ? `${analyzeAllCount} games will be queued.` : null}
                confirmText="Queue Analysis"
                cancelText="Cancel"
                onCancel={() => setConfirmAnalyzeAllOpen(false)}
                onConfirm={async () => {
                    setConfirmAnalyzeAllOpen(false);
                    await handleAnalyzeAll();
                }}
            />
            <ConfirmModal
                open={confirmStopOpen}
                title="Stop current analysis?"
                description="This will halt the engine and reset queued games back to idle. The currently running game will be marked failed."
                confirmText="Stop Analysis"
                cancelText="Cancel"
                onCancel={() => setConfirmStopOpen(false)}
                onConfirm={async () => {
                    setConfirmStopOpen(false);
                    await handleStopAnalysis();
                }}
            />
            <ConfirmModal
                open={confirmDeleteProfileOpen}
                title={`Delete ${activeProfile?.name || 'this profile'}?`}
                description="This removes the profile and its saved settings. This can't be undone."
                confirmText="Delete Profile"
                cancelText="Cancel"
                confirmClassName="btn-danger"
                confirmDisabled={!canDeleteProfile}
                onCancel={() => setConfirmDeleteProfileOpen(false)}
                onConfirm={() => {
                    setConfirmDeleteProfileOpen(false);
                    handleDeleteProfile();
                }}
            />
        </div>
    );
};
