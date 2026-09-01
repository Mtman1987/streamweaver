'use strict';

const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const {
  DEFAULT_PHRASE,
  cleanWakePhrase,
  decodeWakeLine,
  powershellWakeScript,
} = require('../lib/local-athena-wake.cjs');

function source(relative) {
  return fs.readFileSync(path.join(__dirname, '..', '..', relative), 'utf8');
}

test('Windows wake listener is local-only and constrained to Hey Athena', () => {
  const script = powershellWakeScript(DEFAULT_PHRASE);
  assert.equal(cleanWakePhrase('HEY   ATHENA'), 'hey athena');
  assert.equal(cleanWakePhrase('anything else'), 'hey athena');
  assert.match(script, /System\.Speech/);
  assert.match(script, /SpeechRecognitionEngine/);
  assert.match(script, /SetInputToDefaultAudioDevice/);
  assert.match(script, /hey athena/i);
  assert.match(script, /AppendDictation/);
  assert.doesNotMatch(script, /https?:\/\//i);
  assert.doesNotMatch(script, /Invoke-WebRequest|Invoke-RestMethod|fetch\s*\(/i);
});

test('wake subprocess protocol only emits decoded local transcripts', () => {
  assert.deepEqual(decodeWakeLine('SPMT_WAKE_READY'), { type: 'ready' });
  const transcript = 'Hey Athena tell me something';
  const encoded = Buffer.from(transcript).toString('base64');
  assert.deepEqual(decodeWakeLine(`SPMT_WAKE\t${encoded}`), { type: 'wake', transcript });
  const error = Buffer.from('offline recognizer missing').toString('base64');
  assert.deepEqual(decodeWakeLine(`SPMT_WAKE_ERROR\t${error}`), { type: 'error', message: 'offline recognizer missing' });
});

test('Companion build patch delivers local wake to HearMeOut without cloud STT', () => {
  const patch = source('scripts/patch-companion-local-athena-wake.mjs');
  assert.match(patch, /spmt-companion-athena-command/);
  assert.match(patch, /windows-companion-local/);
  assert.match(patch, /findActiveHearMeOutRoomWindow/);
  assert.match(patch, /executeJavaScript/);
  assert.match(patch, /localOnly:\s*true/);
  assert.match(patch, /wake-enabled/);
  assert.doesNotMatch(patch, /persona-transcribe|speech\/transcribe|EDENAI|Google Speech/i);
});
