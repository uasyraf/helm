# syntax=docker/dockerfile:1.7

# ───────── stage 1: build ─────────
FROM node:22-alpine AS builder

WORKDIR /build

# Server deps + build
COPY package.json package-lock.json tsconfig.json ./
RUN npm ci --no-audit --no-fund
COPY server/ ./server/
COPY bin/ ./bin/
RUN npm run build

# Dashboard build (SvelteKit, adapter-node)
COPY dashboard/package.json ./dashboard/package.json
WORKDIR /build/dashboard
RUN npm install --no-audit --no-fund
COPY dashboard/. ./
RUN npm run build

# Skills + plugin manifests + hooks bundle
WORKDIR /build
COPY skills/ ./skills/
COPY hooks/ ./hooks/
COPY .claude-plugin/ ./.claude-plugin/
COPY .mcp.json ./.mcp.json
COPY LICENSE README.md ONBOARDING.md ./

# Prune devDependencies for the final image
RUN npm prune --omit=dev

# Stage an empty data dir owned by the nonroot UID (65532). /home/nonroot is the
# canonical distroless writable path; we put data under it so a default container
# run boots cleanly with no host volume needed, while operators can still mount
# their own volume on /home/nonroot/data for persistence.
RUN mkdir -p /opt/helm-data && touch /opt/helm-data/.keep && chown -R 65532:65532 /opt/helm-data

# ───────── stage 2: runtime ─────────
FROM gcr.io/distroless/nodejs22-debian12:nonroot

ENV NODE_ENV=production \
    HELM_DATA_DIR=/home/nonroot/data \
    HELM_HTTP_HOST=0.0.0.0 \
    HELM_HTTP_PORT=8080

WORKDIR /app

COPY --from=builder --chown=nonroot:nonroot /build/dist ./dist
COPY --from=builder --chown=nonroot:nonroot /build/node_modules ./node_modules
COPY --from=builder --chown=nonroot:nonroot /build/package.json ./package.json
COPY --from=builder --chown=nonroot:nonroot /build/dashboard/build ./dashboard/build
COPY --from=builder --chown=nonroot:nonroot /build/dashboard/package.json ./dashboard/package.json
COPY --from=builder --chown=nonroot:nonroot /build/dashboard/svelte.config.js ./dashboard/svelte.config.js
COPY --from=builder --chown=nonroot:nonroot /build/skills ./skills
COPY --from=builder --chown=nonroot:nonroot /build/.mcp.json ./.mcp.json

COPY --from=builder /opt/helm-data /home/nonroot/data

EXPOSE 8080

VOLUME ["/home/nonroot/data"]

USER nonroot:nonroot

# Default: HTTP server. Override with `--entrypoint /nodejs/bin/node` for one-off CLI use.
ENTRYPOINT ["/nodejs/bin/node", "/app/dist/bin/helm.js"]
CMD ["serve", "--http"]
