/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  reactStrictMode: false,  // prevents double useEffect calls in dev
  // Load .env from the monorepo root instead of frontend/
  envDir: '..',
  experimental: {
    proxyTimeout: 600_000, // 10 min — AI processing can take several minutes
  },
  async rewrites() {
    // BACKEND_URL is a server-only env var (no NEXT_PUBLIC_ prefix).
    // Dev / ngrok:  leave unset → defaults to http://localhost:8000
    // Docker:       set BACKEND_URL=http://backend:8000 in docker-compose env
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ];
  },
};
module.exports = nextConfig;
