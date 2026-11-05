#!/usr/bin/env bash
set -euo pipefail

# 1. Define version and directory targets
SEABIOS_VERSION="1.16.3"
BUILD_DIR="seabios-build"
OUTPUT_BIN="../bios.bin-1.10.0"
OUTPUT_VGA="../vgabios.bin"

echo "=== Cleaning up old build targets ==="
rm -rf "${BUILD_DIR}"

echo "=== Fetching SeaBIOS source code v${SEABIOS_VERSION} ==="
# Clone the official repository and checkout the stable tag
git clone https://seabios.org "${BUILD_DIR}"
cd "${BUILD_DIR}"
git checkout "rel-${SEABIOS_VERSION}"

echo "=== Injecting custom configuration for Windows 95/2000 compatibility ==="
# Write configuration to .config inside the build directory
cat << 'EOF' > .config
# Enforce legacy CPU compatibility and disable conflicting tables
CONFIG_ACPI=n
CONFIG_APM=y
CONFIG_VGA_VESA=y
CONFIG_VBOOTSTRAP=y
CONFIG_COREBOOT=n
CONFIG_DEBUG_LEVEL=1
EOF

echo "=== Making and staging configuration profiles ==="
make olddefconfig

echo "=== Compiling SeaBIOS for v86 runtime architecture ==="
make -j$(nproc)

echo "=== Copying finished binary payloads to root directory ==="
cp out/bios.bin "${OUTPUT_BIN}"
cp out/vgabios.bin "${OUTPUT_VGA}"

echo "=== Process Complete ==="
echo "Legacy BIOS is now located at: ${OUTPUT_BIN}"
echo "Legacy VGA BIOS is now located at: ${OUTPUT_VGA}"
