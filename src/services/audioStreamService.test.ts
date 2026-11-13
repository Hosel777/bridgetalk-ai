import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  hasVoiceActivity,
  shouldSendAudioChunk,
} from './audioStreamService.js';

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
