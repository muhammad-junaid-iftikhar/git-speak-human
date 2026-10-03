#!/bin/sh
# gitbuddy installer: curl -fsSL https://raw.githubusercontent.com/muhammad-junaid-iftikhar/git-speak-human/main/install.sh | sh
set -eu

REPO="muhammad-junaid-iftikhar/git-speak-human"
INSTALL_DIR="${GITBUDDY_INSTALL_DIR:-$HOME/.local/bin}"

say() { printf '\033[38;5;75m🐙 %s\033[0m\n' "$1"; }
die() { printf '\033[38;5;203m❌ %s\033[0m\n' "$1" >&2; exit 1; }

case "$(uname -s)" in
  Darwin) os=darwin ;;
  Linux) os=linux ;;
  *) die "This installer supports macOS and Linux. On Windows use install.ps1." ;;
esac
case "$(uname -m)" in
  arm64 | aarch64) arch=arm64 ;;
  x86_64 | amd64) arch=x64 ;;
  *) die "Unsupported CPU: $(uname -m)" ;;
esac

command -v git >/dev/null 2>&1 || say "Heads up: git isn't installed yet. Get it from https://git-scm.com/downloads"

asset="gitbuddy-${os}-${arch}"
url="https://github.com/$REPO/releases/latest/download/$asset"
tmp="$(mktemp)"

say "Downloading gitbuddy for ${os}/${arch}…"
if command -v curl >/dev/null 2>&1; then
  curl -fsSL "$url" -o "$tmp" || die "Download failed. Is there a release yet? You can also run: bun install -g github:$REPO"
else
  wget -qO "$tmp" "$url" || die "Download failed."
fi

mkdir -p "$INSTALL_DIR"
mv "$tmp" "$INSTALL_DIR/gitbuddy"
chmod +x "$INSTALL_DIR/gitbuddy"

say "Installed to $INSTALL_DIR/gitbuddy"
case ":$PATH:" in
  *":$INSTALL_DIR:"*) ;;
  *) say "Add this to your shell profile so you can type gitbuddy anywhere:"
     printf '   export PATH="%s:$PATH"\n' "$INSTALL_DIR" ;;
esac
say "Done! Type: gitbuddy"
