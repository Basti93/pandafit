# Build with the repo root as context: docker build -f web-server/Dockerfile .
# Stage 1 builds the installable web app; the final stage holds only the server, the shared folder, the static build and production dependencies.
FROM node:26-slim AS web
WORKDIR /src
COPY package.json package-lock.json ./
# No install scripts on the server: the web build needs none (esbuild/rolldown ship prebuilt binaries).
RUN npm ci --ignore-scripts
COPY . .
RUN npm run build:web

FROM node:26-slim AS deps
WORKDIR /app/web-server
COPY web-server/package.json web-server/package-lock.json ./
RUN npm ci --omit=dev --ignore-scripts

FROM node:26-slim
ENV NODE_ENV=production
WORKDIR /app
# The server imports from src/shared; it needs a module-type package.json above it. Whole folder: tests/architecture keeps it self-contained.
RUN printf '{"type":"module","private":true}\n' > package.json && mkdir /data && chown node:node /data
COPY --from=deps /app/web-server/node_modules ./web-server/node_modules
COPY web-server/package.json web-server/*.ts ./web-server/
COPY src/shared ./src/shared
COPY --from=web /src/out/web ./out/web
USER node
ENV PORT=8080 HOST=0.0.0.0 PANDAFIT_DB=/data/pandafit.db PANDAFIT_STATIC=/app/out/web
# Direct binary: npx would write to the home directory, and the file system is read-only.
CMD ["web-server/node_modules/.bin/tsx", "web-server/index.ts"]
