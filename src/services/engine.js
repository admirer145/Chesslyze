class EngineService {
    constructor() {
        this.worker = null;
        this.jobs = new Map(); // jobId -> { resolve, reject, onUpdate, lastEvaluation, pvLinesByMultiPv }
        // Keep track of initialization state to prevent multiple workers
        this.isInitializing = false;
        this.initPromise = null;
        this.engineName = null;
        this.engineCaps = { nnue: false, multipv: false };
        this.lastJobFinishTime = 0;
        this.version = null;
        this.debug = false;
        try {
            this.debug = (typeof window !== 'undefined' && window.__ENGINE_DEBUG__ === true)
                || localStorage.getItem('engineDebug') === 'true';
        } catch {
            // ignore
        }
    }

    init(version = '17.1-single') {
        if (this.worker && this.version === version) return Promise.resolve();

        // If worker exists but version different, stop old one
        if (this.worker) {
            this.terminate();
        }

        if (this.initPromise) return this.initPromise;

        this.version = version;

        this.initPromise = new Promise((resolve, reject) => {
            try {
                this.worker = new Worker(new URL('../workers/analysis.worker.js', import.meta.url), {
                    type: 'module'
                });

                this.worker.onmessage = (e) => {
                    const { type, data, error, name, caps, jobId, evaluation, move } = e.data;
                    if (this.debug) {
                        console.log(`[EngineService] <- Worker [${type}]:`, e.data);
                    }

                    if (type === 'ENGINE_ID') {
                        this.engineName = name || null;
                        return;
                    }

                    if (type === 'ENGINE_CAPS' && caps && typeof caps === 'object') {
                        this.engineCaps = { ...this.engineCaps, ...caps };
                        return;
                    }

                    if (type === 'ERROR') {
                        console.error("[EngineService] Worker Error:", error);
                        return;
                    }

                    if (jobId && this.jobs.has(jobId)) {
                        const job = this.jobs.get(jobId);

                        if (type === 'BEST_MOVE') {
                            const pvLines = Array.from(job.pvLinesByMultiPv.values())
                                .filter(Boolean)
                                .sort((a, b) => (a.multipv || 1) - (b.multipv || 1));
                            job.resolve({ bestMove: move, evaluation: job.lastEvaluation, pvLines });
                            this.jobs.delete(jobId);
                            this.lastJobFinishTime = Date.now();
                        } else if (type === 'INFO') {
                            job.lastEvaluation = evaluation;
                            const multi = evaluation?.multipv || 1;
                            job.pvLinesByMultiPv.set(multi, evaluation);
                            if (job.onUpdate) job.onUpdate(evaluation);
                        } else if (type === 'ERROR') {
                            job.reject(new Error(error || "Engine error"));
                            this.jobs.delete(jobId);
                            this.lastJobFinishTime = Date.now();
                        }
                    }
                };

                this.worker.onerror = (err) => {
                    console.error("[EngineService] Worker Error (System):", err);
                    this.terminate();
                    reject(err);
                };

                this.worker.postMessage({ type: 'INIT', version, debug: this.debug });
                if (this.debug) {
                    console.log(`[EngineService] Initialized worker with version ${version}`);
                }

                // Add debug listener for all messages
                const originalPostMessage = this.worker.postMessage.bind(this.worker);
                this.worker.postMessage = (msg) => {
                    if (this.debug) {
                        console.log("[EngineService] -> Worker:", msg);
                    }
                    originalPostMessage(msg);
                };

                resolve();

            } catch (err) {
                console.error("[EngineService] Failed to create worker:", err);
                reject(err);
            }
        });

        return this.initPromise;
    }

    getInfo() {
        return {
            name: this.engineName,
            caps: this.engineCaps
        };
    }

    setOptions(options = []) {
        if (!this.worker) return;

        // Block if currently running a job
        if (this.jobs.size > 0) {
            console.warn("[EngineService] Ignoring setOptions because engine is busy analyzing.");
            return;
        }

        // Block if a job finished very recently (likely in a loop), to prevent race conditions between moves
        const timeSinceLastJob = Date.now() - (this.lastJobFinishTime || 0);
        if (timeSinceLastJob < 2000) {
            console.warn("[EngineService] Ignoring setOptions because engine was recently active (possible analysis loop).");
            return;
        }

        // Safety clamp for WASM memory/thread limits
        const safeOptions = options.map(opt => {
            if (opt.name === 'Hash') {
                return { ...opt, value: Math.min(256, Math.max(1, opt.value)) };
            }
            if (opt.name === 'Threads') {
                return { ...opt, value: Math.min(32, Math.max(1, opt.value)) };
            }
            return opt;
        });

        this.worker.postMessage({ type: 'SET_OPTIONS', data: { options: safeOptions } });
    }

    async restart(version) {
        try {
            this.stop();
        } catch {
            // ignore
        }
        this.terminate();
        await this.init(version || this.version);
    }

    async analyze(fen, depthOrOptions = 15, onUpdate) {
        // Use current expected version if not initialized (should be set by init/restart previously)
        // If not set, use default '17.1-single'
        if (!this.worker) await this.init(this.version || '17.1-single');

        const jobId = Math.random().toString(36).substring(7);

        const opts = typeof depthOrOptions === 'number'
            ? { depth: depthOrOptions }
            : (depthOrOptions || {});

        const depth = opts.depth ?? 15;
        const multiPv = opts.multiPv ?? 1;
        const timeoutMsOverride = opts.timeoutMs;

        return new Promise((resolve, reject) => {
            let settled = false;
            this.jobs.set(jobId, {
                resolve: (value) => {
                    if (settled) return;
                    settled = true;
                    resolve(value);
                },
                reject: (err) => {
                    if (settled) return;
                    settled = true;
                    reject(err);
                },
                onUpdate,
                lastEvaluation: {},
                pvLinesByMultiPv: new Map()
            });

            const movetime = opts.movetime;

            this.worker.postMessage({
                type: 'ANALYZE',
                jobId,
                data: { fen, depth, multiPv, movetime }
            });

            // Fallback timeout to prevent infinite hangs
            const timeoutMs = typeof timeoutMsOverride === 'number'
                ? timeoutMsOverride
                : Math.max(60000, 10000 * Math.pow(1.5, Math.max(0, depth - 10))); // Exponential timeout: d20 ~= 600s (10m)
            const t = setTimeout(() => {
                if (this.jobs.has(jobId)) {
                    console.error(`[EngineService] Timeout for job ${jobId}`);
                    this.jobs.delete(jobId);
                    try { this.stop(); } catch { }
                    reject(new Error("Analysis timeout"));
                }
            }, timeoutMs);

            // Ensure we don't leave dangling timers.
            const job = this.jobs.get(jobId);
            if (job) {
                const originalResolve = job.resolve;
                const originalReject = job.reject;
                job.resolve = (v) => {
                    clearTimeout(t);
                    originalResolve(v);
                };
                job.reject = (e) => {
                    clearTimeout(t);
                    originalReject(e);
                };
            }
        });
    }

    stop() {
        if (this.worker) this.worker.postMessage({ type: 'STOP' });
    }

    terminate() {
        if (this.worker) {
            this.worker.terminate();
            this.worker = null;
            this.initPromise = null;
        }
    }
}

export const engine = new EngineService();
