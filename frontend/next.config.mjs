/** @type {import('next').NextConfig} */
const nextConfig = {
  output: process.env.NODE_ENV === 'production' ? 'standalone' : undefined,
  reactStrictMode: false,
  typescript: {
    ignoreBuildErrors: true,
  },
  images: {
    unoptimized: true,
  },
  experimental: {
    proxyTimeout: 600_000,
  },
  async headers() {
    return [
      {
        // Prevent Cloudflare from caching any page or API response that could
        // contain user-specific data. Static assets (_next/static) are excluded
        // so they remain cacheable at the CDN edge.
        source: '/((?!_next/static|_next/image|favicon.ico).*)',
        headers: [
          { key: 'Cache-Control', value: 'no-store, no-cache, must-revalidate, private' },
          { key: 'Pragma', value: 'no-cache' },
        ],
      },
    ];
  },
  async rewrites() {
    const backendUrl = process.env.BACKEND_URL || 'http://localhost:8000';
    return [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
      {
        source: '/uploads/:path*',
        destination: `${backendUrl}/uploads/:path*`,
      },
    ];
  },
webpack: (config) => {
  config.resolve.alias.canvas = false;
  config.module.rules.push({
    test: /node_modules\/pdfjs-dist/,
    type: "javascript/auto",
  });
  return config;
},
}

export default nextConfig
