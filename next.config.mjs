/** @type {import('next').NextConfig} */
const nextConfig = {
  // Static export for Tauri (`frontendDist` → `out/` in tauri.conf.json)
  output: 'export',
  typescript: {
    ignoreBuildErrors: false,
  },
  images: {
    // Required when using `output: 'export'` with next/image
    unoptimized: true,
  },
}

export default nextConfig
