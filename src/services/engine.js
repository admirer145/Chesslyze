class EngineService {
    constructor() {
        this.worker = null;
        this.jobs = new Map(); // jobId -> { resolve, reject, onUpdate, lastEvaluation, pvLinesByMultiPv }
        // Keep track of initialization state to prevent multiple workers
        this.isInitializing = false;
        this.initPromise = null;
        this.engineName = null;
        this.engineCaps = { nnue: false, multipv: false };
    }

    init() {
        if (this.worker) return Promise.resolve();
        if (this.initPromise) return this.initPromise;

        this.initPromise = new Promise((resolve) => {
            console.log("[EngineService] Initializing worker...");
            // In Vite, we import workers with this syntax
            this.worker = new Worker(new URL('../workers/analysis.worker.js', import.meta.url), {
                type: 'classic', // Classic because we use importScripts
            });

            this.worker.onmessage = (e) => {
                const { type, jobId, evaluation, move, error, name, caps } = e.data;

                // Debug log for worker messages (optional, ensure not too spammy)
                // console.log("[EngineService] Message from worker:", type, jobId);

                if (type === 'ENGINE_ID') {
                    this.engineName = name || null;
                    return;
                }
                if (type === 'ENGINE_CAPS' && caps && typeof caps === 'object') {
                    this.engineCaps = { ...this.engineCaps, ...caps };
                    return;
                }

                const job = this.jobs.get(jobId);

                if (!job) return;

                if (type === 'BEST_MOVE') {
                    const pvLines = Array.from(job.pvLinesByMultiPv.values())
                        .filter(Boolean)
                        .sort((a, b) => (a.multipv || 1) - (b.multipv || 1));
                    job.resolve({ bestMove: move, evaluation: job.lastEvaluation, pvLines });
                    this.jobs.delete(jobId);
                } else if (type === 'INFO') {
                    job.lastEvaluation = evaluation;
                    const multi = evaluation?.multipv || 1;
                    job.pvLinesByMultiPv.set(multi, evaluation);
                    if (job.onUpdate) job.onUpdate(evaluation);
                } else if (type === 'ERROR') {
                    console.error("[EngineService] Worker Error:", error);
                    job.reject(new Error(error || "Engine error"));
                    this.jobs.delete(jobId);
                }
            };

            this.worker.postMessage({ type: 'INIT' });

            // Resolve immediately as the worker will handle its own readiness
            console.log("[EngineService] Worker created.");
            resolve();
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
        this.worker.postMessage({ type: 'SET_OPTIONS', data: { options } });
    }

    async restart() {
        try {
            this.stop();
        } catch {
            // ignore
        }
        this.terminate();
        await this.init();
    }

    async analyze(fen, depthOrOptions = 15, onUpdate) {
        if (!this.worker) await this.init();

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

            this.worker.postMessage({
                type: 'ANALYZE',
                jobId,
                data: { fen, depth, multiPv }
            });

            // Fallback timeout to prevent infinite hangs
            const timeoutMs = typeof timeoutMsOverride === 'number'
                ? timeoutMsOverride
                : Math.min(900000, Math.max(45000, 8000 + depth * 5000 + multiPv * 9000));
            const t = setTimeout(() => {
                if (this.jobs.has(jobId)) {
                    console.error(`[EngineService] Timeout for job ${jobId}`);
                    this.jobs.delete(jobId);
                    try { this.stop(); } catch { }
                    reject(new Error("Analysis timeout"));

                    // Optional warning: Maybe restart worker if it's consistently timing out?
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
