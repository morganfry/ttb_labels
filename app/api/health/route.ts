/**
 * Unauthenticated liveness check for Render's health probe. Returns 200 without
 * touching the DB (a DB blip shouldn't cycle the web service), and is excluded
 * from the Basic Auth middleware (see middleware.ts `config.matcher`) so the
 * probe still succeeds when the public URL is password-protected.
 */
export function GET(): Response {
    return new Response("ok", { status: 200 });
}
