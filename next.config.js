/** @type {import('next').NextConfig} */

// Because this app ships a middleware (the Basic Auth gate in middleware.ts),
// Next clones every request body so middleware *could* read it — and that clone
// is capped at 10 MB by default, silently TRUNCATING larger uploads before they
// reach the route. The cut-off multipart then makes /api/verify and
// /api/verify-csv's formData() parse throw ("Expected multipart/form-data").
// Our middleware never reads the body, but the cap applies regardless. Raise it
// to the same ceiling the routes already enforce via Content-Length, mirroring
// UPLOAD_MAX_BYTES in lib/config.ts so the two stay in lockstep.
const UPLOAD_MAX_BYTES = Number(process.env.UPLOAD_MAX_BYTES) || 256 * 1024 * 1024;

const nextConfig = {
    output: "standalone",
    // mupdf is ESM+WASM, sharp is native — both must stay external, not bundled.
    serverExternalPackages: ["pdf-lib", "mupdf", "sharp"],
    experimental: {
        middlewareClientMaxBodySize: UPLOAD_MAX_BYTES,
    },
};
module.exports = nextConfig;
