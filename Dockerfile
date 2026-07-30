# Single image, three entrypoints — the Next.js web app (`npm run start`)
# and the two standalone trading daemons (`npm run sniper` / `npm run paper`,
# both run via tsx against the same lib/ source, not a compiled bundle).
# Fly.io picks which command to run per process group (see fly.toml), all
# from this one image.

FROM node:24-slim AS base
WORKDIR /app

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

EXPOSE 3000
CMD ["npm", "run", "start"]
