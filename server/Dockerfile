# =====================================================================
# VenTune backend — Node 20.
# Buildcontext is de repo-root (zie docker-compose.yml) zodat zowel de
# server als de seed-map in het image komen. De mappenstructuur blijft
# /app/server en /app/seed, gelijk aan de repo.
# =====================================================================
FROM node:20-alpine

WORKDIR /app/server

# Eerst de manifesten voor betere layer-caching.
COPY server/package.json ./
COPY server/package-lock.jso[n] ./

RUN npm install --omit=dev

# Servercode en seed kopiëren.
COPY server/ ./
COPY seed/ /app/seed/

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "index.js"]
