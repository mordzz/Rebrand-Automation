# Single image, three entrypoints — the Next.js web app (`npm run start`)
# and the two standalone trading daemons (`npm run sniper` / `npm run paper`,
# both run via tsx against the same lib/ source, not a compiled bundle).
# Fly.io picks which command to run per process group (see fly.toml), all
# from this one image.

FROM node:24-slim AS base
WORKDIR /app

# ---- lighter-signer: official Lighter signer, reproducible + verified ----
# PR17: builds Lighter's OFFICIAL signer (github.com/elliottech/lighter-go,
# tag v1.0.10 @ 9d38261) to WASM with the Go toolchain upstream's justfile
# uses, then refuses to continue unless both artifacts match the SHA-256
# values pinned in lib/lighter/signer-adapter.ts (same as
# scripts/build-lighter-signer.sh). Go exists only in this stage; nothing is
# downloaded at runtime and no binary is committed to the repo.
FROM golang:1.23.2-bullseye AS lighter-signer
ARG LIGHTER_GO_COMMIT=9d38261d1a4cc5c7211b383ba07a4d6e41604708
ARG LIGHTER_WASM_SHA256=411a3280862c2d9445f74472a360882d5ecfd272276e3c961ca2431c4f1a2c54
ARG LIGHTER_WASM_EXEC_SHA256=45ce9dfe7211247544ab6f4268eb8cb5b6f3d5ae602dc3b51447b7eada99c229
WORKDIR /src
RUN git clone --quiet https://github.com/elliottech/lighter-go.git .  && git checkout --quiet "$LIGHTER_GO_COMMIT"  && GOOS=js GOARCH=wasm go build -trimpath -buildvcs=false -o /out/lighter-signer.wasm ./wasm/  && cp "$(go env GOROOT)/misc/wasm/wasm_exec.js" /out/wasm_exec.js  && echo "$LIGHTER_WASM_SHA256  /out/lighter-signer.wasm" | sha256sum -c -  && echo "$LIGHTER_WASM_EXEC_SHA256  /out/wasm_exec.js" | sha256sum -c -

# ---- deps: full install (incl. devDependencies) for the build step ----
# npm install rather than npm ci — the local lockfile was generated with a
# different npm minor version than this image's, which resolves some
# optional/peer deps differently and trips npm ci's strict match.
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm install

# ---- builder: compile the Next.js app ----
FROM base AS builder
# NEXT_PUBLIC_* vars are inlined into the client bundle at build time, not
# read at container runtime — must be passed as a build arg (fly deploy
# --build-arg NEXT_PUBLIC_PRIVY_APP_ID=...), a plain `fly secrets set`
# would have no effect on this one.
ARG NEXT_PUBLIC_PRIVY_APP_ID
ENV NEXT_PUBLIC_PRIVY_APP_ID=$NEXT_PUBLIC_PRIVY_APP_ID
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

# ---- prod-deps: production-only install for the runtime image ----
FROM base AS prod-deps
COPY package.json package-lock.json ./
RUN npm install --omit=dev

# ---- runner: only what's needed to run `start`, `sniper`, or `paper` ----
FROM base AS runner
ENV NODE_ENV=production
ENV PORT=3000

COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/public ./public
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/tsconfig.json ./tsconfig.json
# The daemons import only from lib/ — no app/ or components/ needed here.
COPY --from=builder /app/lib ./lib
COPY --from=builder /app/scripts ./scripts
# Verified official Lighter signer (see the lighter-signer stage above);
# lib/lighter/signer-adapter.ts re-checks both SHA-256s before loading.
COPY --from=lighter-signer /out/ ./vendor/lighter-signer/

EXPOSE 3000
CMD ["npm", "run", "start"]
