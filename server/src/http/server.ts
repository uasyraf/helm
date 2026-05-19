import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";
import { getRequestListener } from "@hono/node-server";
import type { JWTPayload, JWTVerifyGetKey } from "jose";
import { jwtVerify } from "jose";
import { buildServer, openSharedRepo, type ServerHandle } from "../server.js";
import { bootstrapSession, pendingSession, type SessionIdentity } from "../project/bootstrap.js";
import type { HelmRepo, RepoHandle } from "../db/repo.js";
import type { RestActor } from "./rest/context.js";
import { buildRestApp } from "./rest/app.js";
import {
  actorFromPayload,
  buildChallenge,
  buildJwks,
  buildJwtMiddleware,
  oauthMetadata,
  readOidcSettings,
  type OidcSettings,
} from "./rest/oidc.js";

export interface HttpServerOptions {
  host?: string;
  port?: number;
  apiToken?: string;
  cwd?: string;
}

interface Session {
  transport: StreamableHTTPServerTransport;
  serverHandle: ServerHandle;
}

interface McpContext {
  apiToken: string | undefined;
  cwd: string;
  sessions: Map<string, Session>;
  repo: HelmRepo;
  oidc: { settings: OidcSettings; jwks: JWTVerifyGetKey } | null;
}

export async function startHttpServer(opts: HttpServerOptions = {}): Promise<{ close: () => Promise<void>; port: number }> {
  const host = opts.host ?? process.env.HELM_HTTP_HOST ?? "127.0.0.1";
  const port = opts.port ?? Number(process.env.HELM_HTTP_PORT ?? "4500");
  const cwd = opts.cwd ?? process.cwd();
  const sessions = new Map<string, Session>();

  const sharedRepoHandle: RepoHandle = await openSharedRepo(cwd);
  const oidcSettings = readOidcSettings();
  const oidc = oidcSettings ? { settings: oidcSettings, jwks: buildJwks(oidcSettings) } : null;
  const staticToken = oidc ? undefined : (opts.apiToken ?? process.env.HELM_API_TOKEN);

  const restApp = buildRestApp({
    repo: sharedRepoHandle.repo,
    authMiddleware: oidc ? buildJwtMiddleware(oidc) : undefined,
    oauthMetadata: oidc ? () => oauthMetadata(oidc.settings) : undefined,
  });
  const restListener = getRequestListener(restApp.fetch);

  const mcpCtx: McpContext = {
    apiToken: staticToken,
    cwd,
    sessions,
    repo: sharedRepoHandle.repo,
    oidc,
  };

  const http = createServer(async (req, res) => {
    try {
      const url = req.url ?? "/";
      if (url === "/health" && req.method === "GET") return legacyHealth(res);
      if (url.startsWith("/mcp")) {
        const auth = await authorizeForMcp(req, res, mcpCtx);
        if (!auth.ok) return;
        return await handleMcp(req, res, mcpCtx, auth.actor);
      }
      await restListener(req, res);
    } catch (err) {
      console.error("[helm-http] handler error:", err);
      if (!res.headersSent) res.writeHead(500, { "content-type": "text/plain" }).end("server error");
    }
  });

  await new Promise<void>((resolve, reject) => {
    http.once("error", reject);
    http.listen(port, host, () => resolve());
  });
  const addr = http.address();
  const boundPort = typeof addr === "object" && addr ? addr.port : port;
  const authMode = oidc ? "oidc" : staticToken ? "static-bearer" : "UNAUTHENTICATED";
  console.error(
    `[helm-http] listening on http://${host}:${boundPort} — /mcp /v1/* /healthz (auth: ${authMode})`,
  );

  return {
    port: boundPort,
    close: async (): Promise<void> => {
      for (const s of sessions.values()) await s.serverHandle.close();
      sessions.clear();
      await sharedRepoHandle.close();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

function legacyHealth(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" }).end(
    JSON.stringify({ ok: true, name: "helm", version: "0.1.0" }),
  );
}

async function handleMcp(
  req: IncomingMessage,
  res: ServerResponse,
  ctx: McpContext,
  actor: RestActor | null,
): Promise<void> {
  const body = await readJsonBody(req);
  const sessionId = req.headers["mcp-session-id"];
  const headerId = Array.isArray(sessionId) ? sessionId[0] : sessionId;

  let session: Session | undefined = headerId ? ctx.sessions.get(headerId) : undefined;

  if (!session) {
    if (req.method !== "POST" || !body || !isInitializeRequest(body)) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "missing or unknown session" }));
      return;
    }
    session = await createSession(ctx, actor);
  }

  await session.transport.handleRequest(req, res, body);
}

async function createSession(ctx: McpContext, actor: RestActor | null): Promise<Session> {
  const identity: SessionIdentity | undefined = actor
    ? { handle: actor.handle, email: actor.email, userSub: actor.userSub }
    : undefined;
  const sessionCtx = ctx.oidc ? pendingSession() : await bootstrapSession(ctx.repo, ctx.cwd);
  const serverHandle = await buildServer({
    cwd: ctx.cwd,
    repo: ctx.repo,
    session: sessionCtx,
    identity,
    allowedProjects: actor?.allowedProjects,
    isAdmin: actor?.isAdmin,
  });
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    onsessioninitialized: (id) => {
      ctx.sessions.set(id, { transport, serverHandle });
    },
  });
  transport.onclose = (): void => {
    const id = transport.sessionId;
    if (id) {
      ctx.sessions.delete(id);
      void serverHandle.close();
    }
  };
  await serverHandle.server.connect(transport);
  return { transport, serverHandle };
}

interface McpAuthResult {
  ok: boolean;
  actor: RestActor | null;
}

async function authorizeForMcp(req: IncomingMessage, res: ServerResponse, ctx: McpContext): Promise<McpAuthResult> {
  if (ctx.oidc) return authorizeOidc(req, res, ctx.oidc);
  if (!authorizeStatic(req, res, ctx.apiToken)) return { ok: false, actor: null };
  return { ok: true, actor: null };
}

async function authorizeOidc(
  req: IncomingMessage,
  res: ServerResponse,
  oidc: { settings: OidcSettings; jwks: JWTVerifyGetKey },
): Promise<McpAuthResult> {
  const header = req.headers.authorization;
  if (!header || typeof header !== "string" || !header.toLowerCase().startsWith("bearer ")) {
    res.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": buildChallenge(oidc.settings, "missing_token"),
    }).end(JSON.stringify({ error: { code: "UNAUTHORIZED", message: "missing bearer token" } }));
    return { ok: false, actor: null };
  }
  const token = header.slice(7).trim();
  try {
    const result: { payload: JWTPayload } = await jwtVerify(token, oidc.jwks, {
      issuer: oidc.settings.issuer,
      audience: oidc.settings.audience,
    });
    return { ok: true, actor: actorFromPayload(result.payload, oidc.settings) };
  } catch (err) {
    res.writeHead(401, {
      "content-type": "application/json",
      "www-authenticate": buildChallenge(oidc.settings, "invalid_token"),
    }).end(
      JSON.stringify({ error: { code: "UNAUTHORIZED", message: `token verification failed: ${(err as Error).message}` } }),
    );
    return { ok: false, actor: null };
  }
}

function authorizeStatic(req: IncomingMessage, res: ServerResponse, expected: string | undefined): boolean {
  if (!expected) return true;
  const header = req.headers.authorization;
  if (!header || typeof header !== "string" || !header.startsWith("Bearer ")) {
    res.writeHead(401, { "content-type": "application/json" }).end(JSON.stringify({ error: "missing bearer token" }));
    return false;
  }
  const token = header.slice("Bearer ".length).trim();
  if (token !== expected) {
    res.writeHead(403, { "content-type": "application/json" }).end(JSON.stringify({ error: "invalid token" }));
    return false;
  }
  return true;
}

function readJsonBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.setEncoding("utf8");
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 1_048_576) {
        reject(new Error("request body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!data.trim()) return resolve(undefined);
      try {
        resolve(JSON.parse(data));
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}
