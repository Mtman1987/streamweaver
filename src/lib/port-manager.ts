import { TIMEOUTS } from '../constants';
import { exec } from 'child_process';
import { promisify } from 'util';
import net from 'net';

const execAsync = promisify(exec);

export class PortManager {
    private static instance: PortManager;
    private usedPorts: Set<number> = new Set();

    static getInstance(): PortManager {
        if (!PortManager.instance) {
            PortManager.instance = new PortManager();
        }
        return PortManager.instance;
    }

    async isPortInUse(port: number): Promise<boolean> {
        return new Promise((resolve) => {
            const server = net.createServer();
            server.listen(port, () => {
                server.once('close', () => resolve(false));
                server.close();
            });
            server.on('error', () => resolve(true));
        });
    }

    async findAvailablePort(startPort: number, maxAttempts: number = 10): Promise<number> {
        for (let i = 0; i < maxAttempts; i++) {
            const port = startPort + i;
            if (!(await this.isPortInUse(port))) {
                this.usedPorts.add(port);
                return port;
            }
        }
        throw new Error(`No available port found starting from ${startPort}`);
    }

    async killProcessOnPort(port: number): Promise<void> {
        const timeout = TIMEOUTS.PORT_CLEANUP;
        const timeoutPromise = new Promise<void>((_, reject) => {
            setTimeout(() => reject(new Error(`Timeout killing processes on port ${port}`)), timeout);
        });
        
        const killPromise = this.doKillProcessOnPort(port);
        
        try {
            await Promise.race([killPromise, timeoutPromise]);
        } catch (error) {
            console.error(`[PortManager] Error killing processes on port ${port}:`, error);
        }
    }
    
    private async doKillProcessOnPort(port: number): Promise<void> {
        try {
            if (process.platform === 'win32') {
                // Windows - check if port is actually in use first
                const { stdout } = await execAsync(`netstat -ano | findstr :${port}`);
                if (!stdout.trim()) {
                    console.log(`[PortManager] Port ${port} is not in use`);
                    return;
                }
                
                const lines = stdout.split('\n').filter(line => line.includes(`${port}`));
                
                for (const line of lines) {
                    const parts = line.trim().split(/\s+/);
                    const pid = parts[parts.length - 1];
                    if (pid && !isNaN(parseInt(pid)) && parseInt(pid) !== process.pid) {
                        try {
                            await execAsync(`taskkill /F /PID ${pid}`);
                            console.log(`[PortManager] Killed process ${pid} on port ${port}`);
                        } catch (error) {
                            console.log(`[PortManager] Process ${pid} already terminated`);
                        }
                    }
                }
            } else {
                // Unix/Linux/macOS
                const { stdout } = await execAsync(`lsof -ti:${port}`);
                const pids = stdout.trim().split('\n').filter(pid => pid && parseInt(pid) !== process.pid);
                
                for (const pid of pids) {
                    try {
                        await execAsync(`kill -9 ${pid}`);
                        console.log(`[PortManager] Killed process ${pid} on port ${port}`);
                    } catch (error) {
                        console.log(`[PortManager] Process ${pid} already terminated`);
                    }
                }
            }
        } catch (error) {
            console.log(`[PortManager] No processes found on port ${port}`);
        }
    }

    async cleanupPorts(ports: number[]): Promise<void> {
        console.log(`[PortManager] Cleaning up ports: ${ports.join(', ')}`);
        
        for (const port of ports) {
            if (await this.isPortInUse(port)) {
                await this.killProcessOnPort(port);
                // Wait a bit for the port to be released
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }

    async getPortFromEnv(envVar: string, defaultPort: number): Promise<number> {
        const envPort = process.env[envVar];
        const preferredPort = envPort ? parseInt(envPort, 10) : defaultPort;
        
        if (await this.isPortInUse(preferredPort)) {
            console.log(`[PortManager] Port ${preferredPort} is in use, finding alternative...`);
            return await this.findAvailablePort(preferredPort);
        }
        
        this.usedPorts.add(preferredPort);
        return preferredPort;
    }

    releasePort(port: number): void {
        this.usedPorts.delete(port);
    }

    async gracefulShutdown(): Promise<void> {
        console.log('[PortManager] Starting graceful shutdown...');
        const ports = Array.from(this.usedPorts);
        await this.cleanupPorts(ports);
        this.usedPorts.clear();
    }
}