# syntax=docker/dockerfile:1

# ---- build stage -------------------------------------------------------
# The server is TypeScript, so it has to be compiled before it can run.
# Everything needed to compile lives in devDependencies, which is why the
# build stage installs the full dependency tree and the runtime stage
# throws it away again.
FROM node:20-alpine AS build

WORKDIR /app

# copy manifests first: this layer is only rebuilt when a dependency
# changes, not on every source edit
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY src ./src
RUN npm run build

# ---- seed stage -------------------------------------------------------
# The seed script is TypeScript and runs through tsx, which lives in
# devDependencies. The runtime image deliberately has no devDependencies,
# so seeding gets its own stage that keeps the full dependency tree.
# Nothing is compiled here: the script talks to the database directly.
FROM build AS seed

WORKDIR /app
ENV NODE_ENV=production

# --demo additionally creates sample events and registrations.
# ENTRYPOINT rather than CMD: `docker compose run --rm seed --demo` passes
# its arguments as the container command, and with CMD that would replace
# the script name instead of being appended to it.
ENTRYPOINT ["npx", "tsx", "src/seed.ts"]

# ---- runtime stage -----------------------------------------------------
FROM node:20-alpine AS runtime

WORKDIR /app
ENV NODE_ENV=production

# production dependencies only - the build output above has already been
# compiled and does not need tsc or the test tooling at runtime
COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build --chown=node:node /app/dist ./dist

# the logger writes error.log / combined.log into ./logs relative to the
# application root. The directory has to exist and be writable by the
# unprivileged user, otherwise the first log line kills the process.
RUN mkdir -p /app/logs && chown -R node:node /app

# the unprivileged user that ships with the node image. Running the API as
# root would mean a container escape starts as root on the host too.
USER node

EXPOSE 8000

# the container is considered unhealthy unless the API answers on /api/health
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "require('http').get('http://127.0.0.1:8000/api/health',r=>process.exit(r.statusCode===200?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "dist/index.js"]
