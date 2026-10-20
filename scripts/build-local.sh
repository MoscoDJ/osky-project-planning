#!/usr/bin/env bash
# Compila Osky Project Planning en este equipo para su propio sistema y sube los instaladores
# al Release de la versión indicada, que ya debe existir (lo crea el workflow de Actions).
#
# Uso: scripts/build-local.sh 2026.10.19.1
#      scripts/build-local.sh 2026.10.19.1 --sin-subir   # solo compila, deja todo en release/
#
# macOS: dmg y zip para arm64 y x64, con firma ad-hoc (igual que en Actions).
# Linux: AppImage y deb x64. Windows: instalador NSIS x64.
set -euo pipefail

cd "$(dirname "$0")/.."

version="${1:-}"
subir=1
[ "${2:-}" = "--sin-subir" ] && subir=0

if ! echo "$version" | grep -Eq '^[0-9]{4}\.[0-9]{1,2}\.[0-9]{1,2}\.[0-9]+$'; then
  echo "Uso: scripts/build-local.sh AAAA.M.D.N [--sin-subir]" >&2
  exit 1
fi
short="${version%.*}"
tag="v$version"

case "$(uname -s)" in
  Darwin) target=(--mac dmg zip --arm64 --x64); patterns=("release/*-${version}-mac-*.dmg" "release/*-${version}-mac-*.zip") ;;
  Linux) target=(--linux AppImage deb --x64); patterns=("release/*-${version}-linux-*.AppImage" "release/*-${version}-linux-*.deb") ;;
  MINGW* | MSYS* | CYGWIN*) target=(--win nsis --x64); patterns=("release/*-${version}-win-*.exe") ;;
  *) echo "Sistema no soportado: $(uname -s)" >&2; exit 1 ;;
esac

# pnpm del proyecto; si no está instalado, la versión fijada en package.json vía npx.
if command -v pnpm >/dev/null 2>&1; then
  pnpm() { command pnpm "$@"; }
else
  pm="$(node -p 'require("./package.json").packageManager')"
  pnpm() { npx -y "$pm" "$@"; }
fi

# El Release vive en la cuenta dueña del repositorio, aunque la activa en gh sea otra.
if [ "$subir" = 1 ]; then
  owner="$(git remote get-url origin | sed -E 's#.*github.com[:/]([^/]+)/.*#\1#')"
  if [ -z "${GH_TOKEN:-}" ] && token="$(gh auth token --user "$owner" 2>/dev/null)"; then
    export GH_TOKEN="$token"
  fi
  if ! gh release view "$tag" >/dev/null 2>&1; then
    echo "No existe el Release $tag. Créalo primero desde Actions (workflow Release)." >&2
    exit 1
  fi
fi

pnpm install --frozen-lockfile
pnpm typecheck
pnpm typecheck:app
pnpm test
pnpm build:app

CSC_IDENTITY_AUTO_DISCOVERY=false pnpm exec electron-builder "${target[@]}" --publish never \
  -c.extraMetadata.version="$version" \
  -c.buildVersion="$version" \
  -c.mac.bundleShortVersion="$short" \
  -c.mac.identity=-

files=()
for p in "${patterns[@]}"; do
  for f in $p; do [ -f "$f" ] && files+=("$f"); done
done
if [ ${#files[@]} -eq 0 ]; then
  echo "No se encontraron instaladores de $version en release/" >&2
  exit 1
fi
printf 'Instalador: %s\n' "${files[@]}"

if [ "$subir" = 1 ]; then
  gh release upload "$tag" "${files[@]}" --clobber
  echo "Subidos a $tag."
fi
