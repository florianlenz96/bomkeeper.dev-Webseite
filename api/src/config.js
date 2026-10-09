function required(env, name) {
  const value = env[name];
  if (!value) throw new Error(`Missing required setting: ${name}`);
  return value;
}

export function loadConfig(env = process.env) {
  const baseUrl = new URL(required(env, "WAITLIST_BASE_URL"));
  if (baseUrl.username || baseUrl.password || baseUrl.pathname !== "/" || baseUrl.search || baseUrl.hash ||
      (baseUrl.protocol !== "https:" && !(baseUrl.protocol === "http:" && baseUrl.hostname === "localhost"))) {
    throw new Error("WAITLIST_BASE_URL must be an HTTPS origin (or localhost for development)");
  }
  const secret = required(env, "WAITLIST_TOKEN_SECRET");
  if (secret.length < 32) throw new Error("WAITLIST_TOKEN_SECRET must contain at least 32 characters");
  const hourlyEmailLimit = Number(required(env, "WAITLIST_HOURLY_EMAIL_LIMIT"));
  if (!Number.isInteger(hourlyEmailLimit) || hourlyEmailLimit < 1 || hourlyEmailLimit > 1000) {
    throw new Error("WAITLIST_HOURLY_EMAIL_LIMIT must be an integer between 1 and 1000");
  }
  const allowedOrigins = required(env, "WAITLIST_ALLOWED_ORIGINS").split(",").map((value) => value.trim());
  if (!allowedOrigins.includes(baseUrl.origin) || allowedOrigins.some((value) => {
    const url = new URL(value);
    return url.origin !== value || (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "localhost"));
  })) throw new Error("WAITLIST_ALLOWED_ORIGINS must contain valid HTTPS origins including WAITLIST_BASE_URL");
  const emailEnabled = required(env, "WAITLIST_EMAIL_ENABLED");
  if (!["true", "false"].includes(emailEnabled)) throw new Error("WAITLIST_EMAIL_ENABLED must be true or false");
  return {
    baseUrl: baseUrl.origin, secret, hourlyEmailLimit, allowedOrigins,
    emailEnabled: emailEnabled === "true",
    sender: required(env, "WAITLIST_SENDER"),
    storageConnection: required(env, "WAITLIST_STORAGE_CONNECTION_STRING"),
    tableName: required(env, "WAITLIST_TABLE"),
    limitsTableName: required(env, "WAITLIST_LIMITS_TABLE"),
    emailConnection: emailEnabled === "true" ? required(env, "WAITLIST_EMAIL_CONNECTION_STRING") : null,
  };
}
