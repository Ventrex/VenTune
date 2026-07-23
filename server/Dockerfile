# =====================================================================
# VenTune backend — Node 20
# =====================================================================
FROM node:20-alpine

WORKDIR /app

# Eerst alleen de manifesten kopiëren voor betere layer-caching.
COPY package.json ./
# package-lock.json is optioneel; kopieer als hij bestaat.
COPY package-lock.jso[n] ./

# Productie-afhankelijkheden installeren.
RUN npm install --omit=dev

# Broncode kopiëren.
COPY . .

ENV NODE_ENV=production
EXPOSE 3000

# Eenvoudige healthcheck tegen het health-endpoint.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD wget -qO- http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "index.js"]
