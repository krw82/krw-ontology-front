import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { createServer, request as createUpstreamRequest } from "node:http";
import path from "node:path";

const root = process.cwd();
const distDir = ".next-e2e";
const port = Number(process.env.E2E_PORT ?? 3210);
const upstreamPort = Number(process.env.E2E_UPSTREAM_PORT ?? port + 1);
const appVersion = `e2e-${Date.now()}`;
const e2eAuthToken = randomBytes(32).toString("hex");
const e2eEnv = {
  ...process.env,
  DEV_AUTH_BYPASS: "1",
  KRW_E2E_STATIC_CATALOG: "1",
  KRW_E2E_STATIC_PULSE: "1",
  KRW_E2E_PRODUCTION_AUTH_BYPASS: "1",
  KRW_E2E_SERVER_BIND: "127.0.0.1",
  KRW_E2E_AUTH_TOKEN: e2eAuthToken,
  NEXT_PUBLIC_KRW_E2E_BILLING_FIXTURE: "1",
  NEXT_DIST_DIR: distDir,
  NEXT_PUBLIC_APP_VERSION: appVersion,
  TRUSTED_CLIENT_IP_HEADER: "x-krw-client-ip",
};

function findStandaloneServer(directory) {
  const directServerPath = path.join(directory, "server.js");
  if (existsSync(directServerPath)) {
    return directServerPath;
  }

  const directories = [directory];
  while (directories.length > 0) {
    const currentDirectory = directories.shift();
    if (!currentDirectory) {
      continue;
    }

    for (const entry of readdirSync(currentDirectory, { withFileTypes: true })) {
      if (entry.name === "node_modules") {
        continue;
      }

      const entryPath = path.join(currentDirectory, entry.name);
      if (entry.isFile() && entry.name === "server.js") {
        return entryPath;
      }
      if (entry.isDirectory()) {
        directories.push(entryPath);
      }
    }
  }

  throw new Error("Next standalone server.js was not generated.");
}

rmSync(path.join(root, distDir), { recursive: true, force: true });

const build = spawnSync(
  process.platform === "win32" ? "npx.cmd" : "npx",
  ["next", "build", "--webpack"],
  {
    cwd: root,
    env: e2eEnv,
    stdio: "inherit",
  },
);

if (build.status !== 0) {
  process.exit(build.status ?? 1);
}

const standaloneRoot = path.join(root, distDir, "standalone");
const standaloneServerPath = findStandaloneServer(standaloneRoot);
const standaloneAppRoot = path.dirname(standaloneServerPath);
const standaloneDistRoot = path.join(standaloneAppRoot, distDir);
mkdirSync(standaloneDistRoot, { recursive: true });
cpSync(path.join(root, "public"), path.join(standaloneAppRoot, "public"), {
  recursive: true,
});
cpSync(
  path.join(root, distDir, "static"),
  path.join(standaloneDistRoot, "static"),
  { recursive: true },
);

const server = spawn(
  process.execPath,
  [standaloneServerPath],
  {
    cwd: standaloneAppRoot,
    env: {
      ...e2eEnv,
      HOSTNAME: "127.0.0.1",
      PORT: String(upstreamPort),
    },
    stdio: "inherit",
  },
);

// Browser-managed requests such as a service-worker script fetch do not carry
// Playwright's extraHTTPHeaders. A loopback-only reverse proxy mirrors the
// production Caddy boundary and overwrites both trusted headers for every
// request. The backend port is never exposed beyond loopback.
const proxyServer = createServer((incomingRequest, outgoingResponse) => {
  const upstreamRequest = createUpstreamRequest(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: incomingRequest.method,
      path: incomingRequest.url,
      headers: {
        ...incomingRequest.headers,
        "x-krw-client-ip": "127.0.0.1",
        "x-krw-e2e-auth": e2eAuthToken,
      },
    },
    (upstreamResponse) => {
      outgoingResponse.writeHead(
        upstreamResponse.statusCode ?? 502,
        upstreamResponse.headers,
      );
      upstreamResponse.pipe(outgoingResponse);
    },
  );

  upstreamRequest.on("error", () => {
    if (!outgoingResponse.headersSent) {
      outgoingResponse.writeHead(502, {
        "Content-Type": "text/plain; charset=utf-8",
        "Cache-Control": "no-store",
      });
    }
    outgoingResponse.end("E2E upstream is not ready.");
  });
  incomingRequest.pipe(upstreamRequest);
});

proxyServer.listen(port, "127.0.0.1");

let shutdownRequested = false;
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => {
    shutdownRequested = true;
    proxyServer.close();
    if (server.exitCode === null && server.signalCode === null) {
      server.kill(signal);
    }
  });
}

server.on("exit", (code) => {
  proxyServer.close(() => {
    process.exit(code ?? (shutdownRequested ? 0 : 1));
  });
});

proxyServer.on("error", () => {
  if (server.exitCode === null && server.signalCode === null) {
    server.kill("SIGTERM");
  }
  process.exit(1);
});
