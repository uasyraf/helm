import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { buildServer, type ServerHandle } from "../server.js";
import { isInitializeRequest } from "@modelcontextprotocol/sdk/types.js";

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

export async function startHttpServer(opts: HttpServerOptions = {}): Promise<{ close: () => Promise<void>; port: number }> {
  const host = opts.host ?? "127.0.0.1";
  const port = opts.port ?? 4500;
  const apiToken = opts.apiToken ?? process.env.HELM_API_TOKEN;
  const cwd = opts.cwd ?? process.cwd();
  const sessions = new Map<string, Session>();

  const http = createServer(async (req, res) => {
    try {
      if (req.url === "/health" && req.method === "GET") return health(res);
      if (req.url?.startsWith("/mcp")) return await handleMcp(req, res, { apiToken, cwd, sessions });
      res.writeHead(404, { "content-type": "text/plain" }).end("not found");
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
  console.error(`[helm-http] listening on http://${host}:${boundPort}/mcp${apiToken ? " (bearer auth)" : " (UNAUTHENTICATED)"}`);

  return {
    port: boundPort,
    close: async (): Promise<void> => {
      for (const s of sessions.values()) await s.serverHandle.close();
      sessions.clear();
      await new Promise<void>((resolve) => http.close(() => resolve()));
    },
  };
}

function health(res: ServerResponse): void {
  res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify({ ok: true, name: "helm", version: "0.1.0" }));
}

interface McpContext {
  apiToken: string | undefined;
  cwd: string;
  sessions: Map<string, Session>;
}

async function handleMcp(req: IncomingMessage, res: ServerResponse, ctx: McpContext): Promise<void> {
  if (!authorize(req, res, ctx.apiToken)) return;

  const body = await readJsonBody(req);
  const sessionId = req.headers["mcp-session-id"];
  const headerId = Array.isArray(sessionId) ? sessionId[0] : sessionId;

  let session: Session | undefined = headerId ? ctx.sessions.get(headerId) : undefined;

  if (!session) {
    if (req.method !== "POST" || !body || !isInitializeRequest(body)) {
      res.writeHead(400, { "content-type": "application/json" }).end(JSON.stringify({ error: "missing or unknown session" }));
      return;
    }
    session = await createSession(ctx);
  }

  await session.transport.handleRequest(req, res, body);
}

async function createSession(ctx: McpContext): Promise<Session> {
  const serverHandle = await buildServer(ctx.cwd);
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

function authorize(req: IncomingMessage, res: ServerResponse, expected: string | undefined): boolean {
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
