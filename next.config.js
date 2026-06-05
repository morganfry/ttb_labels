/** @type {import('next').NextConfig} */
const nextConfig = {
    output: "standalone",
    serverExternalPackages: ["pdf-lib"],
};
module.exports = nextConfig;
