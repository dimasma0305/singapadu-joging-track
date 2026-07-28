import {
  access,
  copyFile,
  mkdir,
  readdir,
  rm,
  writeFile,
} from "node:fs/promises";
import { constants } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

if (process.env.GITHUB_PAGES === "true") {
  console.log("Skipping Sites bundle preparation for GitHub Pages.");
  process.exit(0);
}

const projectRoot = process.cwd();
const distDirectory = path.join(projectRoot, "dist");
const clientDirectory = path.join(distDirectory, "client");
const serverDirectory = path.join(distDirectory, "server");
const metadataDirectory = path.join(distDirectory, ".openai");
const clientEntry = path.join(clientDirectory, "index.html");
const serverEntry = path.join(serverDirectory, "index.js");
const sourceHostingConfig = path.join(projectRoot, ".openai", "hosting.json");
const outputHostingConfig = path.join(metadataDirectory, "hosting.json");

await access(clientEntry, constants.R_OK);
await access(sourceHostingConfig, constants.R_OK);

for (const entry of await readdir(distDirectory, { withFileTypes: true })) {
  if (entry.name !== "client") {
    await rm(path.join(distDirectory, entry.name), {
      recursive: entry.isDirectory(),
      force: true,
    });
  }
}

await mkdir(serverDirectory, { recursive: true });
await mkdir(metadataDirectory, { recursive: true });

const workerSource = `const worker = {
  async fetch(request, env) {
    const assets = env?.ASSETS;

    if (!assets || typeof assets.fetch !== "function") {
      return new Response("Static asset binding is unavailable.", {
        status: 503,
        headers: { "content-type": "text/plain; charset=utf-8" },
      });
    }

    if (request.method !== "GET" && request.method !== "HEAD") {
      return new Response("Method Not Allowed", {
        status: 405,
        headers: { allow: "GET, HEAD" },
      });
    }

    const assetUrl = new URL(request.url);
    if (assetUrl.pathname.endsWith("/")) {
      assetUrl.pathname += "index.html";
    }

    const assetResponse = await assets.fetch(new Request(assetUrl, request));
    if (assetResponse.status !== 404) {
      return assetResponse;
    }

    const notFoundUrl = new URL("/404.html", request.url);
    const notFoundResponse = await assets.fetch(
      new Request(notFoundUrl, request),
    );

    return new Response(
      request.method === "HEAD" ? null : notFoundResponse.body,
      {
        status: 404,
        headers: notFoundResponse.headers,
      },
    );
  },
};

export default worker;
`;

await writeFile(serverEntry, workerSource, "utf8");
await copyFile(sourceHostingConfig, outputHostingConfig);

const workerModule = await import(
  `${pathToFileURL(serverEntry).href}?build=${Date.now()}`
);

if (
  !workerModule.default ||
  typeof workerModule.default.fetch !== "function"
) {
  throw new Error("Sites Worker entrypoint must export a default fetch handler.");
}

console.log("Prepared Sites Worker bundle in dist/.");
