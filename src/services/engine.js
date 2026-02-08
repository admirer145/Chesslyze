class EngineService {
    constructor() {
        this.worker = null;
        this.jobs = new Map(); // jobId -> { resolve, reject, onUpdate, lastEvaluation }
        // Keep track of initialization state to prevent multiple workers
        this.isInitializing = false;
        this.initPromise = null;
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
                const { type, jobId, evaluation, move, error } = e.data;

                // Debug log for worker messages (optional, ensure not too spammy)
                // console.log("[EngineService] Message from worker:", type, jobId);

                const job = this.jobs.get(jobId);

                if (!job) return;

                if (type === 'BEST_MOVE') {
                    job.resolve({ bestMove: move, evaluation: job.lastEvaluation });
                    this.jobs.delete(jobId);
                } else if (type === 'INFO') {
                    job.lastEvaluation = evaluation;
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

    async analyze(fen, depth = 15, onUpdate) {
        if (!this.worker) await this.init();

        const jobId = Math.random().toString(36).substring(7);

        return new Promise((resolve, reject) => {
            this.jobs.set(jobId, { resolve, reject, onUpdate, lastEvaluation: {} });

            this.worker.postMessage({
                type: 'ANALYZE',
                jobId,
                data: { fen, depth }
            });

            // Fallback timeout to prevent infinite hangs
            setTimeout(() => {
                if (this.jobs.has(jobId)) {
                    console.error(`[EngineService] Timeout for job ${jobId}`);
                    reject(new Error("Analysis timeout"));
                    this.jobs.delete(jobId);

                    // Optional warning: Maybe restart worker if it's consistently timing out?
                }
            }, 30000); // 30 seconds per move is generous but safe
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
