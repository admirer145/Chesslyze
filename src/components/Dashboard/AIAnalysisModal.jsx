import React, { useState, useEffect } from 'react';
import { X, Copy, Check, ClipboardPaste, ArrowRight, Sparkles, AlertTriangle, Zap } from 'lucide-react';
import { generateAnalysisPrompt, submitAnalysis } from '../../services/aiAnalysisService';

export const AIAnalysisModal = ({ game, onClose, onAnalysisComplete }) => {
    const [step, setStep] = useState(1); // 1: Prompt, 2: Input
    const [prompt, setPrompt] = useState('');
    const [jsonInput, setJsonInput] = useState('');
    const [isCopied, setIsCopied] = useState(false);
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        if (game) {
            const p = generateAnalysisPrompt(game);
            setPrompt(p);
        }
    }, [game]);

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
        <div className="absolute inset-0 z-[100] flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
            {/* Modal Container */}
            <div className="bg-panel w-full max-w-3xl rounded-2xl border border-white/10 shadow-2xl flex flex-col max-h-[90vh] overflow-hidden">

                {/* Header - Premium gradient background */}
                <div className="relative overflow-hidden border-b border-white/10 shrink-0">
                    {/* Gradient background */}
                    <div className="absolute inset-0 bg-gradient-to-r from-purple-600/20 via-transparent to-transparent pointer-events-none" />

                    <div className="relative px-6 sm:px-8 py-6 flex items-center justify-between">
                        <div className="flex items-center gap-3 sm:gap-4 min-w-0">
                            <div className="p-2 sm:p-3 bg-purple-500/20 rounded-xl text-purple-300 ring-1 ring-purple-500/40 shadow-lg shrink-0">
                                <Sparkles size={20} strokeWidth={2} className="sm:w-6 sm:h-6" />
                            </div>
                            <div className="min-w-0">
                                <h2 className="text-xl sm:text-2xl font-bold text-primary tracking-tight truncate">AI Analysis Coach</h2>
                                <p className="text-xs sm:text-sm text-secondary mt-0.5">Powered by ChatGPT, Claude, or Gemini</p>
                            </div>
                        </div>
                        <button
                            onClick={onClose}
                            className="p-2 hover:bg-white/10 rounded-lg text-secondary hover:text-primary transition-colors shrink-0 ml-4"
                        >
                            <X size={20} />
                        </button>
                    </div>
                </div>

                {/* Step Tabs - Improved styling */}
                <div className="flex border-b border-white/5 bg-subtle/30 shrink-0">
                    {[
                        { num: 1, label: 'Get Prompt', icon: Copy },
                        { num: 2, label: 'Submit Analysis', icon: Check }
                    ].map(({ num, label, icon: Icon }) => (
                        <button
                            key={num}
                            onClick={() => setStep(num)}
                            className={`flex-1 py-3 sm:py-4 px-4 sm:px-6 text-xs sm:text-sm font-semibold uppercase tracking-wider transition-all border-b-2 flex items-center justify-center gap-2 ${step === num
                                ? 'text-primary border-purple-500 bg-purple-500/10'
                                : 'text-muted border-transparent hover:text-secondary'
                                }`}
                        >
                            <Icon size={16} className="hidden sm:block" />
                            <span className="truncate">{label}</span>
                        </button>
                    ))}
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-y-auto min-h-0">
                    <div className="p-4 sm:p-8">
                        {step === 1 && (
                            <div className="space-y-6 animate-fadeIn">
                                {/* Info Card */}
                                <div className="bg-gradient-to-r from-blue-500/15 to-blue-500/5 border border-blue-500/30 rounded-xl p-4 sm:p-5 flex gap-3 sm:gap-4">
                                    <div className="text-xl sm:text-2xl shrink-0">💡</div>
                                    <div>
                                        <p className="text-blue-200 text-xs sm:text-sm font-medium leading-relaxed">
                                            Copy the prompt below and paste it into your preferred AI chatbot (ChatGPT-4, Claude, Gemini).
                                            The AI will analyze your game and return structured insights.
                                        </p>
                                    </div>
                                </div>

                                {/* Prompt Textarea */}
                                <div>
                                    <label className="block text-xs sm:text-sm font-semibold text-primary mb-3 uppercase tracking-wide">
                                        Analysis Prompt
                                    </label>
                                    <div className="relative group">
                                        <textarea
                                            className="w-full h-56 sm:h-72 bg-black/40 border border-white/15 rounded-xl p-4 sm:p-5 font-mono text-xs text-gray-200 resize-none focus:outline-none focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50 transition-all shadow-inner leading-relaxed"
                                            value={prompt}
                                            readOnly
                                        />
                                        <button
                                            onClick={handleCopy}
                                            className={`absolute top-3 right-3 flex items-center gap-2 px-3 sm:px-4 py-2 rounded-lg text-xs font-bold transition-all shadow-lg ${isCopied
                                                ? 'bg-green-500 text-white'
                                                : 'bg-primary text-black hover:bg-white'
                                                }`}
                                        >
                                            {isCopied ? <Check size={14} /> : <Copy size={14} />}
                                            <span className="hidden sm:inline">{isCopied ? 'Copied!' : 'Copy'}</span>
                                        </button>
                                    </div>
                                </div>

                                {/* CTA */}
                                <div className="flex justify-end">
                                    <button
                                        onClick={() => setStep(2)}
                                        className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 text-white rounded-xl font-semibold text-sm sm:text-base transition-all shadow-lg hover:shadow-purple-500/20"
                                    >
                                        <span className="hidden sm:inline">Proceed to Step 2</span>
                                        <span className="sm:hidden">Next</span>
                                        <ArrowRight size={16} className="sm:w-[18px] sm:h-[18px]" />
                                    </button>
                                </div>
                            </div>
                        )}

                        {step === 2 && (
                            <div className="space-y-6 animate-fadeIn">
                                {/* Info Card */}
                                <div className="bg-gradient-to-r from-green-500/15 to-green-500/5 border border-green-500/30 rounded-xl p-4 sm:p-5 flex gap-3 sm:gap-4">
                                    <div className="text-xl sm:text-2xl shrink-0">📋</div>
                                    <div>
                                        <p className="text-green-200 text-xs sm:text-sm font-medium leading-relaxed">
                                            Paste the complete JSON response from the AI below. We'll validate the format automatically.
                                        </p>
                                    </div>
                                </div>

                                {/* JSON Input */}
                                <div>
                                    <label className="block text-xs sm:text-sm font-semibold text-primary mb-3 uppercase tracking-wide">
                                        AI Response (JSON)
                                    </label>
                                    <textarea
                                        className={`w-full h-56 sm:h-72 bg-black/40 border rounded-xl p-4 sm:p-5 font-mono text-xs text-gray-200 resize-none focus:outline-none transition-all shadow-inner leading-relaxed placeholder-gray-600 ${error
                                            ? 'border-red-500/50 focus:border-red-500 focus:ring-1 focus:ring-red-500/30'
                                            : 'border-white/15 focus:border-purple-500 focus:ring-1 focus:ring-purple-500/50'
                                            }`}
                                        placeholder='Paste the JSON response here...'
                                        value={jsonInput}
                                        onChange={(e) => setJsonInput(e.target.value)}
                                    />
                                </div>

                                {/* Error Message */}
                                {error && (
                                    <div className="bg-red-500/10 border border-red-500/30 rounded-xl p-3 sm:p-4 flex gap-3">
                                        <AlertTriangle size={16} className="shrink-0 text-red-400 mt-0.5 sm:w-[18px] sm:h-[18px]" />
                                        <div className="text-xs sm:text-sm text-red-300 font-mono whitespace-pre-wrap break-words">
                                            {error}
                                        </div>
                                    </div>
                                )}

                                {/* Actions */}
                                <div className="flex justify-end gap-2 sm:gap-3 pt-2">
                                    <button
                                        onClick={() => setStep(1)}
                                        className="px-4 sm:px-6 py-2 sm:py-3 text-secondary hover:text-primary hover:bg-white/5 transition-colors text-xs sm:text-sm font-medium rounded-lg"
                                    >
                                        Back
                                    </button>
                                    <button
                                        onClick={handleSubmit}
                                        disabled={isSubmitting || !jsonInput.trim()}
                                        className="flex items-center gap-2 sm:gap-3 px-4 sm:px-6 py-2 sm:py-3 bg-gradient-to-r from-purple-600 to-purple-500 hover:from-purple-500 hover:to-purple-400 disabled:from-gray-600 disabled:to-gray-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-xl font-semibold text-xs sm:text-sm transition-all shadow-lg hover:shadow-purple-500/20"
                                    >
                                        {isSubmitting ? (
                                            <>
                                                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
                                                <span className="hidden sm:inline">Analyzing...</span>
                                            </>
                                        ) : (
                                            <>
                                                <Zap size={16} className="sm:w-[18px] sm:h-[18px]" />
                                                <span className="hidden sm:inline">Analyze Game</span>
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
