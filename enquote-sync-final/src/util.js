function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

class RetryableError extends Error {
  constructor(message) {
    super(message);
    this.retryable = true;
  }
}

export { json, RetryableError };
