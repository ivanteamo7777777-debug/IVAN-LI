const OAUTH_AUTHORIZATION_ID = /^[A-Za-z0-9_-]{16,256}$/;

/**
 * Supabase authorization IDs are opaque URL-safe tokens. They are not
 * guaranteed to be UUIDs, so validate their shape without assuming a format.
 */
export function isValidAuthorizationId(
  value: FormDataEntryValue | null | undefined,
): value is string {
  return typeof value === "string" && OAUTH_AUTHORIZATION_ID.test(value);
}
