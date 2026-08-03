const packageJson = require('./package.json');

// Electron Builder produces the unsigned NSIS installer. The trusted GitHub
// build artifact is then submitted to SignPath, which holds the certificate
// and returns the Authenticode-signed installer. No certificate or signing
// credentials are ever available to the application build itself.
module.exports = structuredClone(packageJson.build);
