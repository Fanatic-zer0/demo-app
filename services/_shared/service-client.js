// Minimal service-to-service HTTP client used for real inter-service orchestration.
// Propagates the caller's trace id so a request can be correlated across every hop.
async function callService(baseUrl, path, { method = 'GET', body, traceId, timeoutMs = 5000 } = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(traceId ? { 'x-trace-id': traceId } : {})
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal: controller.signal
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      const error = new Error(data.error || `upstream_error_${response.status}`);
      error.statusCode = response.status >= 400 && response.status < 500 ? response.status : 502;
      error.upstream = data;
      throw error;
    }

    return data;
  } catch (error) {
    if (error.name === 'AbortError') {
      const timeoutError = new Error(`Upstream call to ${baseUrl}${path} timed out after ${timeoutMs}ms`);
      timeoutError.statusCode = 504;
      timeoutError.code = 'upstream_timeout';
      throw timeoutError;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { callService };
