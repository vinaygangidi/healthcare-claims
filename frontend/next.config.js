/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  rewrites: async () => ({
    beforeFiles: [
      {
        source: '/api/:path*',
        destination: 'http://localhost:8002/:path*',
      },
    ],
  }),
};

module.exports = nextConfig;
