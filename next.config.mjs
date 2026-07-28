const isGitHubPages = process.env.GITHUB_PAGES === "true";
const isSitesStaticExport = process.env.SITES_STATIC_EXPORT === "true";
const isStaticExport = isGitHubPages || isSitesStaticExport;
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isUserOrOrganizationSite = repositoryName.endsWith(".github.io");
const basePath = isGitHubPages && repositoryName && !isUserOrOrganizationSite
  ? `/${repositoryName}`
  : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isStaticExport
    ? {
        output: "export",
        trailingSlash: true,
        images: { unoptimized: true },
      }
    : {}),
  ...(isGitHubPages ? { basePath } : {}),
  ...(isSitesStaticExport && !isGitHubPages ? { distDir: "dist" } : {}),
  env: {
    NEXT_PUBLIC_BASE_PATH: basePath,
  },
  webpack: (config) => {
    config.watchOptions = {
      poll: 1000,
      ignored: [
        "**/.next/**",
        "**/node_modules/**",
        "**/.git/**",
        "**/.turbo/**",
      ],
    };

    return config;
  },
};

export default nextConfig;
