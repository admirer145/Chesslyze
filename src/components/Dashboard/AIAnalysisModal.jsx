import React, { useState, useEffect } from 'react';
import { X, Copy, Check, ClipboardPaste, ArrowRight, Sparkles, AlertTriangle, Zap } from 'lucide-react';
import { generateAnalysisPrompt, submitAnalysis } from '../../services/aiAnalysisService';

export const AIAnalysisModal = ({ game, pgn, analysisLog, heroSide, heroName, onClose, onAnalysisComplete }) => {
    const [step, setStep] = useState(1); // 1: Prompt, 2: Input
    const [prompt, setPrompt] = useState('');
    const [jsonInput, setJsonInput] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (game) {
            const p = generateAnalysisPrompt(game, pgn, analysisLog, { heroSide, heroName });
            setPrompt(p);
        }
    }, [game, pgn, analysisLog, heroSide, heroName]);

    const handleCopy = async () => {
        try {
            await navigator.clipboard.writeText(prompt);
            setIsCopied(true);
            setTimeout(() => setIsCopied(false), 2000);
        } catch (err) {
            console.error('Failed to copy', err);
        }
    };

    const handleSubmit = async () => {
        if (!jsonInput.trim()) return;
        setIsSubmitting(true);
        setError(null);

        try {
            await submitAnalysis(game.id, jsonInput);
            onAnalysisComplete();
            onClose();
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <div className="ai-modal absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            {/* Modal Container */}
            <div className="ai-modal__panel bg-panel w-full max-w-3xl rounded-2xl border border-white/10 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

                {/* Header */}
                <div className="ai-modal__header shrink-0">
                    <div className="ai-modal__title">
                        <div className="ai-modal__icon">
                            <Sparkles size={20} strokeWidth={2} />
                        </div>
                        <div className="min-w-0">
                            <h2>AI Analysis Coach</h2>
                            <p>Paste AI analysis and unlock deeper insights for this game.</p>
                        </div>
                    </div>
                    <button
                        onClick={onClose}
                        className="ai-modal__close"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Step Tabs */}
                <div className="ai-modal__steps shrink-0">
                    {[
                        { num: 1, label: 'Get Prompt', icon: Copy },
                        { num: 2, label: 'Submit Analysis', icon: Check }
                    ].map(({ num, label, icon: Icon }) => (
                        <button
                            key={num}
                            onClick={() => setStep(num)}
                            className={`ai-step ${step === num ? 'ai-step--active' : ''}`}
                        >
                            <Icon size={16} />
                            <span>{label}</span>
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <div className="ai-modal__content flex-1 overflow-y-auto min-h-0">
                    <div className="ai-modal__body">
                        {step === 1 && (
                            <div className="ai-step-pane">
                                {/* Info Card */}
                                <div className="ai-info-card ai-info-card--blue">
                                    <div className="ai-info-icon">💡</div>
                                    <div>
                                        <p>
                                            Copy the prompt below and paste it into your preferred AI chatbot (ChatGPT-4, Claude, Gemini).
                                            The AI will analyze your game and return structured insights.
                                        </p>
                                    </div>
                                </div>

                                {/* Prompt Textarea */}
                                <div>
                                    <label className="ai-label">
                                        Analysis Prompt
                                    </label>
                                    <div className="ai-textarea-wrap">
                                        <textarea
                                            className="ai-textarea"
                                            value={prompt}
                                            readOnly
                                        />
                                        <button
                                            onClick={handleCopy}
                                            className={`ai-copy-btn ${isCopied ? 'ai-copy-btn--ok' : ''}`}
                                        >
                                            {isCopied ? <Check size={14} /> : <Copy size={14} />}
                                            <span>{isCopied ? 'Copied!' : 'Copy'}</span>
                                        </button>
                                    </div>
                                </div>

                                {/* CTA */}
                                <div className="ai-actions">
                                    <button
                                        onClick={() => setStep(2)}
                                        className="ai-primary-btn"
                                    >
                                        <span>Proceed to Step 2</span>
                                        <ArrowRight size={16} className="sm:w-[18px] sm:h-[18px]" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="ai-step-pane">
                                {/* Info Card */}
                                <div className="ai-info-card ai-info-card--green">
                                    <div className="ai-info-icon">📋</div>
                                    <div>
                                        <p>
                                            Paste the complete JSON response from the AI below. We'll validate the format automatically.
                                        </p>
                                    </div>
                                </div>

                                {/* JSON Input */}
                                <div>
                                    <label className="ai-label">
                                        AI Response (JSON)
                                    </label>
                                    <textarea
                                        className={`ai-textarea ${error ? 'ai-textarea--error' : ''}`}
                                        placeholder='Paste the JSON response here...'
                                        value={jsonInput}
                                        onChange={(e) => setJsonInput(e.target.value)}
                                    />
                                </div>

                                {/* Error Message */}
                                {error && (
                                    <div className="ai-error">
                                        <AlertTriangle size={16} />
                                        <div className="ai-error__text">
                                            {error}
                                        </div>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="ai-actions">
                                    <button
                                        onClick={() => setStep(1)}
                                        className="ai-secondary-btn"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={isSubmitting || !jsonInput.trim()}
                                        className="ai-primary-btn"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                <span>Analyzing...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Zap size={16} className="sm:w-[18px] sm:h-[18px]" />
                                                <span>Analyze Game</span>
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
};
