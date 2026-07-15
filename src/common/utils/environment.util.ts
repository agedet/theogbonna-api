/**
 * True only when running locally (not on an internet-facing deployed host).
 * Used to gate verbose error responses and similar dev-only behavior.
 */
export function isLocalDevelopment(): boolean {
  if (process.env.NODE_ENV === 'production') {
    return false;
  }

  const backendUrl = process.env.BACKEND_URL || '';
  if (!backendUrl) {
    return true;
  }

  try {
    const { hostname } = new URL(backendUrl);
    return hostname === 'localhost' || hostname === '127.0.0.1';
  } catch {
    return false;
  }
}

export function isSwaggerEnabled(): boolean {
  return process.env.NODE_ENV !== 'production';
}