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
    // Discord lane GIFs can legitimately exceed Next's 10 MB cloned-body default.
    // The route still enforces a 60 MB file limit, leaving multipart overhead here.
    middlewareClientMaxBodySize: '64mb',
  },
}

module.exports = nextConfig
