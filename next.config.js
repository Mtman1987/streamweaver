/** @type {import('next').NextConfig} */
const nextConfig = {
  typescript: {
    ignoreBuildErrors: true,
  },
  devIndicators: false,
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
}

module.exports = nextConfig