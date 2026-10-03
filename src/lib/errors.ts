/** Thrown when required server configuration (e.g. SERPAPI_KEY) is missing. */
export class ConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR";

  constructor(message = "Server is missing required configuration.") {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Thrown when an upstream provider (e.g. SerpApi) request fails. */
export class UpstreamError extends Error {
  readonly code = "UPSTREAM_ERROR";
  readonly status?: number;

  constructor(message = "Upstream provider request failed.", status?: number) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
  }
}

/** Thrown when incoming request data fails validation. */
export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR";

  constructor(message = "Request validation failed.") {
    super(message);
    this.name = "ValidationError";
  }
}
