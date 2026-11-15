import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  getAudioWebSocketUrl,
  hasVoiceActivity,
  shouldSendAudioChunk,
} from './audioStreamService.js';

test('uses a configured HTTPS backend as a secure audio WebSocket', () => {
  assert.equal(
    getAudioWebSocketUrl('https://api.example.com/'),
    'wss://api.example.com/audio',
  );
});

test('falls back to the current browser host when no backend is configured', () => {
  assert.equal(
    getAudioWebSocketUrl('', {
      protocol: 'https:',
      host: 'app.example.com',
    }),
    'wss://app.example.com/audio',
  );
});

test('rejects a configured backend URL that is not HTTP or HTTPS', () => {
  assert.throws(
    () => getAudioWebSocketUrl('ftp://api.example.com'),
    /must use http:\/\/ or https:\/\//,
  );
});

test('does not classify a near-silent signal as voice', () => {
  assert.equal(hasVoiceActivity(new Uint8Array([127, 128, 129, 128])), false);
});

test('classifies a signal above the RMS threshold as voice', () => {
  assert.equal(hasVoiceActivity(new Uint8Array([90, 166, 88, 168])), true);
});

test('does not classify an empty signal as voice', () => {
  assert.equal(hasVoiceActivity(new Uint8Array()), false);
});

test('does not send a nonempty audio chunk when no voice was detected', () => {
  assert.equal(shouldSendAudioChunk(true, false), false);
});

test('sends a nonempty audio chunk when voice was detected', () => {
  assert.equal(shouldSendAudioChunk(true, true), true);
});

test('never sends an empty audio chunk even when voice was detected', () => {
  assert.equal(shouldSendAudioChunk(false, true), false);
});
