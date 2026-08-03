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
    // Discord lane GIFs may be up to 16 MB. Allow multipart overhead while
    // leaving the route-level file validation as the final authority.
    proxyClientMaxBodySize: '20mb',
  },
}

module.exports = nextConfig
