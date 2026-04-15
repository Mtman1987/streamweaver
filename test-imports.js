#!/usr/bin/env node

// Simple test to check if all imports in server.ts work
console.log('Testing imports...');

try {
  console.log('✓ Testing dotenv...');
  require('dotenv').config();
  
  console.log('✓ Testing basic Node modules...');
  require('http');
  require('child_process');
  require('ws');
  
  console.log('✓ Testing local modules...');
  require('./src/lib/config-validator');
  require('./src/constants');
  require('./src/lib/user-config');
  require('./src/lib/port-manager');
  require('./src/lib/process-utils');
  require('./src/lib/local-config/service');
  
  console.log('✅ All imports successful!');
} catch (error) {
  console.error('❌ Import failed:', error.message);
  console.error('Stack:', error.stack);
  process.exit(1);
}