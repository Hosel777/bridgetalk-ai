import assert from 'node:assert/strict';
import { test } from 'node:test';
import { partitionAudioDevices } from './audioDeviceService.js';

test('separates input and output devices while ignoring unrelated device kinds', () => {
  const devices: MediaDeviceInfo[] = [
    {
      deviceId: 'mic-1',
      groupId: 'group-1',
      kind: 'audioinput',
      label: 'Microphone',
      toJSON: () => ({}),
    },
    {
      deviceId: 'speaker-1',
      groupId: 'group-2',
      kind: 'audiooutput',
      label: 'Speaker',
      toJSON: () => ({}),
    },
    {
      deviceId: 'camera-1',
      groupId: 'group-3',
      kind: 'videoinput',
      label: 'Camera',
      toJSON: () => ({}),
    },
  ];

  assert.deepEqual(partitionAudioDevices(devices), {
    inputs: [devices[0]],
    outputs: [devices[1]],
  });
});
