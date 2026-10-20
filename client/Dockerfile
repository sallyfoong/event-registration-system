# syntax=docker/dockerfile:1

# ---- build stage -------------------------------------------------------
FROM node:20-alpine AS build

WORKDIR /app

COPY package.json package-lock.json ./
RUN npm ci

COPY . .

# The browser bundle has to know where the API lives. Vite inlines
# VITE_* variables at build time, so this cannot be a runtime setting.
# In the compose stack the API is served under the same origin through the
# nginx image, so the default value is a relative path.
ARG VITE_API_BASE_URL=/api
ENV VITE_API_BASE_URL=$VITE_API_BASE_URL

RUN npm run build

# ---- runtime stage -----------------------------------------------------
# nginx serves the static bundle. It also fronts the API so the browser
# only ever talks to one origin - that keeps CORS out of the picture
# entirely and lets the whole site sit behind a single certificate.
#
# The unprivileged variant instead of plain nginx: the stock image starts its
# master process as root, which is exactly the thing to avoid - a container
# escape inherits whatever the process was running as. This image runs the
# whole tree as uid 101, which is why the server block listens on 8080: a
# non-root process cannot bind a port below 1024. Nothing outside the
# container sees that number.
FROM nginxinc/nginx-unprivileged:1.27-alpine AS runtime

COPY nginx.conf /etc/nginx/conf.d/default.conf
# Shared add_header block. It lives outside conf.d because everything in
# that directory is auto-included at http level, where it would apply to
# the API location as well.
COPY security-headers.conf /etc/nginx/snippets/security-headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD wget -qO- http://127.0.0.1:8080/ >/dev/null || exit 1

CMD ["nginx", "-g", "daemon off;"]
