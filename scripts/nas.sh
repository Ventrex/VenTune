#!/usr/bin/env bash
# =====================================================================
# VenTune MP3's naar de Synology NAS (NFS) verplaatsen — veilig.
#
#   bash scripts/nas.sh koppel <nas-ip> <nfs-pad>   NAS koppelen, MP3's kopiëren, VenTune omzetten
#   bash scripts/nas.sh status                      laat zien waar de MP3's nu staan
#   bash scripts/nas.sh terug                       weer de lokale map gebruiken
#   bash scripts/nas.sh opruimen                    lokale kopie weggooien (pas als alles goed speelt)
#
# Voorbeeld: bash scripts/nas.sh koppel 192.168.0.20 /volume1/ventune
#
# Wat het doet bij "koppel":
#  1. NFS-share mounten op /mnt/nas-ventune (vast in /etc/fstab, met nofail:
#     start de server zonder NAS, dan start hij gewoon door).
#  2. Alles uit ./media kopiëren naar /mnt/nas-ventune/media en tellen of
#     het aantal bestanden klopt.
#  3. MEDIA_PAD in .env zetten en VenTune herstarten.
# De lokale ./media blijft staan als reserve: wat niet op de NAS staat,
# speelt vanaf daar. Niets wordt verwijderd tot je zelf "opruimen" doet.
# =====================================================================
set -euo pipefail

MAP="$(cd "$(dirname "$0")/.." && pwd)"
MOUNT=/mnt/nas-ventune
DOEL="$MOUNT/media"
ENV="$MAP/.env"
MARKER=".ventune-media"

rood() { printf '\033[31m%s\033[0m\n' "$*"; }
groen() { printf '\033[32m%s\033[0m\n' "$*"; }
info() { printf '› %s\n' "$*"; }

zet_env() { # zet_env SLEUTEL WAARDE
    touch "$ENV"
    if grep -q "^$1=" "$ENV"; then sed -i "s#^$1=.*#$1=$2#" "$ENV"; else echo "$1=$2" >> "$ENV"; fi
}
wis_env() { [ -f "$ENV" ] && sed -i "/^$1=/d" "$ENV" || true; }

tel() { find "$1" -type f ! -name "$MARKER" ! -name '*.part*' 2>/dev/null | wc -l; }

herstart() {
    info "VenTune herstarten…"
    (cd "$MAP" && docker compose up -d --force-recreate server client)
}

koppel() {
    local ip="${1:-}" pad="${2:-}"
    if [ -z "$ip" ] || [ -z "$pad" ]; then
        rood "Gebruik: bash scripts/nas.sh koppel <nas-ip> <nfs-pad>   (bijv. 192.168.0.20 /volume1/ventune)"
        exit 1
    fi
    [ "$(id -u)" = 0 ] || { rood "Draai dit als root (sudo)."; exit 1; }

    if ! command -v mount.nfs >/dev/null 2>&1; then
        info "NFS-hulpprogramma installeren…"
        apt-get update -qq && apt-get install -y -qq nfs-common rsync >/dev/null
    fi
    command -v rsync >/dev/null 2>&1 || apt-get install -y -qq rsync >/dev/null

    mkdir -p "$MOUNT"
    local regel="$ip:$pad $MOUNT nfs defaults,_netdev,nofail,soft,timeo=150,retrans=3,noatime 0 0"
    if ! grep -q " $MOUNT " /etc/fstab; then
        info "NAS toevoegen aan /etc/fstab"
        echo "$regel" >> /etc/fstab
    fi
    if ! mountpoint -q "$MOUNT"; then
        info "NAS koppelen ($ip:$pad)…"
        systemctl daemon-reload 2>/dev/null || true
        if ! mount "$MOUNT"; then
            rood "Koppelen lukte niet."
            echo "Controleer op de Synology: Configuratiescherm → Bestandsservices → NFS aan,"
            echo "en bij de gedeelde map → NFS-machtigingen: IP van deze server, Lezen/schrijven,"
            echo "Squash: 'Alle gebruikers toewijzen aan admin'."
            echo "Draait VenTune in een (unprivileged) LXC? Koppel dan op de Proxmox-host en geef"
            echo "de map door:  pct set <ID> -mp0 $MOUNT,mp=$MOUNT   en draai dit script opnieuw."
            exit 1
        fi
    fi
    mkdir -p "$DOEL"
    touch "$DOEL/.schrijftest" && rm -f "$DOEL/.schrijftest" || { rood "Kan niet schrijven op de NAS (controleer Squash/rechten)."; exit 1; }

    local bron="$MAP/media"
    mkdir -p "$bron"
    info "MP3's kopiëren naar de NAS (kan even duren)…"
    rsync -a --info=progress2 --exclude '*.part*' --exclude "$MARKER" "$bron/" "$DOEL/"
    local a b
    a=$(tel "$bron"); b=$(tel "$DOEL")
    if [ "$b" -lt "$a" ]; then
        rood "Op de NAS staan $b bestanden, lokaal $a. Er is NIETS omgezet. Probeer opnieuw."
        exit 1
    fi
    echo "VenTune mediamap $(date -Iseconds)" > "$DOEL/$MARKER"
    groen "Gekopieerd: $b bestanden."

    zet_env MEDIA_PAD "$DOEL"
    zet_env MEDIA_OP_NAS true
    herstart
    groen "Klaar. Nieuwe MP3's komen nu op de NAS. De oude ./media blijft als reserve staan."
    echo "Speelt alles goed? Dan kun je later: bash scripts/nas.sh opruimen"
}

status() {
    local pad
    pad=$(grep -s '^MEDIA_PAD=' "$ENV" | cut -d= -f2- || true)
    if [ -n "$pad" ]; then
        echo "MP3's staan op: $pad"
        if mountpoint -q "$MOUNT"; then groen "NAS gekoppeld ($(tel "$pad") bestanden)"; else rood "NAS NIET gekoppeld — VenTune speelt vanaf de lokale reserve"; fi
    else
        echo "MP3's staan lokaal: $MAP/media ($(tel "$MAP/media") bestanden)"
    fi
    echo "Lokale reserve: $(tel "$MAP/media") bestanden, $(du -sh "$MAP/media" 2>/dev/null | cut -f1)"
}

terug() {
    if mountpoint -q "$MOUNT"; then
        info "Nieuwe bestanden van de NAS terug naar lokaal kopiëren…"
        rsync -a --exclude "$MARKER" "$DOEL/" "$MAP/media/"
    fi
    wis_env MEDIA_PAD
    wis_env MEDIA_OP_NAS
    herstart
    groen "VenTune gebruikt weer de lokale map."
}

opruimen() {
    mountpoint -q "$MOUNT" || { rood "NAS is niet gekoppeld; opruimen geweigerd."; exit 1; }
    local a b
    a=$(tel "$MAP/media"); b=$(tel "$DOEL")
    if [ "$b" -lt "$a" ]; then rood "NAS heeft minder bestanden ($b) dan lokaal ($a); opruimen geweigerd."; exit 1; fi
    read -r -p "Lokale kopie ($a bestanden) verwijderen? Typ JA: " ok
    [ "$ok" = "JA" ] || { echo "Niets verwijderd."; exit 0; }
    find "$MAP/media" -mindepth 1 -delete
    groen "Lokale kopie verwijderd. Alles speelt nu van de NAS."
}

case "${1:-}" in
    koppel) shift; koppel "$@" ;;
    status) status ;;
    terug) terug ;;
    opruimen) opruimen ;;
    *) sed -n '2,20p' "$0" ;;
esac
