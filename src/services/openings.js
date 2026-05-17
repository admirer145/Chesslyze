const UNKNOWN_VALUES = new Set(['', '?', '-', 'unknown', 'unknown opening']);

const cleanValue = (value) => {
    if (value === null || value === undefined) return '';
    const text = String(value).trim();
    return UNKNOWN_VALUES.has(text.toLowerCase()) ? '' : text;
};

const parseTags = (pgn) => {
    const tags = {};
    if (!pgn) return tags;
    const tagRe = /\[([A-Za-z0-9_]+)\s+"([^"]*)"\]/g;
    let match;
    while ((match = tagRe.exec(pgn)) !== null) {
        tags[match[1]] = match[2];
    }
    return tags;
};

const prettifySlugWord = (word) => {
    const lower = word.toLowerCase();
    if (lower === 'kings') return "King's";
    if (lower === 'queens') return "Queen's";
    return lower.charAt(0).toUpperCase() + lower.slice(1);
};

const isMoveStartToken = (token) => /^\d+\./.test(token);

const openingNameFromEcoUrl = (ecoUrl) => {
    const rawUrl = cleanValue(ecoUrl);
    if (!rawUrl) return '';

    try {
        const url = new URL(rawUrl);
        const parts = url.pathname.split('/').filter(Boolean);
        const openingIndex = parts.findIndex((part) => part.toLowerCase() === 'openings');
        const slug = openingIndex >= 0 ? parts[openingIndex + 1] : parts[parts.length - 1];
        if (!slug) return '';

        const decoded = decodeURIComponent(slug);
        const tokens = decoded.replace(/_/g, '-').split('-').filter(Boolean);
        const moveStart = tokens.findIndex(isMoveStartToken);
        const nameTokens = moveStart >= 0 ? tokens.slice(0, moveStart) : tokens;
        if (!nameTokens.length) return '';

        return nameTokens.map(prettifySlugWord).join(' ');
    } catch {
        return '';
    }
};

export const deriveOpeningMetadata = ({ eco = '', openingName = '', pgn = '', opening = null } = {}) => {
    const tags = parseTags(pgn);
    const ecoCode = cleanValue(eco)
        || cleanValue(opening?.eco)
        || cleanValue(tags.ECO)
        || cleanValue(tags.Eco);

    const name = cleanValue(openingName)
        || cleanValue(opening?.name)
        || cleanValue(tags.Opening)
        || cleanValue(tags.OpeningName)
        || openingNameFromEcoUrl(tags.ECOUrl || tags.EcoUrl || tags.OpeningUrl);

    return {
        eco: ecoCode,
        openingName: name || 'Unknown Opening'
    };
};

export const hasKnownOpeningName = (value) => !!cleanValue(value);

