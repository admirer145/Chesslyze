import { db } from './db';

const HERO_PROFILE_FILTER_KEY = 'heroProfileFilterIds';
const HERO_PROFILE_FILTER_EVENT = 'hero-profile-filter-changed';

export const normalizeUsername = (value) => (value || '').toString().trim().toLowerCase();

export const getHeroProfileFilterIds = () => {
    if (typeof window === 'undefined') return [];
    try {
        const raw = localStorage.getItem(HERO_PROFILE_FILTER_KEY);
        if (!raw) return [];
        const parsed = JSON.parse(raw);
        if (!Array.isArray(parsed)) return [];
        return parsed.map((id) => Number(id)).filter((id) => Number.isFinite(id));
    } catch {
        return [];
    }
};

export const setHeroProfileFilterIds = (ids) => {
    if (typeof window === 'undefined') return;
    const safe = Array.isArray(ids) ? ids.filter((id) => Number.isFinite(id)) : [];
    localStorage.setItem(HERO_PROFILE_FILTER_KEY, JSON.stringify(safe));
    window.dispatchEvent(new CustomEvent(HERO_PROFILE_FILTER_EVENT, { detail: safe }));
};

export const subscribeHeroProfileFilter = (handler) => {
    if (typeof window === 'undefined') return () => {};
    window.addEventListener(HERO_PROFILE_FILTER_EVENT, handler);
    return () => window.removeEventListener(HERO_PROFILE_FILTER_EVENT, handler);
};

export const getHeroProfiles = async () => {
    try {
        return await db.heroProfiles.toArray();
    } catch {
        return [];
    }
};

export const upsertHeroProfile = async ({ platform, username, displayName }) => {
    const usernameLower = normalizeUsername(username);
    const safePlatform = (platform || '').toString().trim().toLowerCase();
    if (!safePlatform || !usernameLower) return null;
    const existing = await db.heroProfiles.where('[platform+usernameLower]').equals([safePlatform, usernameLower]).first();
    const record = {
        platform: safePlatform,
        usernameLower,
        displayName: displayName || username,
        createdAt: existing?.createdAt || Date.now()
    };
    if (existing?.id) {
        await db.heroProfiles.update(existing.id, record);
        return { ...record, id: existing.id };
    }
    const id = await db.heroProfiles.add(record);
    return { ...record, id };
};

export const ensureLegacyHeroProfile = async () => {
    if (typeof window === 'undefined') return null;
    const legacy = (localStorage.getItem('heroUser') || '').trim();
    if (!legacy) return null;
    return await upsertHeroProfile({ platform: 'lichess', username: legacy, displayName: legacy });
};

const getPlayerName = (value) => {
    if (!value) return '';
    if (typeof value === 'string') return value;
    return value.name || '';
};

const inferPlatform = (game) => {
    if (!game) return 'unknown';
    const raw = game.platform || game.source || (game.lichessId ? 'lichess' : '') || (game.pgnHash ? 'pgn' : '');
    return (raw || 'unknown').toLowerCase();
};

export const getHeroSideFromGame = (game, profiles) => {
    if (!game || !Array.isArray(profiles) || profiles.length === 0) return null;
    if (typeof game.isHero === 'boolean' && !game.isHero) return null;
    const gamePlatform = inferPlatform(game).toLowerCase();
    const whiteName = normalizeUsername(getPlayerName(game.white));
    const blackName = normalizeUsername(getPlayerName(game.black));

    for (const profile of profiles) {
        if (!profile) continue;
        const profilePlatform = (profile.platform || '').toLowerCase();
        if (profilePlatform !== gamePlatform) continue;
        const name = normalizeUsername(profile.usernameLower || profile.displayName || '');
        if (!name) continue;
        if (whiteName === name) return 'white';
        if (blackName === name) return 'black';
    }

    return null;
};

export const isHeroGameForProfiles = (game, profiles) => {
    if (!game || !Array.isArray(profiles) || profiles.length === 0) return false;
    return !!getHeroSideFromGame(game, profiles);
};

export const getHeroDisplayName = (profiles) => {
    if (!Array.isArray(profiles) || profiles.length === 0) return 'Hero';
    if (profiles.length === 1) return profiles[0].displayName || profiles[0].usernameLower || 'Hero';
    return 'Hero';
};
