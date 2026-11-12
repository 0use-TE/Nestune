/** @type {import('next').NextConfig} */
const config = {
  serverExternalPackages: ['@neteasecloudmusicapienhanced/api'],
  poweredByHeader: false,
  output: 'standalone',
  async headers() {
    return [{ source: '/:path*', headers: [
      { key: 'X-Content-Type-Options', value: 'nosniff' },
      { key: 'Referrer-Policy', value: 'no-referrer' },
      { key: 'X-Frame-Options', value: 'DENY' },
    ] }];
  },
};
export default config;
