#!/usr/bin/env bash
# Crea y empuja la etiqueta de versión del día con el formato vAAAA.M.D.N
# (N = número de compilación del día, empezando en 1). GitHub Actions compila
# Linux, macOS y Windows y publica el Release.
#
# Uso: scripts/release.sh            # siguiente compilación de hoy
#      scripts/release.sh 2026.10.2.3  # versión explícita
set -euo pipefail

cd "$(dirname "$0")/.."

if [ -n "$(git status --porcelain)" ]; then
  echo "Hay cambios sin commit. Haz commit antes de publicar una versión." >&2
  exit 1
fi

if [ $# -ge 1 ]; then
  version="$1"
else
  today="$(date +%Y).$(date +%-m).$(date +%-d)"
  git fetch --tags --quiet || true
  last="$(git tag --list "v${today}.*" | sed "s/^v${today}\.//" | sort -n | tail -1)"
  version="${today}.$(( ${last:-0} + 1 ))"
fi

if ! echo "$version" | grep -Eq '^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}\.[0-9]+$'; then
  echo "Versión inválida: $version (formato AAAA.M.D.N)" >&2
  exit 1
fi

tag="v$version"
if git rev-parse "$tag" >/dev/null 2>&1; then
  echo "La etiqueta $tag ya existe." >&2
  exit 1
fi

git tag -a "$tag" -m "Osky Project Planning $version"
git push origin "$tag"
echo "Etiqueta $tag publicada. Sigue la compilación en la pestaña Actions del repositorio."
