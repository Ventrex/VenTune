# =====================================================================
# VenTune frontend — multi-stage: bouwen met Node, serveren met nginx.
# =====================================================================

# ---- Buildfase ----
FROM node:20-alpine AS build
WORKDIR /app

COPY package.json ./
COPY package-lock.jso[n] ./
RUN npm install

COPY . .

# Vite build-tijd variabelen (via build args uit docker-compose).
ARG VITE_SPOTIFY_CLIENT_ID
ARG VITE_SPOTIFY_REDIRECT_URI
ARG VITE_APP_URL
ENV VITE_SPOTIFY_CLIENT_ID=$VITE_SPOTIFY_CLIENT_ID
ENV VITE_SPOTIFY_REDIRECT_URI=$VITE_SPOTIFY_REDIRECT_URI
ENV VITE_APP_URL=$VITE_APP_URL

RUN npm run build

# ---- Serveerfase ----
FROM nginx:1.27-alpine
COPY nginx.conf /etc/nginx/conf.d/default.conf
COPY --from=build /app/dist /usr/share/nginx/html

EXPOSE 80
CMD ["nginx", "-g", "daemon off;"]
