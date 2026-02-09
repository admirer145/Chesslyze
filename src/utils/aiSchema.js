import { z } from 'zod';

export const AIAnalysisSchema = z.object({
    schema_version: z.string().default('1.0'),
    game_summary: z.object({
        result: z.string().describe("e.g., '1-0', '0-1', '1/2-1/2'"),
        time_control: z.string().describe("e.g., '300+0', 'Standard'"),
        opening: z.object({
            eco: z.string().describe("ECO code"),
            name: z.string().describe("Opening name")
        }),
        overall_assessment: z.string().describe("Summary of the game narrative"),
        key_themes: z.array(z.string()).describe("List of strategic themes"),
        decisive_phase: z.enum(['opening', 'middlegame', 'endgame']).describe("Phase where the game was decided")
    }),
    player_insights: z.object({
        strengths: z.array(z.string()).describe("Player strengths shown"),
        recurring_mistakes: z.array(z.string()).describe("Mistakes repeated"),
        notable_improvements: z.array(z.string()).describe("Areas of improvement"),
        conversion_quality: z.enum(['poor', 'inconsistent', 'solid', 'precise'])
    }),
    moves: z.array(z.object({
        move_number: z.number(),
        side: z.enum(['white', 'black']),
        notation: z.string(),
        evaluation: z.object({
            before: z.string().optional().describe("Engine eval before move"),
            after: z.string().optional().describe("Engine eval after move"),
            classification: z.enum(['best', 'good', 'inaccuracy', 'mistake', 'blunder', 'brilliant', 'great', 'book']).or(z.string())
        }),
        reasoning: z.string().describe("Why is this move good/bad?"),
        best_alternative: z.object({
            move: z.string().optional(),
            followup: z.array(z.string()).optional(),
            explanation: z.string().optional()
        }).optional(),
        strategic_tags: z.array(z.string()).optional()
    })),
    key_moments: z.array(z.object({
        move_number: z.number(),
        side: z.enum(['white', 'black']),
        description: z.string(),
        impact: z.string()
    }))
});

export const validateAIResponse = (jsonInput) => {
    try {
        const parsed = typeof jsonInput === 'string' ? JSON.parse(jsonInput) : jsonInput;
        return { success: true, data: AIAnalysisSchema.parse(parsed) };
    } catch (error) {
        if (error instanceof SyntaxError) {
            return { success: false, error: `Invalid JSON Syntax: ${error.message}` };
        }
        if (error instanceof z.ZodError) {
            const issues = error.errors.map(e => `${e.path.join('.')}: ${e.message}`).join('; ');
            return { success: false, error: `Schema Validation Failed: ${issues}` };
        }
        return { success: false, error: error.message };
    }
};
