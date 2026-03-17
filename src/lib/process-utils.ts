export async function waitForNextJsReady(): Promise<void> {
    return new Promise((resolve, reject) => {
        let attempts = 0;
        const maxAttempts = 20; // Increased attempts
        
        const checkReady = () => {
            attempts++;
            console.log(`[Next.js] Checking readiness... attempt ${attempts}/${maxAttempts}`);
            
            fetch('http://localhost:3100')
                .then(response => {
                    // 200 = OK, 404 = Not Found (but server running), 307 = Redirect (auth)
                    if (response.status === 200 || response.status === 404 || response.status === 307) {
                        console.log('[Next.js] Server is responding!');
                        resolve();
                    } else {
                        throw new Error(`Unexpected status: ${response.status}`);
                    }
                })
                .catch(error => {
                    if (attempts >= maxAttempts) {
                        reject(new Error(`Next.js failed to start: ${error.message}`));
                    } else {
                        setTimeout(checkReady, 3000);
                    }
                });
        };
        checkReady();
    });
}

export async function waitForProcessOutput(process: any, searchText: string, timeout = 90000): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
            console.warn(`[Process] Timeout waiting for "${searchText}", continuing anyway...`);
            resolve();
        }, timeout);
        
        const onData = (data: Buffer) => {
            if (data.toString().includes(searchText)) {
                clearTimeout(timer);
                process.stdout?.removeListener('data', onData);
                process.stderr?.removeListener('data', onData);
                resolve();
            }
        };
        
        process.stdout?.on('data', onData);
        process.stderr?.on('data', onData);
    });
}