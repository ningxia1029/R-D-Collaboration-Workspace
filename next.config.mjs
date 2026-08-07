/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  output: "standalone", // Electron 内嵌：产出自包含 server（含最小 node_modules + server.js）
  transpilePackages: [
    "@uiw/react-md-editor",
    "frappe-gantt",
  ],
  experimental: {
    serverComponentsExternalPackages: ["@prisma/client", "bcryptjs"],
  },
};

export default nextConfig;
