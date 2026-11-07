# =====================================================================
# VenTune backend — Node 20.
# Buildcontext is de repo-root (zie docker-compose.yml) zodat zowel de
# server als de seed-map in het image komen. De mappenstructuur blijft
# /app/server en /app/seed, gelijk aan de repo.
# =====================================================================
FROM node:22-alpine

WORKDIR /app/server

# Eerst de manifesten voor betere layer-caching.
COPY server/package.json ./
COPY server/package-lock.jso[n] ./

RUN npm install --omit=dev

# Lokale, door de admin aangevraagde YouTube-downloads. yt-dlp haalt alleen
# expliciet aangewezen video's op; ffmpeg maakt browser-vriendelijke audio.
# Eigen uploads, waaronder m4a, blijven ook ondersteund via /media.
# YouTube verandert vaak; een oude yt-dlp uit de Docker-cache breekt dan alle
# downloads. Verhoog YTDLP_VERSIE (of geef --build-arg mee) om deze laag
# opnieuw te bouwen met de nieuwste yt-dlp.
ARG YTDLP_VERSIE=2026-11-07
RUN echo "yt-dlp build ${YTDLP_VERSIE}" && apk add --no-cache python3 py3-pip ffmpeg \
    && python3 -m pip install --no-cache-dir --break-system-packages -U 'yt-dlp[default]' bgutil-ytdlp-pot-provider

# ChatGPT-aanbevelingen via de officiële Codex CLI (ChatGPT-login van de
# beheerder, geen API-key). De login komt in CODEX_HOME (een volume), zodat
# die een rebuild overleeft. Eenmalig inloggen: `docker compose exec server codex login`.
# yt-dlp leest deze systeemconfig ook bij bestaande import- en downloadtaken.
# De PO Token Provider draait uitsluitend op het interne Docker-netwerk.
RUN printf '%s\n' '--extractor-args' 'youtube:player_client=mweb,web_safari' '--extractor-args' 'youtubepot-bgutilhttp:base_url=http://bgutil-provider:4416' > /etc/yt-dlp.conf

RUN npm install -g @openai/codex

# Vaste mappen voor audio en de Codex-login die tussen container-restarts
# blijven bestaan via de bind mounts uit docker-compose.yml.
RUN mkdir -p /media/downloads /media/uploads /data/codex

# Servercode en seed kopiëren.
COPY server/ ./
COPY seed/ /app/seed/
COPY CHANGELOG.md /app/CHANGELOG.md

ENV NODE_ENV=production
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "index.js"]
