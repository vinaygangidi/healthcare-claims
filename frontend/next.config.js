/** @type {import('next').NextConfig} */
const backendUrl = process.env.NEXT_PUBLIC_BACKEND_URL || 'http://localhost:8002';

const nextConfig = {
  reactStrictMode: true,
  rewrites: async () => ({
    beforeFiles: [
      {
        source: '/api/:path*',
        destination: `${backendUrl}/:path*`,
      },
    ],
  }),
};

module.exports = nextConfig;
