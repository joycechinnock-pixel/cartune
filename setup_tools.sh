#!/usr/bin/env bash
# CarTune OS — tool installer
# =============================================================================
# Run this once on the target Ubuntu 24.04 (Noble) box — Live USB or dual-boot,
# per CarTune-OS-Design.md section 1 — to install every open-source tool in
# the inventory that can actually be scripted. Safe to re-run: every step is
# idempotent (skips what's already there, or updates it).
#
# What this does NOT do: guess CLI flags for any tool. It gets each tool
# installed and runnable; wiring cartune_orchestrator.py's TuningAgent/
# FlasherAgent to a specific tool's real command-line interface is a separate,
# per-tool task (see CLAUDE.md).
#
# What this deliberately skips, and why:
#   - BlackFlag ECU:   Windows-only (.NET/WPF, single .exe), and the repo has
#                       real credibility red flags (AI-slop README, an
#                       unsigned 155MB executable claiming to defeat ECU
#                       write-protection). Not auto-downloaded. See the
#                       bottom of this script's output for the manual link.
#   - HyperTuner:      the public repo has no installable app yet — upstream
#                       says development is in a private repo until alpha.
#   - GenericDiagnosticTool: classic .NET Framework WinForms app (.sln +
#                       packages.config, not an SDK-style cross-platform
#                       project) — Windows-only, releases-only.
#   - OVMS3:            ESP32 firmware you flash to a hardware module via
#                       ESP-IDF, not a workstation app — cloned for reference
#                       only.
#   - OpenJ2534:        a curated links/resources repo (OEM portal URLs), not
#                       installable software — cloned for reference only.
#   - Tune-Editor:      already a hosted web app, nothing to install.
#
# Usage:
#   chmod +x setup_tools.sh
#   ./setup_tools.sh                # install everything below
#   ./setup_tools.sh linols pyobd   # install just these
#   CARTUNE_TOOLS_DIR=~/tools ./setup_tools.sh   # override install location
# =============================================================================

set -uo pipefail

TOOLS_DIR="${CARTUNE_TOOLS_DIR:-$HOME/cartune_tools}"
MANIFEST="$TOOLS_DIR/tools_manifest.json"
LOG_DIR="$TOOLS_DIR/.install_logs"
# $USER isn't guaranteed to be exported (stripped-env sudo, systemd units,
# minimal containers) — under `set -u` an unset "$USER" would abort the
# whole script right here, not just the one line that uses it.
TARGET_USER="${USER:-$(whoami)}"
mkdir -p "$TOOLS_DIR" "$LOG_DIR"

# name -> "ok" | "failed" | "skipped"; name -> free-text note for the manifest
declare -A STATUS
declare -A NOTE
declare -A RUN_HINT
declare -A REPO_URL

log()  { printf '\n\033[1;36m[%s]\033[0m %s\n' "$1" "$2"; }
warn() { printf '  ! %s\n' "$1"; }
ok()   { printf '  \xe2\x9c\x93 %s\n' "$1"; }

record() { # record <name> <status> <run_hint> <note> <repo_url>
    STATUS["$1"]="$2"; RUN_HINT["$1"]="$3"; NOTE["$1"]="$4"; REPO_URL["$1"]="$5"
}

clone_or_update() { # clone_or_update <dest> <repo_url> [extra git-clone args...]
    local dest="$1" url="$2"; shift 2
    if [ -d "$dest/.git" ]; then
        ok "already cloned — pulling latest"
        git -C "$dest" pull --ff-only >>"$LOG_DIR/$(basename "$dest").log" 2>&1 \
            && git -C "$dest" submodule update --init --recursive >>"$LOG_DIR/$(basename "$dest").log" 2>&1
    else
        rm -rf "$dest"
        git clone "$@" "$url" "$dest" >>"$LOG_DIR/$(basename "$dest").log" 2>&1
    fi
}

# --------------------------------------------------------------------------
# 0. System prerequisites shared by everything below
# --------------------------------------------------------------------------
install_prereqs() {
    log "prereqs" "installing system packages (sudo required)"
    sudo apt-get update -qq
    sudo apt-get install -y \
        can-utils python3 python3-pip python3-venv python3-dev python3-tk \
        git curl wget build-essential pkg-config zenity \
        >>"$LOG_DIR/prereqs.log" 2>&1 \
        && ok "core packages installed" \
        || warn "some core packages failed — see $LOG_DIR/prereqs.log"

    sudo modprobe gs_usb 2>/dev/null || true   # CANable/candleLight driver; harmless if no adapter plugged in yet

    if ! command -v cargo >/dev/null 2>&1; then
        log "prereqs" "installing Rust (needed by OpenVehicleDiag, LibreTune)"
        curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y \
            >>"$LOG_DIR/rustup.log" 2>&1
        # shellcheck disable=SC1090
        source "$HOME/.cargo/env" 2>/dev/null || true
    fi

    if ! command -v npm >/dev/null 2>&1; then
        log "prereqs" "installing Node.js/npm (needed by LibreTune's Tauri UI)"
        sudo apt-get install -y nodejs npm >>"$LOG_DIR/prereqs.log" 2>&1 \
            || warn "nodejs/npm install failed — LibreTune build will be skipped"
    fi
}

# --------------------------------------------------------------------------
# Tuning / map editing
# --------------------------------------------------------------------------
install_linols() {
    log "LinOLS" "chiptuning map editor (2CRPerformance/LinOLS)"
    local dest="$TOOLS_DIR/linols"
    clone_or_update "$dest" "https://github.com/2CRPerformance/LinOLS.git" || { record linols failed "" "clone failed" ""; return; }
    sudo apt-get install -y python3-tk zenity >>"$LOG_DIR/linols.log" 2>&1
    python3 -m pip install --user --break-system-packages matplotlib customtkinter \
        >>"$LOG_DIR/linols.log" 2>&1
    ok "installed — run: cd $dest && python3 main.py"
    record linols ok "cd $dest && python3 main.py" "" "https://github.com/2CRPerformance/LinOLS"
}

install_libretune() {
    log "LibreTune" "Speeduino/rusEFI tuning suite (RallyPat/LibreTune) — Rust+Tauri"
    if ! command -v cargo >/dev/null 2>&1 || ! command -v npm >/dev/null 2>&1; then
        warn "cargo/npm unavailable — skipping build"
        record libretune failed "" "cargo/npm prerequisite install failed earlier" ""
        return
    fi
    sudo apt-get install -y libwebkit2gtk-4.1-dev librsvg2-dev libssl-dev \
        build-essential curl wget file libxdo-dev libayatana-appindicator3-dev \
        >>"$LOG_DIR/libretune.log" 2>&1
    local dest="$TOOLS_DIR/libretune"
    clone_or_update "$dest" "https://github.com/RallyPat/LibreTune.git" || { record libretune failed "" "clone failed" ""; return; }
    ( cd "$dest/crates/libretune-app" && npm install && npm run tauri build ) \
        >>"$LOG_DIR/libretune.log" 2>&1 \
        && { ok "built — installer/AppImage under $dest/crates/libretune-app/src-tauri/target/release/bundle/"
             record libretune ok "see $dest/crates/libretune-app/src-tauri/target/release/bundle/" "no stable Linux release yet upstream; built from source" "https://github.com/RallyPat/LibreTune"; } \
        || { warn "build failed — see $LOG_DIR/libretune.log (Tauri builds are heavy; low disk/RAM is a common cause)"
             record libretune failed "" "npm/tauri build failed, see log" "https://github.com/RallyPat/LibreTune"; }
}

# --------------------------------------------------------------------------
# UDS / ODX / OBD-II diagnostics
# --------------------------------------------------------------------------
install_pyobd() {
    log "pyobd" "OBD-II diagnostics (barracuda-fsh/pyobd)"
    local dest="$TOOLS_DIR/pyobd"
    clone_or_update "$dest" "https://github.com/barracuda-fsh/pyobd.git" || { record pyobd failed "" "clone failed" ""; return; }
    # Verified-for-Ubuntu-Noble package list from the project's own README.
    sudo apt-get install -y dpkg-dev build-essential libjpeg-dev libtiff-dev \
        libsdl1.2-dev libgstreamer-plugins-base1.0-0 libnotify-dev libglut-dev \
        libglut3.12 libsm-dev libgtk-3-dev libwebkit2gtk-4.1-dev libxtst-dev \
        gettext python3-dev python3-pip wxpython-tools numpy python3-tornado \
        python3-pint python3-six >>"$LOG_DIR/pyobd.log" 2>&1
    sudo usermod -a -G dialout,tty "$TARGET_USER" >>"$LOG_DIR/pyobd.log" 2>&1
    ( cd "$dest" && python3 -m pip install --user --break-system-packages -r requirements.txt ) \
        >>"$LOG_DIR/pyobd.log" 2>&1 \
        && { ok "installed — run: cd $dest && python3 pyobd.py  (log out/in once for the dialout/tty group to take effect)"
             record pyobd ok "cd $dest && python3 pyobd.py" "log out/in once so the new dialout/tty group membership applies" "https://github.com/barracuda-fsh/pyobd"; } \
        || { warn "pip install failed — see $LOG_DIR/pyobd.log"
             record pyobd failed "" "pip install -r requirements.txt failed" "https://github.com/barracuda-fsh/pyobd"; }
}

install_ddt4all() {
    log "ddt4all" "hidden BCM config tool, Renault/Nissan origin (cedricp/ddt4all)"
    local dest="$TOOLS_DIR/ddt4all"
    clone_or_update "$dest" "https://github.com/cedricp/ddt4all.git" || { record ddt4all failed "" "clone failed" ""; return; }
    ( cd "$dest" && python3 -m pip install --user --break-system-packages -e . ) \
        >>"$LOG_DIR/ddt4all.log" 2>&1 \
        && { ok "installed — run: python3 -m ddt4all"
             record ddt4all ok "python3 -m ddt4all" "" "https://github.com/cedricp/ddt4all"; } \
        || { warn "pip install failed — see $LOG_DIR/ddt4all.log"
             record ddt4all failed "" "pip install -e . failed" "https://github.com/cedricp/ddt4all"; }
}

install_odxtools() {
    log "odxtools" "ODX/PDX diagnostic database parser (mercedes-benz/odxtools)"
    python3 -m pip install --user --break-system-packages odxtools >>"$LOG_DIR/odxtools.log" 2>&1 \
        && { ok "installed from PyPI — run: odxtools --help"
             record odxtools ok "odxtools --help" "installed from PyPI, not cloned" "https://github.com/mercedes-benz/odxtools"; } \
        || { warn "pip install failed — see $LOG_DIR/odxtools.log"
             record odxtools failed "" "pip install odxtools failed" "https://github.com/mercedes-benz/odxtools"; }
}

install_openvehiclediag() {
    log "OpenVehicleDiag" "Rust J2534/SocketCAN diagnostics app (rnd-ash/OpenVehicleDiag)"
    if ! command -v cargo >/dev/null 2>&1; then
        warn "cargo unavailable — skipping build"
        record openvehiclediag failed "" "cargo prerequisite install failed earlier" ""
        return
    fi
    local dest="$TOOLS_DIR/openvehiclediag"
    clone_or_update "$dest" "https://github.com/rnd-ash/OpenVehicleDiag.git" --recurse-submodules \
        || { record openvehiclediag failed "" "clone failed" ""; return; }
    ( cd "$dest/app_rust" && cargo build --release ) >>"$LOG_DIR/openvehiclediag.log" 2>&1 \
        && { ok "built — run: $dest/app_rust/target/release/app_rust"
             warn "upstream flags Linux SocketCAN support as WIP — 'use at your own risk'; Linux J2534 needs a Macchina M2, not a generic CANable adapter"
             record openvehiclediag ok "$dest/app_rust/target/release/app_rust" "upstream: Linux SocketCAN support is WIP; J2534 on Linux needs a Macchina M2 adapter, not CANable" "https://github.com/rnd-ash/OpenVehicleDiag"; } \
        || { warn "cargo build failed — see $LOG_DIR/openvehiclediag.log"
             record openvehiclediag failed "" "cargo build --release failed" "https://github.com/rnd-ash/OpenVehicleDiag"; }
}

# --------------------------------------------------------------------------
# CAN bus sniffing / reverse engineering
# --------------------------------------------------------------------------
install_opendbc() {
    log "opendbc" "crowdsourced DBC signal database + car API (commaai/opendbc)"
    local dest="$TOOLS_DIR/opendbc"
    clone_or_update "$dest" "https://github.com/commaai/opendbc.git" || { record opendbc failed "" "clone failed" ""; return; }
    ( cd "$dest" && python3 -m pip install --user --break-system-packages -e ".[testing]" && scons -j"$(nproc)" ) \
        >>"$LOG_DIR/opendbc.log" 2>&1 \
        && { ok "built — DBC files under $dest/opendbc/dbc/, Python API importable from $dest"
             record opendbc ok "python3 -c 'import opendbc'  (from $dest)" "" "https://github.com/commaai/opendbc"; } \
        || { warn "pip/scons build failed — see $LOG_DIR/opendbc.log"
             record opendbc failed "" "pip install -e .[testing] / scons build failed" "https://github.com/commaai/opendbc"; }
}

install_cabana() {
    # The standalone commaai/cabana repo is archived; upstream's own README
    # says it's deprecated in favor of the version bundled in openpilot.
    # openpilot is a large monorepo, so sparse-checkout just tools/cabana.
    log "cabana" "CAN visualizer / DBC maker — now lives in commaai/openpilot/tools/cabana"
    local dest="$TOOLS_DIR/cabana"
    local pull_failed=0
    if [ -d "$dest/.git" ]; then
        ok "already cloned — pulling latest"
        git -C "$dest" pull --ff-only >>"$LOG_DIR/cabana.log" 2>&1 || pull_failed=1
    else
        rm -rf "$dest"
        git clone --filter=blob:none --sparse https://github.com/commaai/openpilot.git "$dest" \
            >>"$LOG_DIR/cabana.log" 2>&1 \
            && ( cd "$dest" && git sparse-checkout set tools/cabana ) >>"$LOG_DIR/cabana.log" 2>&1
    fi
    if [ "$pull_failed" -eq 1 ]; then
        warn "git pull failed on an existing cabana checkout — it may be stale, see $LOG_DIR/cabana.log"
        record cabana failed "" "existing checkout's 'git pull --ff-only' failed (local changes or diverged upstream history) — run it by hand in $dest to see why" "https://github.com/commaai/openpilot/tree/master/tools/cabana"
    elif [ -d "$dest/tools/cabana" ]; then
        ok "cloned — see $dest/tools/cabana/README.md for its (openpilot-specific) build steps"
        record cabana ok "see $dest/tools/cabana/README.md" "the old commaai/cabana repo is archived/deprecated; this is the maintained version, nested in the openpilot monorepo" "https://github.com/commaai/openpilot/tree/master/tools/cabana"
    else
        warn "sparse-checkout failed — see $LOG_DIR/cabana.log"
        record cabana failed "" "sparse clone of openpilot failed" "https://github.com/commaai/openpilot/tree/master/tools/cabana"
    fi
}

# --------------------------------------------------------------------------
# UDS test tooling — cross-platform, real npm/deb release assets
# --------------------------------------------------------------------------
install_ecubuspro() {
    log "EcuBus-Pro" "HIL/UDS test tool with a real Linux .deb release (ecubus/EcuBus-Pro)"
    local dest="$TOOLS_DIR/ecubus-pro"
    mkdir -p "$dest"
    local api="https://api.github.com/repos/ecubus/EcuBus-Pro/releases/latest"
    local deb_url
    deb_url=$(curl -sSf "$api" 2>>"$LOG_DIR/ecubus-pro.log" \
        | grep -o '"browser_download_url": *"[^"]*amd64\.deb"' | head -1 | cut -d'"' -f4)
    if [ -z "$deb_url" ]; then
        warn "couldn't find a .deb release asset — see $LOG_DIR/ecubus-pro.log, or check https://github.com/ecubus/EcuBus-Pro/releases"
        record ecubuspro failed "" "no .deb asset found on latest release" "https://github.com/ecubus/EcuBus-Pro"
        return
    fi
    curl -sSfL "$deb_url" -o "$dest/EcuBus-Pro.deb" >>"$LOG_DIR/ecubus-pro.log" 2>&1 \
        && sudo apt-get install -y "$dest/EcuBus-Pro.deb" >>"$LOG_DIR/ecubus-pro.log" 2>&1 \
        && { ok "installed via apt — run: EcuBus-Pro  (or 'ecb_cli' for the headless CLI)"
             record ecubuspro ok "EcuBus-Pro  /  ecb_cli --help" "installed from the latest GitHub Release .deb" "https://github.com/ecubus/EcuBus-Pro"; } \
        || { warn "download/install failed — see $LOG_DIR/ecubus-pro.log"
             record ecubuspro failed "" "deb download or apt install failed" "https://github.com/ecubus/EcuBus-Pro"; }
}

# --------------------------------------------------------------------------
# Reference-only clones: no automated build, cloned so the docs/source are
# on disk. Deliberately not attempting a build we haven't verified.
# --------------------------------------------------------------------------
install_reference_only() {
    local name="$1" repo="$2" why="$3"
    log "$name" "reference only — $why"
    local dest="$TOOLS_DIR/$(echo "$name" | tr '[:upper:] ' '[:lower:]-')"
    clone_or_update "$dest" "$repo" \
        && { ok "cloned to $dest — $why"
             record "$name" skipped "" "$why" "$repo"; } \
        || { warn "clone failed — see $LOG_DIR/$(basename "$dest").log"
             record "$name" failed "" "clone failed" "$repo"; }
}

write_manifest() {
    log "manifest" "writing $MANIFEST"
    # Hand-rolled sed escaping only covered backslashes/quotes and silently
    # produced invalid JSON on embedded newlines/control chars. python3 is
    # already a hard prerequisite (install_prereqs) — let its json module do
    # real encoding instead. Fields are NUL-separated per record (bash
    # strings can never contain a NUL byte, so it's a safe delimiter no
    # matter what a run_hint/note value contains) and \x1f-separated within
    # a record.
    {
        for name in "${!STATUS[@]}"; do
            printf '%s\x1f%s\x1f%s\x1f%s\x1f%s\0' \
                "$name" "${STATUS[$name]}" "${RUN_HINT[$name]}" "${NOTE[$name]}" "${REPO_URL[$name]}"
        done
    } | python3 -c '
import json, sys
data = sys.stdin.buffer.read()
manifest = {}
for record in data.split(b"\0"):
    if not record:
        continue
    name, status, run_hint, note, repo = record.decode("utf-8").split("\x1f")
    manifest[name] = {"status": status, "run_hint": run_hint, "note": note, "repo": repo}
print(json.dumps(manifest, indent=2))
' > "$MANIFEST"
    ok "wrote $MANIFEST — cartune_orchestrator.py reads this to locate installed tools"
}

print_summary() {
    log "summary" "install run finished"
    for name in "${!STATUS[@]}"; do
        case "${STATUS[$name]}" in
            ok)      printf '  \xe2\x9c\x93 %-20s %s\n' "$name" "${RUN_HINT[$name]}" ;;
            skipped) printf '  \xe2\x80\x94 %-20s reference clone only (%s)\n' "$name" "${NOTE[$name]}" ;;
            failed)  printf '  \xe2\x9c\x97 %-20s FAILED — see %s/%s.log\n' "$name" "$LOG_DIR" "$name" ;;
        esac
    done
    printf '\nNot installed by this script:\n'
    printf '  - BlackFlag ECU        Windows-only, unverified provenance — see https://github.com/bad-antics/blackflag-ecu if you still want it, at your own risk.\n'
    printf '  - HyperTuner           nothing public to install yet (upstream: alpha still in a private repo).\n'
    printf '  - GenericDiagnosticTool Windows-only .NET Framework app — grab a release exe from https://github.com/jakka351/GenericDiagnosticTool/releases or run under Wine.\n'
    printf '  - Tune-Editor          no install needed — hosted at https://theflashbold.github.io/tune-editor/\n'
    printf '  - TunerPro / RomRaider / PCM Hammer / Universal Patcher   not yet scripted — see CarTune-OS-Design.md section 3.\n'
}

# --------------------------------------------------------------------------
ALL_TOOLS="linols pyobd ddt4all odxtools opendbc openvehiclediag libretune ecubuspro cabana reference"

main() {
    local requested="${*:-$ALL_TOOLS}"

    install_prereqs

    for t in $requested; do
        case "$t" in
            linols)           install_linols ;;
            pyobd)             install_pyobd ;;
            ddt4all)           install_ddt4all ;;
            odxtools)          install_odxtools ;;
            opendbc)           install_opendbc ;;
            openvehiclediag)   install_openvehiclediag ;;
            libretune)         install_libretune ;;
            ecubuspro)         install_ecubuspro ;;
            cabana)            install_cabana ;;
            reference)
                install_reference_only "OpenJ2534" "https://github.com/jakka351/OpenJ2534.git" "curated OEM-portal links/resources, not installable software"
                install_reference_only "OVMS3" "https://github.com/openvehicles/Open-Vehicle-Monitoring-System-3.git" "ESP32 firmware — flash via ESP-IDF per the module's own docs, not a workstation app"
                install_reference_only "GenericDiagnosticTool" "https://github.com/jakka351/GenericDiagnosticTool.git" "classic .NET Framework WinForms app (.sln/packages.config) — Windows-only, source cloned for reference; get a build from Releases or run under Wine"
                ;;
            *) warn "unknown tool '$t' — skipping" ;;
        esac
    done

    write_manifest
    print_summary
}

main "$@"
