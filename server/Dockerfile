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

# Lokale, door de admin aangevraagde YouTube-caches. yt-dlp haalt alleen
# expliciet aangewezen video's op; ffmpeg zet ze om naar browser-vriendelijke
# m4a-audio. Eigen uploads blijven ook ondersteund via /media.
RUN apk add --no-cache python3 py3-pip ffmpeg \
    && python3 -m pip install --no-cache-dir --break-system-packages yt-dlp

# Vaste mappen voor audio die tussen container-restarts blijft bestaan via
# de bind mount uit docker-compose.yml.
RUN mkdir -p /media/downloads /media/uploads

# Servercode en seed kopiëren.
COPY server/ ./
COPY seed/ /app/seed/
COPY CHANGELOG.md /app/CHANGELOG.md

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "index.js"]
