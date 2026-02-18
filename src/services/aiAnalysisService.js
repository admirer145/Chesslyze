import { saveAIAnalysis, getAIAnalysis, getGame } from './db';
import { validateAIResponse } from '../utils/aiSchema';

export const generateAnalysisPrompt = (game, pgnOverride = null) => {
    // Basic metadata extraction
    const pgn = typeof pgnOverride === 'string' ? pgnOverride : (game?.pgn || '');
    const white = game.white || 'White';
    const black = game.black || 'Black';
    const result = game.result || '?';
    const opening = game.openingName || game.eco || 'Unknown Opening';

    // Check if we have move count or termination logic (optional enhancement)
    // For now, relies on what's in the PGN or game object.

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
2. "player_insights": Recurring patterns, strengths, and weaknesses for both players.
3. "moves": Array of KEY moves (critical turning points, brilliancies, or mistakes) with specific evaluation and reasoning.
4. "key_moments": High-level descriptions of the most important moments.

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
    await saveAIAnalysis(gameId, validation.data);

    return validation.data;
};

export const fetchAnalysis = async (gameId) => {
    const record = await getAIAnalysis(gameId);
    return record ? record.raw_json : null;
};
