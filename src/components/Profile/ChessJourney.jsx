import React, { useRef } from 'react';
import { useUserStats } from '../../hooks/useUserStats';
import { ArrowDown, Crown, Zap, Shield, Flame, Activity } from 'lucide-react';
import { ResponsiveContainer, AreaChart, Area, XAxis, YAxis, Tooltip, BarChart, Bar, Cell } from 'recharts';

// --- SUB-COMPONENTS ---

/* 1. HERO Identity */
const HeroSection = ({ stats }) => {
    return (
        <section className="min-h-[85vh] flex flex-col items-center justify-center relative p-8 text-center snap-start">
            <div className="absolute inset-0 bg-gradient-to-b from-blue-500/10 to-transparent pointer-events-none" />

            <div className="mb-8 relative group">
                <div className="absolute -inset-1 bg-gradient-to-r from-blue-600 to-violet-600 rounded-full blur opacity-25 group-hover:opacity-75 transition duration-1000 group-hover:duration-200"></div>
                <div className="relative w-32 h-32 rounded-full bg-[#111] ring-4 ring-white/5 flex items-center justify-center text-5xl font-bold text-white shadow-2xl overflow-hidden">
                    {stats.heroUser.charAt(0).toUpperCase()}
                    <div className="absolute inset-0 bg-gradient-to-tr from-white/10 to-transparent pointer-events-none" />
                </div>
                <div className="absolute -bottom-2 -right-2 bg-[#000] border border-white/10 rounded-full p-2 shadow-lg backdrop-blur-xl">
                    {stats.archetype.includes('Solid') ? <Shield className="text-emerald-400" size={20} /> :
                        stats.archetype.includes('Chaos') ? <Flame className="text-orange-400" size={20} /> :
                            stats.archetype.includes('Crusher') ? <Zap className="text-yellow-400" size={20} /> :
                                <Crown className="text-blue-400" size={20} />}
                </div>
            </div>

            <h1 className="text-6xl md:text-8xl font-bold tracking-tighter text-transparent bg-clip-text bg-gradient-to-b from-white to-white/40 mb-6 font-display">
                {stats.heroUser}
            </h1>
            <p className="text-xl md:text-2xl text-secondary font-light max-w-2xl leading-relaxed">
                The <span className="text-blue-400 font-medium">{stats.archetype}</span>.
            </p>

            <div className="mt-12 grid grid-cols-3 gap-8 md:gap-16 text-center">
                <div>
                    <div className="text-3xl font-bold text-primary">{stats.highestRating}</div>
                    <div className="text-xs uppercase tracking-widest text-secondary mt-1">Peak Rating</div>
                </div>
                <div>
                    <div className="text-3xl font-bold text-primary">{stats.totalGames}</div>
                    <div className="text-xs uppercase tracking-widest text-secondary mt-1">Battles</div>
                </div>
                <div>
                    <div className="text-3xl font-bold text-green-400">{stats.winRate}%</div>
                    <div className="text-xs uppercase tracking-widest text-secondary mt-1">Win Rate</div>
                </div>
            </div>

            <div className="absolute bottom-10 animate-bounce text-muted">
                <ArrowDown size={24} />
            </div>
        </section>
    );
};

/* 2. TIMELINE Growth */
const TimelineSection = ({ data }) => {
    return (
        <section className="min-h-screen flex flex-col justify-center p-8 md:p-20 snap-start bg-[#050505] relative overflow-hidden">
            <div className="absolute top-0 left-0 w-full h-32 bg-gradient-to-b from-black to-transparent z-10" />

            <div className="max-w-5xl mx-auto w-full z-10 relative">
                <h2 className="text-4xl md:text-5xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-purple-400 mb-4 tracking-tight">The Climb</h2>
                <p className="text-xl text-secondary/80 mb-12 max-w-xl font-light leading-relaxed">
                    Every point earned, every plateau endured. Your journey visible in a single line.
                </p>

                <div className="h-[500px] w-full bg-gradient-to-b from-white/5 to-transparent border border-white/5 rounded-3xl p-1 backdrop-blur-sm shadow-2xl relative group">
                    <div className="absolute -inset-0.5 bg-gradient-to-r from-blue-500/20 to-purple-500/20 rounded-3xl blur opacity-0 group-hover:opacity-100 transition duration-1000" />
                    <div className="h-full w-full bg-[#0a0a0a] rounded-[22px] p-6 relative overflow-hidden flex flex-col">
                        {(!data || data.length === 0) ? (
                            <div className="flex-1 flex items-center justify-center text-secondary">
                                No rating history available yet.
                            </div>
                        ) : (
                            <div className="flex-1 min-h-0 w-full">
                                <ResponsiveContainer width="100%" height="100%">
                                    <AreaChart data={data}>
                                        <defs>
                                            <linearGradient id="colorRating" x1="0" y1="0" x2="0" y2="1">
                                                <stop offset="5%" stopColor="#8b5cf6" stopOpacity={0.3} />
                                                <stop offset="95%" stopColor="#8b5cf6" stopOpacity={0} />
                                            </linearGradient>
                                        </defs>
                                        <XAxis dataKey="date" hide />
                                        <YAxis domain={['auto', 'auto']} hide />
                                        <Tooltip
                                            contentStyle={{ backgroundColor: '#0f172a', borderColor: '#1e293b', color: '#f8fafc', borderRadius: 12 }}
                                            itemStyle={{ color: '#a78bfa' }}
                                            formatter={(value) => [`${value}`, 'Rating']}
                                            labelStyle={{ color: '#94a3b8', marginBottom: 4 }}
                                        />
                                        <Area
                                            type="monotone"
                                            dataKey="rating"
                                            stroke="#8b5cf6"
                                            strokeWidth={3}
                                            fillOpacity={1}
                                            fill="url(#colorRating)"
                                        />
                                    </AreaChart>
                                </ResponsiveContainer>
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </section>
    );
};

/* 3. EVOLUTION (Mistakes) */
const EvolutionSection = ({ stats }) => {
    const data = [
        { name: 'Start', blunders: Number(stats.mistakeEvolution.earlyRate) },
        { name: 'Now', blunders: Number(stats.mistakeEvolution.recentRate) },
    ];

    return (
        <section className="min-h-screen flex flex-col justify-center p-8 md:p-20 snap-start bg-app relative">
            <div className="max-w-5xl mx-auto w-full grid md:grid-cols-2 gap-12 items-center">
                <div>
                    <h2 className="text-4xl font-bold text-primary mb-4">Evolution of Precision</h2>
                    <p className="text-lg text-secondary leading-relaxed mb-6">
                        You used to blunder <span className="text-red-400 font-semibold">{stats.mistakeEvolution.earlyRate}</span> times every 100 moves.
                        <br /><br />
                        Today? Only <span className="text-emerald-400 font-semibold">{stats.mistakeEvolution.recentRate}</span>.
                    </p>
                    <div className="inline-block px-4 py-2 bg-emerald-500/10 text-emerald-400 rounded-full font-medium border border-emerald-500/20">
                        {stats.mistakeEvolution.improvement}% Reduction in Errors
                    </div>
                </div>

                <div className="h-[300px] bg-panel/30 border border-white/5 rounded-3xl p-8 flex items-end gap-4 justify-center">
                    {/* Visual Bar Comparison */}
                    <div className="w-24 bg-red-500/20 rounded-t-xl relative group transition-all hover:bg-red-500/30" style={{ height: '80%' }}>
                        <div className="absolute -top-8 w-full text-center text-red-400 font-bold text-xl">{data[0].blunders}</div>
                        <div className="absolute bottom-4 w-full text-center text-red-400/50 uppercase text-xs font-bold tracking-wider">Then</div>
                    </div>
                    <div className="w-24 bg-emerald-500/20 rounded-t-xl relative group transition-all hover:bg-emerald-500/30" style={{ height: `${(data[1].blunders / data[0].blunders) * 80}%` }}>
                        <div className="absolute -top-8 w-full text-center text-emerald-400 font-bold text-xl">{data[1].blunders}</div>
                        <div className="absolute bottom-4 w-full text-center text-emerald-400/50 uppercase text-xs font-bold tracking-wider">Now</div>
                    </div>
                </div>
            </div>
        </section>
    );
};


/* 4. TROPHY ROOM */
const TrophyCard = ({ title, value, subtext, icon: Icon, color }) => (
    <div className="relative group perspective-1000">
        <div className={`absolute -inset-0.5 bg-gradient-to-r from-${color}-500/20 to-${color}-600/20 rounded-2xl blur opacity-0 group-hover:opacity-100 transition duration-500`} />
        <div className="relative h-full bg-[#0a0a0a] border border-white/5 rounded-2xl p-8 hover:bg-[#111] transition-all duration-300 flex flex-col">
            <div className={`w-14 h-14 rounded-2xl bg-${color}-500/10 text-${color}-400 flex items-center justify-center mb-6 group-hover:scale-110 group-hover:rotate-3 transition-transform duration-300 shadow-inner`}>
                <Icon size={28} strokeWidth={1.5} />
            </div>
            <h3 className="text-secondary text-xs font-bold uppercase tracking-widest mb-2 opacity-70">{title}</h3>
            <div className="text-3xl font-bold text-white mb-3 tracking-tight">{value}</div>
            <p className="text-sm text-muted leading-relaxed font-light">{subtext}</p>
        </div>
    </div>
);

const TrophyRoom = ({ stats }) => {
    return (
        <section className="min-h-screen flex flex-col justify-center p-8 md:p-20 snap-start bg-[#050505] relative">
            <div className="max-w-6xl mx-auto w-full">
                <h2 className="text-4xl md:text-6xl font-bold text-transparent bg-clip-text bg-gradient-to-r from-orange-200 to-amber-500 mb-16 text-center tracking-tighter">Moments of Glory</h2>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
                    {stats.biggestUpset && (
                        <TrophyCard
                            title="Giant Killer"
                            value={`+${stats.biggestUpset.ratingDiff} pts`}
                            subtext={`Defeated ${stats.biggestUpset.opponent} (${stats.biggestUpset.rating}) on ${new Date(stats.biggestUpset.date).toLocaleDateString()}`}
                            icon={Flame}
                            color="orange"
                        />
                    )}
                    {stats.wildestGame && (
                        <TrophyCard
                            title="Wildest Ride"
                            value={`${stats.wildestGame.swing} cp`}
                            subtext={`Analysis swung wildly against ${stats.wildestGame.opponent}. A true rollercoaster.`}
                            icon={Activity}
                            color="red"
                        />
                    )}
                    {stats.fastestWin && (
                        <TrophyCard
                            title="Blitzkrieg"
                            value={`${stats.fastestWin.ply} moves`}
                            subtext={`Crushed ${stats.fastestWin.opponent} in record time.`}
                            icon={Zap}
                            color="yellow"
                        />
                    )}
                </div>
            </div>
        </section>
    );
};

// --- MAIN COMPONENT ---

export const ChessJourney = () => {
    const stats = useUserStats();

    // Use a ref to scroll to top on mount if needed, or manage scroll snap
    const containerRef = useRef(null);

    if (!stats) {
        return (
            <div className="flex flex-col items-center justify-center h-full text-secondary bg-app">
                <div className="animate-pulse text-xl font-light">Loading your story...</div>
            </div>
        );
    }

    return (
        <div ref={containerRef} className="h-full overflow-y-auto snap-y snap-mandatory bg-app scroll-smooth">
            <HeroSection stats={stats} />
            <TimelineSection data={stats.ratingHistory} />
            <EvolutionSection stats={stats} />
            <TrophyRoom stats={stats} />

            {/* Footer */}
            <section className="min-h-[50vh] flex items-center justify-center snap-start p-12 text-center">
                <div className="text-muted text-sm">
                    <p>Generated by ReelChess</p>
                    <p className="mt-2 text-xs opacity-50">Your journey continues with every move.</p>
                </div>
            </section>
        </div>
    );
};
