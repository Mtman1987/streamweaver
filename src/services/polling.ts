// Unified Polling Service
interface PollingTask {
    name: string;
    fn: () => Promise<void>;
    interval: number;
    lastRun: number;
}

class PollingService {
    private tasks: PollingTask[] = [];
    private intervalId: NodeJS.Timeout | null = null;
    private running = false;
    private readonly tickInterval = 5000; // Check every 5 seconds

    addTask(name: string, fn: () => Promise<void>, intervalMs: number) {
        this.tasks.push({
            name,
            fn,
            interval: intervalMs,
            lastRun: 0
        });
        console.log(`[Polling] Added task: ${name} (${intervalMs}ms)`);
    }

    start() {
        if (this.intervalId) return;
        
        this.intervalId = setInterval(async () => {
            if (this.running) return;
            this.running = true;
            try {
                for (const task of this.tasks) {
                    const now = Date.now();
                    if (now - task.lastRun >= task.interval) {
                        // Mark the task before awaiting it so a slow tenant
                        // sweep cannot schedule duplicate work on the next tick.
                        task.lastRun = now;
                        try {
                            await task.fn();
                        } catch (error) {
                            console.error(`[Polling] ${task.name} error:`, error);
                        }
                    }
                }
            } finally {
                this.running = false;
            }
        }, this.tickInterval);
        
        console.log(`[Polling] Started unified polling service (${this.tasks.length} tasks)`);
    }

    stop() {
        if (this.intervalId) {
            clearInterval(this.intervalId);
            this.intervalId = null;
            console.log('[Polling] Stopped unified polling service');
        }
    }
}

export const pollingService = new PollingService();
