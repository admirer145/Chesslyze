import { saveAIAnalysis, getAIAnalysis, getGameAnalysis } from './db';
import { validateAIResponse } from '../utils/aiSchema';
import { Chess } from 'chess.js';

const formatEval = (score, mate) => {
    if (typeof mate === 'number' && Number.isFinite(mate)) {
        return mate > 0 ? `#${mate}` : `#-${Math.abs(mate)}`;
    }
    if (typeof score === 'number' && Number.isFinite(score)) {
        const val = (score / 100).toFixed(2);
        return score > 0 ? `+${val}` : `${val}`;
    }
    return '0.00';
};

const getSanFromUci = (fen, uci) => {
    try {
        const chess = new Chess(fen);
        const from = uci?.slice(0, 2);
        const to = uci?.slice(2, 4);
        if (!from || !to) return null;
        const promotion = uci?.length > 4 ? uci.slice(4, 5) : undefined;
        const move = chess.move({ from, to, promotion });
        return move?.san || null;
    } catch {
        return null;
    }
};

const buildEngineContext = (pgn, analysisLog, heroSide) => {
    if (!Array.isArray(analysisLog) || analysisLog.length === 0) return null;
    let history = [];
    try {
        const chess = new Chess();
        if (pgn && typeof pgn === 'string' && pgn.trim()) {
            chess.loadPgn(pgn, { sloppy: true });
            history = chess.history({ verbose: true });
        }
    } catch {
        history = [];
    }

    const entries = analysisLog.map((entry, idx) => {
        const ply = entry?.ply ?? (idx + 1);
        const moveNumber = Math.ceil(ply / 2);
        const side = entry?.turn === 'b' ? 'black' : 'white';
        const historyMove = history[idx];
        const san = historyMove?.san || null;
        const bestMoveSan = entry?.fen ? getSanFromUci(entry.fen, entry.bestMove) : null;
        return {
            ply,
            moveNumber,
            side,
            san,
            uci: entry?.move || null,
            classification: entry?.classification || 'good',
            evalDiff: typeof entry?.evalDiff === 'number' ? Math.round(entry.evalDiff) : null,
            scoreBefore: formatEval(entry?.score, entry?.mate),
            bestMove: entry?.bestMove || null,
            bestMoveSan,
            phase: entry?.phase || null,
            motifs: Array.isArray(entry?.motifs) ? entry.motifs : [],
            missedWin: !!entry?.missedWin,
            missedDefense: !!entry?.missedDefense
        };
    });

    const severityRank = {
        blunder: 7,
        mistake: 5,
        inaccuracy: 4,
        great: 6,
        brilliant: 8,
        best: 3,
        good: 2,
        book: 1
    };

    const targetCount = 12;
    const minPositive = 3;
    const hero = heroSide === 'white' || heroSide === 'black' ? heroSide : null;
    const prefers = hero ? entries.filter(e => e.side === hero) : entries;
    const others = hero ? entries.filter(e => e.side !== hero) : [];

    const isCritical = (e) => (
        ['blunder', 'mistake', 'inaccuracy', 'great', 'brilliant'].includes(e.classification)
        || e.missedWin || e.missedDefense
        || (typeof e.evalDiff === 'number' && e.evalDiff >= 80)
    );

    const sortBySeverity = (a, b) => {
        const sa = severityRank[a.classification] || 0;
        const sb = severityRank[b.classification] || 0;
        if (sb !== sa) return sb - sa;
        return (b.evalDiff || 0) - (a.evalDiff || 0);
    };

    const positiveRank = { brilliant: 3, great: 2, best: 1, good: 0 };
    const sortPositive = (a, b) => {
        const ra = positiveRank[a.classification] || 0;
        const rb = positiveRank[b.classification] || 0;
        if (rb !== ra) return rb - ra;
        return (a.evalDiff || 0) - (b.evalDiff || 0);
    };

    const pick = (source, max, out, seen) => {
        for (const item of source) {
            if (out.length >= max) break;
            if (seen.has(item.ply)) continue;
            out.push(item);
            seen.add(item.ply);
        }
    };

    const candidates = [];
    const seen = new Set();

    pick(prefers.filter(isCritical).sort(sortBySeverity), targetCount, candidates, seen);
    if (candidates.length < targetCount) {
        pick(others.filter(isCritical).sort(sortBySeverity), targetCount, candidates, seen);
    }

    const positivePoolHero = prefers
        .filter(e => ['brilliant', 'great', 'best'].includes(e.classification))
        .sort(sortPositive);
    const positivePoolAll = entries
        .filter(e => ['brilliant', 'great', 'best'].includes(e.classification))
        .sort(sortPositive);

    const countPositive = () => candidates.filter(e => ['brilliant', 'great', 'best'].includes(e.classification)).length;
    const injectPositives = (pool) => {
        if (!pool.length) return;
        for (const item of pool) {
            if (countPositive() >= minPositive) break;
            if (seen.has(item.ply)) continue;
            // Replace the lowest-severity non-positive candidate if we're full.
            if (candidates.length >= targetCount) {
                let replaceIdx = -1;
                let replaceScore = Infinity;
                for (let i = 0; i < candidates.length; i += 1) {
                    const c = candidates[i];
                    if (['brilliant', 'great', 'best'].includes(c.classification)) continue;
                    const score = severityRank[c.classification] || 0;
                    if (score < replaceScore) {
                        replaceScore = score;
                        replaceIdx = i;
                    }
                }
                if (replaceIdx >= 0) {
                    seen.delete(candidates[replaceIdx].ply);
                    candidates.splice(replaceIdx, 1, item);
                    seen.add(item.ply);
                }
            } else {
                candidates.push(item);
                seen.add(item.ply);
            }
        }
    };

    if (countPositive() < minPositive) {
        injectPositives(positivePoolHero);
    }
    if (countPositive() < minPositive) {
        injectPositives(positivePoolAll);
    }

    if (candidates.length < targetCount) {
        const bestPool = prefers
            .filter(e => e.classification === 'best')
            .sort(sortPositive);
        pick(bestPool, targetCount, candidates, seen);
    }

    if (candidates.length < targetCount) {
        const backupPool = prefers
            .filter(e => ['good'].includes(e.classification))
            .sort(sortPositive);
        pick(backupPool, targetCount, candidates, seen);
    }

    if (candidates.length < targetCount) {
        pick(others.filter(e => ['brilliant', 'great', 'best', 'good'].includes(e.classification)).sort(sortPositive), targetCount, candidates, seen);
    }

    if (candidates.length < targetCount) {
        pick(entries.sort(sortBySeverity), targetCount, candidates, seen);
    }

    return { entries, candidates };
};

const buildEngineMoveMap = (analysisLog) => {
    if (!Array.isArray(analysisLog) || analysisLog.length === 0) return new Map();
    const map = new Map();
    for (let i = 0; i < analysisLog.length; i += 1) {
        const entry = analysisLog[i];
        const ply = entry?.ply ?? (i + 1);
        const moveNumber = Math.ceil(ply / 2);
        const side = entry?.turn === 'b' ? 'black' : 'white';
        const key = `${moveNumber}-${side}`;
        const san = entry?.fen ? getSanFromUci(entry.fen, entry.move) : null;
        map.set(key, {
            classification: entry?.classification || 'good',
            scoreBefore: formatEval(entry?.score, entry?.mate),
            san
        });
    }
    return map;
};

const alignAnalysisWithEngine = (analysis, analysisLog) => {
    if (!analysis || !Array.isArray(analysis.moves)) return analysis;
    const engineMap = buildEngineMoveMap(analysisLog);
    if (engineMap.size === 0) return analysis;

    const alignedMoves = analysis.moves.map((move) => {
        const key = `${move.move_number}-${move.side}`;
        if (!engineMap.has(key)) return move;
        const engine = engineMap.get(key);
        return {
            ...move,
            notation: engine.san || move.notation,
            evaluation: {
                ...(move.evaluation || {}),
                before: engine.scoreBefore,
                classification: engine.classification
            }
        };
    });

    return { ...analysis, moves: alignedMoves };
};

export const generateAnalysisPrompt = (game, pgnOverride = null, analysisLog = null, options = {}) => {
    // Basic metadata extraction
    const pgn = typeof pgnOverride === 'string' ? pgnOverride : (game?.pgn || '');
    const white = game.white || 'White';
    const black = game.black || 'Black';
    const result = game.result || '?';
    const opening = game.openingName || game.eco || 'Unknown Opening';
    const heroSide = options?.heroSide;
    const heroName = options?.heroName;
    const engineContext = buildEngineContext(pgn, analysisLog, heroSide);

    // Check if we have move count or termination logic (optional enhancement)
    // For now, relies on what's in the PGN or game object.

    const engineContextText = engineContext ? `
[Engine Analysis Ground Truth]
Use this section as authoritative. Do NOT change classifications. Only select moves from this list for the "moves" and "key_moments" arrays.
If a move appears here, you must use its move_number, side, notation (SAN if provided), and classification exactly.

Key Move Candidates (engine-derived):
${engineContext.candidates.map((m, i) => (
`- ${i + 1}. Move ${m.moveNumber}${m.side === 'black' ? '...' : '.'} ${m.san || m.uci || ''} | ${m.side} | classification: ${m.classification} | evalDiff(cp): ${m.evalDiff ?? 'n/a'} | scoreBefore: ${m.scoreBefore} | bestMove: ${m.bestMoveSan || m.bestMove || 'n/a'} | phase: ${m.phase || 'n/a'}`
)).join('\n')}
` : '';

    return `Role: Grandmaster Analyst.
Task: Analyze this chess game and provide structured JSON output.

[Context Info]
- White: ${white} (${game.whiteRating || '?'})
- Black: ${black} (${game.blackRating || '?'})
- Opening: ${opening}
- Result: ${result}
- Time Control: ${game.timeControl || 'Standard'}

[Requirements]
1. "game_summary": Summarize the game narrative and player styles. Identify the decisve phase.
2. "player_insights": Recurring patterns, strengths, and weaknesses focused on the hero player (if provided).
3. "moves": Array of KEY moves (critical turning points, brilliancies, or mistakes) with specific evaluation and reasoning.
4. "key_moments": High-level descriptions of the most important moments.

[Perspective]
- If hero data is provided, analyze the game primarily from the hero player’s perspective.
- Hero: ${heroName || 'N/A'}
- Hero side: ${heroSide || 'unknown'}

[Hard Rules]
- Use the Engine Analysis Ground Truth section as authoritative for move labels and severity.
- Do not invent move evaluations or flip "good" vs "blunder".
- If engine ground truth is provided, choose moves ONLY from that list.

[Output Format]
Strictly Valid JSON. No markdown formatting (no \`\`\`json wrappers).
Use this exact schema structure:
{
  "schema_version": "1.0",
  "game_summary": {
    "result": "string",
    "time_control": "string",
    "opening": { "eco": "string", "name": "string" },
    "overall_assessment": "string",
    "key_themes": ["string"],
    "decisive_phase": "opening | middlegame | endgame"
  },
  "player_insights": {
    "strengths": ["string"],
    "recurring_mistakes": ["string"],
    "notable_improvements": ["string"],
    "conversion_quality": "poor | inconsistent | solid | precise"
  },
  "moves": [
    {
      "move_number": number,
      "side": "white | black",
      "notation": "string",
      "evaluation": {
        "before": "string (optional)",
        "after": "string (optional)",
        "classification": "brilliant | great | best | good | inaccuracy | mistake | blunder"
      },
      "reasoning": "string",
      "best_alternative": {
        "move": "string",
        "explanation": "string"
      }
    }
  ],
  "key_moments": [
    { "move_number": number, "side": "white | black", "description": "string", "impact": "string" }
  ]
}

[PGN Data]
${pgn}
${engineContextText}
`;
};

export const submitAnalysis = async (gameId, jsonInput) => {
    // 1. Validation
    const validation = validateAIResponse(jsonInput);
    if (!validation.success) {
        throw new Error(validation.error);
    }

    // 2. Persistence
    // validation.data is the parsed and validated JSON object
    let finalData = validation.data;
    try {
        const gameAnalysis = await getGameAnalysis(gameId);
        if (gameAnalysis?.analysisLog?.length) {
            finalData = alignAnalysisWithEngine(finalData, gameAnalysis.analysisLog);
        }
    } catch {
        // ignore alignment failures
    }

    await saveAIAnalysis(gameId, finalData);

    return finalData;
};

export const fetchAnalysis = async (gameId) => {
    const record = await getAIAnalysis(gameId);
    return record ? record.raw_json : null;
};
