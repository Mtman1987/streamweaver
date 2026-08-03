/** @type {import('next').NextConfig} */
const nextConfig = {
  distDir: process.env.NEXT_DIST_DIR || '.next',
  typescript: {
    ignoreBuildErrors: true,
  },
  devIndicators: false,
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
  experimental: {
    // StreamWeaver currently runs Next 15.5, where middleware body cloning uses
    // middlewareClientMaxBodySize. Allow 16 MB GIFs plus multipart overhead.
    middlewareClientMaxBodySize: '20mb',
  },
}

module.exports = nextConfig
