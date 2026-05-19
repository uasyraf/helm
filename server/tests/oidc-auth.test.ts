import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer, type Server } from "node:http";
import { execFileSync } from "node:child_process";
import { exportJWK, generateKeyPair, SignJWT, type KeyLike } from "jose";

import { openDb, type DbHandle } from "../src/db/client.js";
import { makeSqliteRepo } from "../src/db/repo-sqlite.js";
import { bootstrapSession } from "../src/project/bootstrap.js";
import { buildRestApp } from "../src/http/rest/app.js";
import { buildJwks, buildJwtMiddleware, readOidcSettings } from "../src/http/rest/oidc.js";

const ISS = "http://127.0.0.1:0/realms/helm";
const AUD = "helm";
const KID = "test-key-1";

function makeGitRepo(remote: string, dir: string): void {
  execFileSync("git", ["init", "-q"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "t@helm.local"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "T"], { cwd: dir });
  execFileSync("git", ["remote", "add", "origin", remote], { cwd: dir });
}

describe("OIDC JWT middleware", () => {
  let jwksServer: Server;
  let jwksUrl: string;
  let issuer: string;
  let privateKey: KeyLike;
  let publicJwk: Record<string, unknown>;

  let home: string;
  let handle: DbHandle;
  let dirA: string;
  let dirB: string;
  let slugA: string;
  let slugB: string;
  let app: ReturnType<typeof buildRestApp>;

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
    const port = typeof addr === "object" && addr ? addr.port : 0;
    jwksUrl = `http://127.0.0.1:${port}/jwks.json`;
    issuer = `http://127.0.0.1:${port}/realms/helm`;
  });

  afterAll(async () => {
    await new Promise<void>((r) => jwksServer.close(() => r()));
  });

  beforeEach(async () => {
    home = mkdtempSync(join(tmpdir(), "helm-oidc-"));
    process.env.HELM_HOME = home;
    handle = await openDb(join(home, "oidc.db"));
    const repo = makeSqliteRepo(handle.db);
    dirA = mkdtempSync(join(tmpdir(), "helm-oidc-a-"));
    dirB = mkdtempSync(join(tmpdir(), "helm-oidc-b-"));
    makeGitRepo("git@github.com:acme/alpha.git", dirA);
    makeGitRepo("git@github.com:acme/beta.git", dirB);
    const sa = await bootstrapSession(repo, dirA);
    const sb = await bootstrapSession(repo, dirB);
    slugA = sa.project.slug;
    slugB = sb.project.slug;

    const settings = {
      issuer,
      audience: AUD,
      jwksUrl,
      projectsClaim: "helm_projects",
      adminRole: "helm-admin",
      rolesClaimPath: ["realm_access", "roles"],
      resourceUrl: "http://127.0.0.1:4500",
      required: true,
    };
    app = buildRestApp({
      repo,
      authMiddleware: buildJwtMiddleware({ settings, jwks: buildJwks(settings) }),
      oauthMetadata: () => ({
        resource: "http://127.0.0.1:4500",
        authorization_servers: [issuer],
        bearer_methods_supported: ["header"],
      }),
    });
  });

  afterEach(() => {
    handle.client.close();
    rmSync(home, { recursive: true, force: true });
    rmSync(dirA, { recursive: true, force: true });
    rmSync(dirB, { recursive: true, force: true });
  });

  async function mintToken(claims: Record<string, unknown>): Promise<string> {
    return new SignJWT(claims)
      .setProtectedHeader({ alg: "RS256", kid: KID })
      .setIssuer(issuer)
      .setAudience(AUD)
      .setIssuedAt()
      .setExpirationTime("1h")
      .setSubject("user-alice")
      .sign(privateKey);
  }

  it("returns 401 + WWW-Authenticate when no token", async () => {
    const res = await app.request(`/v1/projects/${slugA}/status`);
    expect(res.status).toBe(401);
    const auth = res.headers.get("www-authenticate") ?? "";
    expect(auth).toContain("Bearer");
    expect(auth).toContain("resource_metadata");
  });

  it("returns 401 on invalid token", async () => {
    const res = await app.request(`/v1/projects/${slugA}/status`, {
      headers: { authorization: "Bearer nope" },
    });
    expect(res.status).toBe(401);
    expect(res.headers.get("www-authenticate")).toContain('error="invalid_token"');
  });

  it("allows access to a project listed in helm_projects claim", async () => {
    const token = await mintToken({ helm_projects: [slugA], preferred_username: "alice" });
    const res = await app.request(`/v1/projects/${slugA}/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("returns 403 when target project not in claim", async () => {
    const token = await mintToken({ helm_projects: [slugA], preferred_username: "alice" });
    const res = await app.request(`/v1/projects/${slugB}/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(403);
  });

  it("helm-admin role bypasses project filter", async () => {
    const token = await mintToken({
      helm_projects: [],
      realm_access: { roles: ["helm-admin"] },
      preferred_username: "root",
    });
    const res = await app.request(`/v1/projects/${slugB}/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("string-form claim is also accepted", async () => {
    const token = await mintToken({ helm_projects: `${slugA} ${slugB}`, preferred_username: "alice" });
    const res = await app.request(`/v1/projects/${slugB}/status`, {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
  });

  it("/healthz remains unauthenticated", async () => {
    const res = await app.request("/healthz");
    expect(res.status).toBe(200);
  });

  it("/.well-known/oauth-protected-resource serves discovery", async () => {
    const res = await app.request("/.well-known/oauth-protected-resource");
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authorization_servers: string[] };
    expect(body.authorization_servers[0]).toBe(issuer);
  });

  it("readOidcSettings returns null when HELM_AUTH_DISABLED=1", () => {
    const s = readOidcSettings({ HELM_AUTH_DISABLED: "1", HELM_OIDC_ISSUER: "x", HELM_OIDC_AUDIENCE: "y" });
    expect(s).toBeNull();
  });

  it("readOidcSettings returns null when issuer or audience missing", () => {
    expect(readOidcSettings({})).toBeNull();
    expect(readOidcSettings({ HELM_OIDC_ISSUER: "x" })).toBeNull();
  });
});
