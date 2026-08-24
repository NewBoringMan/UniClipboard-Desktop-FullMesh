#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
android_dir="$project_dir/android"
gradle_command="${UC_ANDROID_GRADLE_COMMAND:-$android_dir/gradlew}"
max_workers="${UC_ANDROID_MAX_WORKERS:-2}"
staging_dir="$(mktemp -d)"

cleanup() {
  rm -rf "$staging_dir"
}
trap cleanup EXIT

gradle_args=(--no-daemon --max-workers="$max_workers" --console=plain -p "$android_dir")
if [[ "${UC_ANDROID_OFFLINE:-0}" == "1" ]]; then
  gradle_args+=(--offline)
fi

"$gradle_command" "${gradle_args[@]}" \
  :react-native-worklets:prefabReleasePackage \
  :react-native-reanimated:prefabReleasePackage

"$gradle_command" "${gradle_args[@]}" :app:clean bundleRelease -PucUniversalOnly
cp "$android_dir/app/build/outputs/bundle/release/app-release.aab" "$staging_dir/app-release.aab"

"$gradle_command" "${gradle_args[@]}" :app:assembleRelease -PucUniversalOnly
cp "$android_dir/app/build/outputs/apk/release/app-release.apk" \
  "$staging_dir/app-universal-release.apk"

"$gradle_command" "${gradle_args[@]}" :app:clean :app:assembleRelease

apk_dir="$android_dir/app/build/outputs/apk/release"
bundle_dir="$android_dir/app/build/outputs/bundle/release"
mkdir -p "$bundle_dir"
cp "$staging_dir/app-universal-release.apk" "$apk_dir/app-universal-release.apk"
cp "$staging_dir/app-release.aab" "$bundle_dir/app-release.aab"

for artifact in \
  "$apk_dir/app-arm64-v8a-release.apk" \
  "$apk_dir/app-armeabi-v7a-release.apk" \
  "$apk_dir/app-x86_64-release.apk" \
  "$apk_dir/app-universal-release.apk" \
  "$bundle_dir/app-release.aab"; do
  test -s "$artifact"
done
