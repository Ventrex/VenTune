#!/bin/bash
# =====================================================================
# VenTune bijwerken op een Synology (DSM 7, Container Manager).
#
# Eén regel via SSH:
#   curl -fsSL https://raw.githubusercontent.com/Ventrex/VenTune/main/scripts/synology-update.sh | sudo bash
# MP3's (voortaan) in een eigen gedeelde map, bijv. /volume1/Muziek:
#   ... | sudo bash -s -- --muziek /volume1/Muziek
#   (komt in /volume1/Muziek/VenTune; bestaande MP3's worden gekopieerd)
# Staat VenTune niet in /volume1/docker/VenTune, geef dan de map mee:
#   ... | sudo bash -s -- --map /volume1/docker/<jouw-map>
#
# Wat het doet:
#  1. VenTune-map zoeken (of de meegegeven map gebruiken).
#  2. Nieuwste code ophalen: met git als dat er is, anders als download
#     van GitHub. .env, de database en je MP3's blijven ongemoeid.
#  3. Containers opnieuw bouwen en starten onder dezelfde projectnaam die
#     Container Manager gebruikt (dus geen dubbele containers).
# =====================================================================
set -euo pipefail

groen() { printf '\033[32m%s\033[0m\n' "$*"; }
rood() { printf '\033[31m%s\033[0m\n' "$*"; }

[ "$(id -u)" = 0 ] || { rood "Draai dit met sudo."; exit 1; }
export PATH="$PATH:/usr/local/bin:/var/packages/ContainerManager/target/usr/bin:/var/packages/Docker/target/usr/bin"

MAP=""
MUZIEK=""
while [ $# -gt 0 ]; do
    case "$1" in
        --muziek) MUZIEK="${2:-}"; shift 2 ;;
        --map) MAP="${2:-}"; shift 2 ;;
        *) MAP="$1"; shift ;;
    esac
done
if [ -z "$MAP" ]; then
    for d in /volume*/docker/VenTune /volume*/docker/ventune /volume*/docker/Ventune /volume*/docker/*; do
        if [ -f "$d/docker-compose.yml" ] && grep -q "bgutil-provider" "$d/docker-compose.yml" 2>/dev/null && grep -qi "ventune" "$d/docker-compose.yml"; then
            MAP="$d"; break
        fi
    done
fi
if [ -z "$MAP" ] || [ ! -f "$MAP/docker-compose.yml" ]; then
    rood "VenTune-map niet gevonden."
    echo "Geef het pad mee, bijv.:  curl -fsSL https://raw.githubusercontent.com/Ventrex/VenTune/main/scripts/synology-update.sh | sudo bash -s -- --map /volume1/docker/VenTune"
    exit 1
fi
cd "$MAP"
groen "VenTune-map: $MAP"

if [ -d .git ] && command -v git >/dev/null 2>&1; then
    echo "Code ophalen met git…"
    git config --global --add safe.directory "$MAP" 2>/dev/null || true
    git pull --ff-only
else
    echo "Code downloaden van GitHub…"
    tmp="$(mktemp -d)"
    curl -fsSL https://github.com/Ventrex/VenTune/archive/refs/heads/main.tar.gz | tar xz -C "$tmp"
    bron="$(find "$tmp" -mindepth 1 -maxdepth 1 -type d | head -1)"
    [ -f "$bron/docker-compose.yml" ] || { rood "Download mislukt."; rm -rf "$tmp"; exit 1; }
    # Nooit .env of media overschrijven.
    rm -f "$bron/.env"
    cp -a "$bron"/. "$MAP"/
    rm -rf "$tmp"
fi

# MP3's naar een andere map (bijv. /volume1/Muziek/VenTune).
if [ -n "$MUZIEK" ]; then
    [ -d "$MUZIEK" ] || { rood "Map $MUZIEK bestaat niet."; exit 1; }
    DOEL="${MUZIEK%/}/VenTune"
    mkdir -p "$DOEL" "$MAP/media"
    echo "MP3's kopiëren naar $DOEL …"
    if command -v rsync >/dev/null 2>&1; then
        rsync -a --exclude '*.part*' --exclude '.ventune-media' "$MAP/media/" "$DOEL/"
    else
        cp -a -n "$MAP/media/." "$DOEL/"
    fi
    tel() { find "$1" -type f ! -name '.ventune-media' ! -name '*.part*' 2>/dev/null | wc -l; }
    a=$(tel "$MAP/media"); b=$(tel "$DOEL")
    if [ "$b" -lt "$a" ]; then rood "In $DOEL staan $b bestanden, in media $a. Niets omgezet."; exit 1; fi
    echo "VenTune mediamap $(date -Iseconds)" > "$DOEL/.ventune-media"
    touch .env
    if grep -q '^MEDIA_PAD=' .env; then sed -i "s#^MEDIA_PAD=.*#MEDIA_PAD=$DOEL#" .env; else echo "MEDIA_PAD=$DOEL" >> .env; fi
    groen "MP3's staan nu in $DOEL ($b bestanden). De oude media-map blijft als reserve staan."
fi

if docker compose version >/dev/null 2>&1; then DC=(docker compose); else DC=(docker-compose); fi

# Dezelfde projectnaam als de draaiende containers (Container Manager).
PROJECT="$(docker ps -a --filter "label=com.docker.compose.project.working_dir=$MAP" \
    --format '{{.Label "com.docker.compose.project"}}' 2>/dev/null | head -1 || true)"
[ -n "$PROJECT" ] && DC+=(-p "$PROJECT") && echo "Project: $PROJECT"

echo "Bouwen en starten (dit duurt een paar minuten)…"
"${DC[@]}" up -d --build --remove-orphans
"${DC[@]}" ps
groen "VenTune is bijgewerkt."
