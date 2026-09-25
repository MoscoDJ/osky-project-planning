#!/usr/bin/env bash
# Instala Osky Debate a nivel usuario (sin root): AppImage en ~/Applications,
# icono en ~/.local/share/icons y entrada de menú en ~/.local/share/applications.
# Uso: scripts/install-user.sh [ruta/al/AppImage]
set -euo pipefail

here="$(cd "$(dirname "$0")/.." && pwd)"
src="${1:-$(ls -1 "$here"/release/*.AppImage 2>/dev/null | head -1)}"
if [ -z "${src:-}" ] || [ ! -f "$src" ]; then
  echo "No encuentro el AppImage. Genera uno con: pnpm dist" >&2
  exit 1
fi

apps_dir="$HOME/Applications"
icon_dir="$HOME/.local/share/icons/hicolor/256x256/apps"
desktop_dir="$HOME/.local/share/applications"
mkdir -p "$apps_dir" "$icon_dir" "$desktop_dir"

target="$apps_dir/osky-debate.AppImage"
install -m 755 "$src" "$target"
echo "AppImage: $target"

# Icono: se extrae del propio AppImage.
tmp="$(mktemp -d)"
( cd "$tmp" && "$target" --appimage-extract 'usr/share/icons/*' >/dev/null 2>&1 || true )
( cd "$tmp" && "$target" --appimage-extract '*.png' >/dev/null 2>&1 || true )
png="$(find "$tmp/squashfs-root" -type f -name '*.png' 2>/dev/null | sort -r | head -1 || true)"
if [ -n "$png" ]; then
  cp "$png" "$icon_dir/osky-debate.png"
  echo "Icono: $icon_dir/osky-debate.png"
else
  echo "Aviso: no se encontró icono dentro del AppImage; se usará el genérico."
fi
rm -rf "$tmp"

cat > "$desktop_dir/osky-debate.desktop" <<EOF
[Desktop Entry]
Type=Application
Name=Osky Debate
Comment=Debate de planeación de proyectos entre IAs
Exec=env ELECTRON_RUN_AS_NODE= $target %U
Icon=osky-debate
Terminal=false
Categories=Development;
StartupWMClass=osky-debate
EOF
echo "Menú: $desktop_dir/osky-debate.desktop"

command -v update-desktop-database >/dev/null && update-desktop-database "$desktop_dir" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q "$HOME/.local/share/icons/hicolor" 2>/dev/null || true
if command -v kbuildsycoca6 >/dev/null; then kbuildsycoca6 >/dev/null 2>&1 || true
elif command -v kbuildsycoca5 >/dev/null; then kbuildsycoca5 >/dev/null 2>&1 || true
fi
echo "Listo. Busca \"Osky Debate\" en el menú de KDE."
