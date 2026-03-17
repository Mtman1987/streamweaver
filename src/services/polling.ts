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
            const now = Date.now();
            
            for (const task of this.tasks) {
                if (now - task.lastRun >= task.interval) {
                    try {
                        await task.fn();
                        task.lastRun = now;
                    } catch (error) {
                        console.error(`[Polling] ${task.name} error:`, error);
                    }
                }
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