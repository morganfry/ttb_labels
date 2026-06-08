import { NextResponse, type NextRequest } from "next/server";

/**
 * Optional HTTP Basic Auth gate for the deployed demo.
 *
 * Enabled only when BOTH BASIC_AUTH_USER and BASIC_AUTH_PASSWORD are set, so
 * local dev, tests, and CI stay open; set them in the Render dashboard to lock
 * the public URL. Next.js middleware runs on the Edge runtime, so this uses Web
 * APIs only (atob) — no Node crypto / Buffer.
 *
 * Everything is gated EXCEPT the unauthenticated health check (/api/health) and
 * static assets (see `config.matcher`). The health check must stay open or
 * Render's probe gets a 401 and marks the service unhealthy — point
 * `healthCheckPath` at /api/health when enabling auth.
 */
const USER = process.env.BASIC_AUTH_USER;
const PASS = process.env.BASIC_AUTH_PASSWORD;

/** Length-checked constant-time-ish compare (demo-grade; avoids early-exit on
 *  the matching prefix). Leaks length only, which is acceptable for a gate. */
function safeEqual(a: string, b: string): boolean {
    if (a.length !== b.length) return false;
    let diff = 0;
    for (let i = 0; i < a.length; i++) diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
    return diff === 0;
}

export function middleware(req: NextRequest) {
    if (!USER || !PASS) return NextResponse.next(); // auth disabled unless configured

    const [scheme, encoded] = (req.headers.get("authorization") ?? "").split(" ");
    if (scheme === "Basic" && encoded) {
        let decoded = "";
        try { decoded = atob(encoded); } catch { /* malformed base64 → falls through to 401 */ }
        const sep = decoded.indexOf(":");
        if (sep !== -1 && safeEqual(decoded.slice(0, sep), USER) && safeEqual(decoded.slice(sep + 1), PASS)) {
            return NextResponse.next();
        }
    }
    return new NextResponse("Authentication required.", {
        status: 401,
        headers: { "WWW-Authenticate": 'Basic realm="TTB Label Verification", charset="UTF-8"' },
    });
}

export const config = {
    // Gate all routes except the open health check and static assets.
    matcher: ["/((?!api/health|_next/static|_next/image|favicon.ico).*)"],
};
