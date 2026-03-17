#!/usr/bin/env node
/**
 * Import Streamer.bot Actions and Commands
 * Usage: npm run import-streamerbot
 */

import { importFromDesktop } from '../src/services/streamerbot-importer';

async function main() {
  try {
    await importFromDesktop();
    process.exit(0);
  } catch (error) {
    console.error('Import failed:', error);
    process.exit(1);
  }
}

main();
