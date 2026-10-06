/** Thrown when required server configuration (e.g. SERPAPI_KEY) is missing. */
export class ConfigurationError extends Error {
  readonly code: string = "CONFIGURATION_ERROR";

  constructor(message = "Server is missing required configuration.") {
    super(message);
    this.name = "ConfigurationError";
  }
}

/** Thrown when an upstream provider (e.g. SerpApi) request fails. */
export interface UpstreamErrorDetails {
  /** HTTP status returned by the provider, when the request reached it. */
  httpStatus?: number;
  /**
   * Sanitized provider error text. Safe by construction: the API key value
   * is redacted before storage, length-capped, and never includes URLs.
   */
  providerError?: string;
}

export class UpstreamError extends Error {
  readonly code = "UPSTREAM_ERROR";
  readonly status?: number;
  readonly details?: UpstreamErrorDetails;

  constructor(
    message = "Upstream provider request failed.",
    status?: number,
    details?: UpstreamErrorDetails,
  ) {
    super(message);
    this.name = "UpstreamError";
    this.status = status;
    this.details = details;
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

/**
 * Thrown when an optional capability has no configured provider.
 * A ConfigurationError subtype so existing config-error handling applies.
 */
export class VisionNotConfiguredError extends ConfigurationError {
  readonly code = "VISION_NOT_CONFIGURED";

  constructor(
    message = "Visual place identification is currently unavailable because no vision provider is configured.",
  ) {
    super(message);
    this.name = "VisionNotConfiguredError";
  }
}

/** Thrown when a request conflicts with current server-side state (HTTP 409). */
export class ConflictError extends Error {
  readonly code = "CONFLICT";

  constructor(message = "Request conflicts with the current state.") {
    super(message);
    this.name = "ConflictError";
  }
}
