import { createRemoteJWKSet, jwtVerify, type JWTPayload, type JWTVerifyGetKey } from "jose";
import { httpErrors } from "./errors.js";
import type { RestActor, RestMiddleware } from "./context.js";

export interface OidcSettings {
  issuer: string;
  audience: string;
  jwksUrl: string;
  projectsClaim: string;
  adminRole: string;
  rolesClaimPath: string[];
  resourceUrl: string;
  required: boolean;
}

export function readOidcSettings(env: NodeJS.ProcessEnv = process.env): OidcSettings | null {
  if (env.HELM_AUTH_DISABLED === "1") return null;
  const issuer = env.HELM_OIDC_ISSUER;
  const audience = env.HELM_OIDC_AUDIENCE;
  if (!issuer || !audience) return null;
  const jwksUrl = env.HELM_OIDC_JWKS_URL ?? `${trimEnd(issuer, "/")}/protocol/openid-connect/certs`;
  const projectsClaim = env.HELM_PROJECTS_CLAIM ?? "helm_projects";
  const adminRole = env.HELM_ADMIN_ROLE ?? "helm-admin";
  const rolesClaimPath = (env.HELM_ROLES_CLAIM ?? "realm_access.roles").split(".");
  const resourceUrl = env.HELM_OIDC_RESOURCE ?? env.HELM_PUBLIC_URL ?? `http://127.0.0.1:${env.HELM_HTTP_PORT ?? "4500"}`;
  return { issuer, audience, jwksUrl, projectsClaim, adminRole, rolesClaimPath, resourceUrl, required: true };
}

function trimEnd(s: string, ch: string): string {
  return s.endsWith(ch) ? s.slice(0, -ch.length) : s;
}

export interface JwtAuthOptions {
  settings: OidcSettings;
  jwks: JWTVerifyGetKey;
}

export function buildJwks(settings: OidcSettings): JWTVerifyGetKey {
  return createRemoteJWKSet(new URL(settings.jwksUrl));
}

export function buildJwtMiddleware(opts: JwtAuthOptions): RestMiddleware {
  const { settings, jwks } = opts;
  return async (c, next) => {
    const header = c.req.header("authorization");
    if (!header || !header.toLowerCase().startsWith("bearer ")) {
      c.header("WWW-Authenticate", buildChallenge(settings, "missing_token"));
      throw httpErrors.unauthorized("missing bearer token");
    }
    const token = header.slice(7).trim();
    let payload: JWTPayload;
    try {
      const result = await jwtVerify(token, jwks, {
        issuer: settings.issuer,
        audience: settings.audience,
      });
      payload = result.payload;
    } catch (err) {
      c.header("WWW-Authenticate", buildChallenge(settings, "invalid_token"));
      throw httpErrors.unauthorized(`token verification failed: ${(err as Error).message}`);
    }
    c.set("actor", actorFromPayload(payload, settings));
    await next();
  };
}

export function buildChallenge(settings: OidcSettings, error: string): string {
  const realm = settings.audience;
  const resourceMetadata = `${trimEnd(settings.resourceUrl, "/")}/.well-known/oauth-protected-resource`;
  return `Bearer realm="${realm}", error="${error}", resource_metadata="${resourceMetadata}"`;
}

export function actorFromPayload(payload: JWTPayload, settings: OidcSettings): RestActor {
  const sub = typeof payload.sub === "string" ? payload.sub : null;
  const preferredHandle =
    pickString(payload, "preferred_username") ?? pickString(payload, "email") ?? sub ?? "unknown";
  const email = pickString(payload, "email");

  const rawProjects = readPath(payload, [settings.projectsClaim]);
  const allowedProjects = collectStrings(rawProjects);

  const roles = collectStrings(readPath(payload, settings.rolesClaimPath));
  const isAdmin = roles.has(settings.adminRole);

  return {
    developerId: null,
    userSub: sub,
    handle: preferredHandle,
    email,
    isAdmin,
    allowedProjects: isAdmin ? "all" : allowedProjects,
  };
}

function pickString(obj: Record<string, unknown>, key: string): string | null {
  const v = obj[key];
  return typeof v === "string" ? v : null;
}

function readPath(obj: unknown, path: readonly string[]): unknown {
  let cur: unknown = obj;
  for (const seg of path) {
    if (!cur || typeof cur !== "object") return undefined;
    cur = (cur as Record<string, unknown>)[seg];
  }
  return cur;
}

function collectStrings(v: unknown): Set<string> {
  const out = new Set<string>();
  if (Array.isArray(v)) {
    for (const item of v) if (typeof item === "string") out.add(item);
  } else if (typeof v === "string") {
    for (const item of v.split(/[\s,]+/).filter(Boolean)) out.add(item);
  }
  return out;
}

export function oauthMetadata(settings: OidcSettings): {
  resource: string;
  authorization_servers: string[];
  scopes_supported?: string[];
  bearer_methods_supported: string[];
} {
  return {
    resource: trimEnd(settings.resourceUrl, "/"),
    authorization_servers: [trimEnd(settings.issuer, "/")],
    bearer_methods_supported: ["header"],
    scopes_supported: ["openid", "profile", "email"],
  };
}
