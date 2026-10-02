#!/usr/bin/env bash
set -euo pipefail

task_root="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)"
task_sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-$HOME/Android/Sdk}}"
if [[ ! -d "$task_sdk/platforms/android-36" ]]; then
    printf 'Android SDK 36 not found at %s. Set ANDROID_SDK_ROOT.\n' "$task_sdk" >&2
    exit 1
fi

task_gradle="${GRADLE_BINARY:-}"
if [[ -z "$task_gradle" ]]; then
    if command -v gradle >/dev/null 2>&1; then
        task_gradle="$(command -v gradle)"
    else
        for task_candidate in "$HOME"/.gradle/wrapper/dists/gradle-8.*/[[:alnum:]]*/gradle-8.*/bin/gradle; do
            if [[ -x "$task_candidate" ]]; then
                task_gradle="$task_candidate"
            fi
        done
    fi
fi
if [[ -z "$task_gradle" || ! -x "$task_gradle" ]]; then
    printf 'Gradle 8.13+ required. Install Gradle or set GRADLE_BINARY.\n' >&2
    exit 1
fi

task_assets="$task_root/android/app/src/main/assets"
mkdir -p "$task_assets" "$task_root/artifacts"
for task_asset in index.html game.js styles.css THREE-LICENSE.txt; do
    if [[ ! -s "$task_root/dist/$task_asset" ]]; then
        printf 'Missing dist/%s. Run npm run build first.\n' "$task_asset" >&2
        exit 1
    fi
done
for task_asset in index.html game.js styles.css THREE-LICENSE.txt; do
    cp -- "$task_root/dist/$task_asset" "$task_assets/$task_asset"
done

export ANDROID_HOME="$task_sdk"
export ANDROID_SDK_ROOT="$task_sdk"
"$task_gradle" -p "$task_root/android" --console=plain assembleDebug "$@"
cp -- "$task_root/android/app/build/outputs/apk/debug/app-debug.apk" "$task_root/artifacts/block-ops-debug.apk"
printf 'APK: %s/artifacts/block-ops-debug.apk\n' "$task_root"
