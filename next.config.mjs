const isGitHubPages = process.env.GITHUB_PAGES === "true";
const repositoryName = process.env.GITHUB_REPOSITORY?.split("/")[1] ?? "";
const isUserOrOrganizationSite = repositoryName.endsWith(".github.io");
const basePath = isGitHubPages && repositoryName && !isUserOrOrganizationSite
  ? `/${repositoryName}`
  : "";

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  ...(isGitHubPages
    ? {
        output: "export",
        trailingSlash: true,
        basePath,
        images: { unoptimized: true },
      }
    : {}),
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
