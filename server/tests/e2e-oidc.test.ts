import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { spawn, type ChildProcess } from "node:child_process";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";

// End-to-end: spin up the real built binary as a subprocess, hit it over the wire
// with a JWT signed by a local key, exercise cross-project isolation + restart
// persistence + export/import roundtrip.

const KID = "e2e-key";
const AUD = "helm";

function pickPort(): number {
  // 49152-65535 ephemeral range, pick deterministically per test run
  return 49500 + Math.floor(Math.random() * 1000);
}

async function waitForHealth(url: string, attempts = 150): Promise<void> {
  for (let i = 0; i < attempts; i++) {
    try {
      const r = await fetch(`${url}/healthz`);
      if (r.ok) return;
    } catch {
      /* retry */
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error(`helm-server did not come up at ${url}`);
}

describe("e2e: dockerless real binary + OIDC JWT", () => {
  let jwksServer: Server;
  let jwksUrl: string;
  let issuer: string;
  let privateKey: KeyLike;
  let publicJwk: Record<string, unknown>;

  let helmHomeDir: string;
  let port: number;
  let baseUrl: string;
  let child: ChildProcess | null = null;

  async function startHelm(): Promise<void> {
    port = pickPort();
    baseUrl = `http://127.0.0.1:${port}`;
    return new Promise((resolve, reject) => {
      const env: NodeJS.ProcessEnv = {
        ...process.env,
        HELM_HOME: helmHomeDir,
        HELM_HTTP_PORT: String(port),
        HELM_HTTP_HOST: "127.0.0.1",
        HELM_OIDC_ISSUER: issuer,
        HELM_OIDC_AUDIENCE: AUD,
        HELM_OIDC_JWKS_URL: jwksUrl,
        HELM_PUBLIC_URL: `http://127.0.0.1:${port}`,
      };
      delete env.HELM_AUTH_DISABLED;
      delete env.HELM_API_TOKEN;
      child = spawn(process.execPath, ["dist/bin/helm.js", "serve", "--http"], {
        env,
        cwd: process.cwd(),
        stdio: ["ignore", "pipe", "pipe"],
      });
      let stderr = "";
      child.stderr?.on("data", (d) => { stderr += String(d); });
      child.once("error", reject);
      child.once("exit", (code) => {
        if (code !== null && code !== 0) {
          reject(new Error(`helm-server exited with code ${code}\nstderr:\n${stderr}`));
        }
      });
      waitForHealth(baseUrl).then(resolve).catch((err) => reject(new Error(`${err.message}\nstderr:\n${stderr}`)));
    });
  }

  async function stopHelm(): Promise<void> {
    if (!child) return;
    child.kill("SIGTERM");
    await new Promise<void>((resolve) => {
      child!.once("exit", () => resolve());
      setTimeout(() => {
        try { child!.kill("SIGKILL"); } catch { /* */ }
        resolve();
      }, 3000);
    });
    child = null;
  }

  async function mintToken(claims: Record<string, unknown>, sub = "alice"): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(issuer)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("1h")
      .setSubject(sub)
      .sign(privateKey);
  }

  beforeAll(async () => {
    const kp = await generateKeyPair("RS256", { extractable: true });
    privateKey = kp.privateKey;
    publicJwk = (await exportJWK(kp.publicKey)) as Record<string, unknown>;
    publicJwk.kid = KID;
    publicJwk.alg = "RS256";
    publicJwk.use = "sig";

    jwksServer = createServer((req, res) => {
      if (req.url === "/jwks.json") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ keys: [publicJwk] }));
        return;
      }
      res.writeHead(404).end();
    });
    await new Promise<void>((r) => jwksServer.listen(0, "127.0.0.1", () => r()));
    const addr = jwksServer.address();
    const jwksPort = typeof addr === "object" && addr ? addr.port : 0;
    jwksUrl = `http://127.0.0.1:${jwksPort}/jwks.json`;
    issuer = `http://127.0.0.1:${jwksPort}/realms/helm`;

    helmHomeDir = mkdtempSync(join(tmpdir(), "helm-e2e-"));
    port = pickPort();
    baseUrl = `http://127.0.0.1:${port}`;
    await startHelm();
  }, 30000);

  afterAll(async () => {
    await stopHelm();
    rmSync(helmHomeDir, { recursive: true, force: true });
    await new Promise<void>((r) => jwksServer.close(() => r()));
  });

  it("unauthenticated request gets 401 with discovery hint", async () => {
    const res = await fetch(`${baseUrl}/v1/projects`);
    expect(res.status).toBe(401);
    const auth = res.headers.get("www-authenticate") ?? "";
    expect(auth).toContain("resource_metadata");
  });

  it("admin can create two projects; per-claim user is isolated", async () => {
    const admin = await mintToken({ realm_access: { roles: ["helm-admin"] }, preferred_username: "root" }, "sub-root");
    const create = async (slug: string): Promise<Response> =>
      fetch(`${baseUrl}/v1/projects`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${admin}` },
        body: JSON.stringify({ slug, name: slug }),
      });
    expect((await create("alpha")).status).toBe(201);
    expect((await create("beta")).status).toBe(201);

    const alice = await mintToken({ helm_projects: ["alpha"], preferred_username: "alice" }, "sub-alice");
    const okRes = await fetch(`${baseUrl}/v1/projects/alpha/stories`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${alice}` },
      body: JSON.stringify({ title: "alice in alpha" }),
    });
    expect(okRes.status).toBe(201);

    const forbidden = await fetch(`${baseUrl}/v1/projects/beta/stories`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${alice}` },
      body: JSON.stringify({ title: "alice in beta — should fail" }),
    });
    expect(forbidden.status).toBe(403);

    const listAlice = await fetch(`${baseUrl}/v1/projects`, {
      headers: { authorization: `Bearer ${alice}` },
    });
    const body = (await listAlice.json()) as { projects: { slug: string }[] };
    expect(body.projects.map((p) => p.slug)).toEqual(["alpha"]);
  });

  it("state persists across helm-server restart", { timeout: 30000 }, async () => {
    await stopHelm();
    await new Promise((r) => setTimeout(r, 500));
    await startHelm();
    const admin = await mintToken({ realm_access: { roles: ["helm-admin"] }, preferred_username: "root" }, "sub-root");
    const res = await fetch(`${baseUrl}/v1/projects/alpha/stories/backlog`, {
      headers: { authorization: `Bearer ${admin}` },
    });
    const body = (await res.json()) as { stories: { title: string }[] };
    expect(body.stories.map((s) => s.title)).toContain("alice in alpha");
  });

  it("export → wipe → import roundtrip preserves state", { timeout: 30000 }, async () => {
    const admin = await mintToken({ realm_access: { roles: ["helm-admin"] }, preferred_username: "root" }, "sub-root");
    const expRes = await fetch(`${baseUrl}/v1/admin/export`, {
      headers: { authorization: `Bearer ${admin}` },
    });
    expect(expRes.status).toBe(200);
    const dump = (await expRes.json()) as { format: number; projects: { project: { slug: string } }[] };
    expect(dump.format).toBe(1);
    const slugs = dump.projects.map((p) => p.project.slug).sort();
    expect(slugs).toEqual(["alpha", "beta"]);

    // wipe by stopping helm, removing helm.db, restarting
    await stopHelm();
    await new Promise((r) => setTimeout(r, 500));
    rmSync(join(helmHomeDir, "helm.db"), { force: true });
    rmSync(join(helmHomeDir, "helm.db-wal"), { force: true });
    rmSync(join(helmHomeDir, "helm.db-shm"), { force: true });
    await startHelm();

    const empty = await fetch(`${baseUrl}/v1/projects`, { headers: { authorization: `Bearer ${admin}` } });
    expect(((await empty.json()) as { projects: unknown[] }).projects).toHaveLength(0);

    const impRes = await fetch(`${baseUrl}/v1/admin/import`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${admin}` },
      body: JSON.stringify(dump),
    });
    expect(impRes.status).toBe(200);

    const restored = await fetch(`${baseUrl}/v1/projects/alpha/stories/backlog`, {
      headers: { authorization: `Bearer ${admin}` },
    });
    const body = (await restored.json()) as { stories: { title: string }[] };
    expect(body.stories.map((s) => s.title)).toContain("alice in alpha");
  });
});
