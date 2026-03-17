/** @type {import('next').NextConfig} */
const nextConfig = {
  output: 'standalone',
  typescript: {
    ignoreBuildErrors: true,
  },
  devIndicators: false,
  turbopack: {},
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
}

module.exports = nextConfig