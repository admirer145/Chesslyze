export const parseRatingNumber = (value) => {
    if (value === null || value === undefined || value === '') return null;
    const num = Number(value);
    return Number.isFinite(num) ? num : null;
};

const readTagValue = (pgn, tag) => {
    if (!pgn || !tag) return null;
    const match = pgn.match(new RegExp(`\\[${tag} "([^"]*)"\\]`));
    return match ? match[1] : null;
};

const firstParsed = (values) => {
    for (const value of values) {
        const parsed = parseRatingNumber(value);
        if (parsed !== null) return parsed;
    }
    return null;
};

export const getSideRating = (game, side) => {
    if (!game) return null;
    const prefix = side === 'white' ? 'white' : 'black';
    return firstParsed([
        game[`${prefix}Rating`],
        game[`${prefix}Elo`],
        game[`${prefix}RatingBefore`],
        game[`${prefix}EloBefore`],
    ]);
};

export const getSideRatingDiff = (game, side, pgn = '') => {
    if (!game) return null;
    const prefix = side === 'white' ? 'white' : 'black';
    const title = side === 'white' ? 'White' : 'Black';
    const direct = firstParsed([
        game[`${prefix}RatingDiff`],
        game[`${prefix}EloDiff`],
        game[`${prefix}RatingDelta`],
        game[`${prefix}EloDelta`],
        game[`${prefix}RatingChange`],
        game[`${prefix}EloChange`],
    ]);
    if (direct !== null) return direct;

    return firstParsed([
        readTagValue(pgn, `${title}RatingDiff`),
        readTagValue(pgn, `${title}EloDiff`),
        readTagValue(pgn, `${title}RatingDelta`),
        readTagValue(pgn, `${title}EloDelta`),
        readTagValue(pgn, `${title}RatingChange`),
        readTagValue(pgn, `${title}EloChange`),
    ]);
};

export const getSideRatingPost = (game, side, pgn = '') => {
    if (!game) return null;
    const prefix = side === 'white' ? 'white' : 'black';
    const explicitPost = firstParsed([
        game[`${prefix}RatingPost`],
        game[`${prefix}EloPost`],
        game[`${prefix}RatingAfter`],
        game[`${prefix}EloAfter`],
        game[`${prefix}NewRating`],
        game[`${prefix}NewElo`],
    ]);
    if (explicitPost !== null) return explicitPost;

    const rating = getSideRating(game, side);
    const diff = getSideRatingDiff(game, side, pgn);
    if (rating !== null && diff !== null) return rating + diff;
    return rating;
};
