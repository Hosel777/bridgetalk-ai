export interface AudioDeviceLists {
  inputs: MediaDeviceInfo[];
  outputs: MediaDeviceInfo[];
}

export interface AudioDeviceCatalog extends AudioDeviceLists {
  supportsOutputRouting: boolean;
  supportsOutputPermissionPrompt: boolean;
}

interface SelectableMediaDevices extends MediaDevices {
  selectAudioOutput?: () => Promise<MediaDeviceInfo>;
}

export function partitionAudioDevices(
  devices: readonly MediaDeviceInfo[],
): AudioDeviceLists {
  return {
    inputs: devices.filter((device) => device.kind === 'audioinput'),
    outputs: devices.filter((device) => device.kind === 'audiooutput'),
  };
}

export async function enumerateAudioDevices(): Promise<AudioDeviceCatalog> {
  if (
    typeof navigator === 'undefined' ||
    !navigator.mediaDevices?.enumerateDevices
  ) {
    throw new Error(
      'Este navegador no permite enumerar dispositivos de audio. Usa HTTPS o localhost.',
    );
  }

  const devices = await navigator.mediaDevices.enumerateDevices();
  const deviceLists = partitionAudioDevices(devices);
  const supportsOutputRouting =
    typeof HTMLMediaElement !== 'undefined' &&
    typeof HTMLMediaElement.prototype.setSinkId === 'function';
  const mediaDevices = navigator.mediaDevices as SelectableMediaDevices;

  return {
    ...deviceLists,
    supportsOutputRouting,
    supportsOutputPermissionPrompt:
      supportsOutputRouting &&
      typeof mediaDevices.selectAudioOutput === 'function',
  };
}

export async function requestAudioOutputDevice(): Promise<MediaDeviceInfo> {
  const mediaDevices =
    typeof navigator === 'undefined'
      ? undefined
      : (navigator.mediaDevices as SelectableMediaDevices | undefined);
  if (!mediaDevices || typeof mediaDevices.selectAudioOutput !== 'function') {
    throw new Error(
      'Este navegador no permite solicitar permiso para elegir una salida de audio.',
    );
  }

  return mediaDevices.selectAudioOutput();
}

export async function setAudioOutputDevice(
  mediaElement: HTMLMediaElement,
  deviceId: string,
): Promise<void> {
  if (typeof mediaElement.setSinkId !== 'function') {
    throw new Error(
      'Este navegador no permite enrutar el audio a una salida específica.',
    );
  }

  await mediaElement.setSinkId(deviceId);
}
