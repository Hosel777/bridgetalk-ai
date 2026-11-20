const LOCAL_BACKEND_URL = 'http://localhost:3001';

export function getBackendBaseUrl(
  backendUrl: string | undefined = import.meta.env?.VITE_BACKEND_URL,
  isDevelopment = import.meta.env?.DEV === true,
): string {
  const configuredBackendUrl = backendUrl?.trim();
  if (!configuredBackendUrl) {
    if (isDevelopment) {
      return LOCAL_BACKEND_URL;
    }
    throw new Error('VITE_BACKEND_URL must be configured for this environment.');
  }

  let parsedBackendUrl: URL;
  try {
    parsedBackendUrl = new URL(configuredBackendUrl);
  } catch {
    throw new Error('VITE_BACKEND_URL must be a valid URL.');
  }
  if (
    parsedBackendUrl.protocol !== 'http:' &&
    parsedBackendUrl.protocol !== 'https:'
  ) {
    throw new Error('VITE_BACKEND_URL must use http:// or https://.');
  }

  return configuredBackendUrl.replace(/\/+$/, '');
}

export function getBackendUrl(
  path: string,
  backendUrl?: string,
): string {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`;
  return `${getBackendBaseUrl(backendUrl)}${normalizedPath}`;
}
