# syntax=docker/dockerfile:1
FROM node:22-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
# Optional CA mount supports the managed development environment; Render uses
# the image's normal certificate store.
RUN --mount=type=secret,id=proxy_ca \
    if [ -f /run/secrets/proxy_ca ]; then \
      NODE_EXTRA_CA_CERTS=/run/secrets/proxy_ca npm ci --strict-ssl=true; \
    else npm ci --strict-ssl=true; fi
COPY index.html vite.config.js ./
COPY src ./src
COPY lib ./lib
ARG VITE_AI_MODE=openrouter
RUN VITE_AI_MODE=$VITE_AI_MODE npm run build
RUN npm prune --omit=dev --ignore-scripts --offline

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV REFRAME_CODEX_RUNTIME=isolated
COPY --from=build --chown=node:node /app/node_modules ./node_modules
COPY --from=build --chown=node:node /app/dist ./dist
COPY --chown=node:node package.json ./
COPY --chown=node:node server ./server
COPY --chown=node:node lib ./lib
USER node
EXPOSE 3000
CMD ["node", "server/index.js"]
