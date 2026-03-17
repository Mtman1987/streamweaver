// Configuration validation utility
export interface ConfigValidationResult {
    isValid: boolean;
    errors: string[];
    warnings: string[];
}

export function validateConfiguration(): ConfigValidationResult {
    const errors: string[] = [];
    const warnings: string[] = [];

    // Check critical environment variables
    const requiredVars = [
        'TWITCH_CLIENT_ID',
        'TWITCH_CLIENT_SECRET'
    ];

    const optionalVars = [
        'DISCORD_BOT_TOKEN',
        'GEMINI_API_KEY'
    ];

    // Check required variables
    for (const varName of requiredVars) {
        if (!process.env[varName]) {
            errors.push(`Missing required environment variable: ${varName}`);
        }
    }

    // Check optional variables and warn if missing
    for (const varName of optionalVars) {
        if (!process.env[varName]) {
            warnings.push(`Optional environment variable not set: ${varName}`);
        }
    }

    // Validate port numbers
    const ports = ['WS_PORT', 'PORT', 'GENKIT_PORT'];
    for (const portVar of ports) {
        const portValue = process.env[portVar];
        if (portValue) {
            const port = parseInt(portValue, 10);
            if (isNaN(port) || port < 1 || port > 65535) {
                errors.push(`Invalid port number for ${portVar}: ${portValue}`);
            }
        }
    }

    return {
        isValid: errors.length === 0,
        errors,
        warnings
    };
}