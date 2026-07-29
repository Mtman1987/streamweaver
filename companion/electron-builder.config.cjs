const packageJson = require('./package.json');

const build = structuredClone(packageJson.build);
const signingEnabled = process.env.COMPANION_AZURE_SIGNING === 'true';

if (signingEnabled) {
  const required = [
    'COMPANION_SIGNING_ENDPOINT',
    'COMPANION_SIGNING_ACCOUNT',
    'COMPANION_CERTIFICATE_PROFILE',
    'COMPANION_PUBLISHER_NAME',
  ];
  const missing = required.filter((name) => !String(process.env[name] || '').trim());
  if (missing.length) {
    throw new Error(`Missing Companion Artifact Signing configuration: ${missing.join(', ')}`);
  }

  build.win = {
    ...build.win,
    forceCodeSigning: true,
    azureSignOptions: {
      endpoint: process.env.COMPANION_SIGNING_ENDPOINT,
      codeSigningAccountName: process.env.COMPANION_SIGNING_ACCOUNT,
      certificateProfileName: process.env.COMPANION_CERTIFICATE_PROFILE,
      publisherName: process.env.COMPANION_PUBLISHER_NAME,
      fileDigest: 'SHA256',
      timestampDigest: 'SHA256',
      timestampRfc3161: 'http://timestamp.acs.microsoft.com',
    },
  };
}

module.exports = build;
