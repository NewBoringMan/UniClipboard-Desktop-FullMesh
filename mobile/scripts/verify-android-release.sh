#!/usr/bin/env bash
set -euo pipefail

project_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
apk_dir="${1:-$project_dir/android/app/build/outputs/apk/release}"
bundle_file="${2:-$project_dir/android/app/build/outputs/bundle/release/app-release.aab}"
android_sdk="${ANDROID_SDK_ROOT:-${ANDROID_HOME:-}}"
jarsigner="${JARSIGNER:-$(command -v jarsigner || true)}"

if [[ -z "$android_sdk" ]]; then
  echo "ANDROID_SDK_ROOT or ANDROID_HOME is required" >&2
  exit 2
fi

build_tools="$(find "$android_sdk/build-tools" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
aapt="$build_tools/aapt"
apksigner="$build_tools/apksigner"

verify_apk() {
  local apk="$1"
  local expected_abis="$2"
  local badging abi_dirs

  test -s "$apk"
  badging="$($aapt dump badging "$apk")"
  grep -q "package: name='app.uniclipboard.android'" <<<"$badging"
  grep -q "sdkVersion:'24'" <<<"$badging"
  grep -q "targetSdkVersion:'36'" <<<"$badging"
  "$apksigner" verify --verbose --print-certs "$apk" | grep -q \
    'Verified using v2 scheme (APK Signature Scheme v2): true'

  abi_dirs="$(unzip -Z1 "$apk" | awk -F/ '/^lib\// {print $2}' | sort -u | paste -sd, -)"
  if [[ "$abi_dirs" != "$expected_abis" ]]; then
    echo "Unexpected ABI set in $(basename "$apk"): $abi_dirs" >&2
    exit 1
  fi

  IFS=',' read -ra abis <<<"$expected_abis"
  for abi in "${abis[@]}"; do
    unzip -Z1 "$apk" | grep -qx "lib/$abi/libuc_engine_uniffi.so"
  done
}

verify_apk "$apk_dir/app-arm64-v8a-release.apk" 'arm64-v8a'
verify_apk "$apk_dir/app-armeabi-v7a-release.apk" 'armeabi-v7a'
verify_apk "$apk_dir/app-x86_64-release.apk" 'x86_64'
verify_apk "$apk_dir/app-universal-release.apk" 'arm64-v8a,armeabi-v7a,x86_64'

test -s "$bundle_file"
unzip -tq "$bundle_file" >/dev/null

bundle_abis="$(unzip -Z1 "$bundle_file" | awk -F/ '/^base\/lib\// {print $3}' | sort -u | paste -sd, -)"
if [[ "$bundle_abis" != 'arm64-v8a,armeabi-v7a,x86_64' ]]; then
  echo "Unexpected ABI set in $(basename "$bundle_file"): $bundle_abis" >&2
  exit 1
fi
for abi in arm64-v8a armeabi-v7a x86_64; do
  unzip -Z1 "$bundle_file" | grep -qx "base/lib/$abi/libuc_engine_uniffi.so"
done

if [[ -n "${UC_ENGINE_EXPECTED_AAR:-}" ]]; then
  test -s "$UC_ENGINE_EXPECTED_AAR"
  ndk_root="${ANDROID_NDK_HOME:-}"
  if [[ -z "$ndk_root" ]]; then
    ndk_root="$(find "$android_sdk/ndk" -mindepth 1 -maxdepth 1 -type d | sort -V | tail -1)"
  fi
  llvm_strip="$ndk_root/toolchains/llvm/prebuilt/linux-x86_64/bin/llvm-strip"
  test -x "$llvm_strip"
  engine_verify_dir="$(mktemp -d)"
  trap 'rm -rf "$engine_verify_dir"' EXIT

  for abi in arm64-v8a armeabi-v7a x86_64; do
    expected="$engine_verify_dir/$abi.expected.so"
    unzip -p "$UC_ENGINE_EXPECTED_AAR" "jni/$abi/libuc_engine_uniffi.so" > "$expected"
    "$llvm_strip" --strip-unneeded "$expected"
    expected_sha="$(sha256sum "$expected" | awk '{print $1}')"

    case "$abi" in
      arm64-v8a) split_apk="$apk_dir/app-arm64-v8a-release.apk" ;;
      armeabi-v7a) split_apk="$apk_dir/app-armeabi-v7a-release.apk" ;;
      x86_64) split_apk="$apk_dir/app-x86_64-release.apk" ;;
    esac
    for archive_entry in \
      "$split_apk|lib/$abi/libuc_engine_uniffi.so" \
      "$apk_dir/app-universal-release.apk|lib/$abi/libuc_engine_uniffi.so" \
      "$bundle_file|base/lib/$abi/libuc_engine_uniffi.so"; do
      archive="${archive_entry%%|*}"
      entry="${archive_entry#*|}"
      actual_sha="$(unzip -p "$archive" "$entry" | sha256sum | awk '{print $1}')"
      if [[ "$actual_sha" != "$expected_sha" ]]; then
        echo "Engine payload mismatch: $(basename "$archive") $entry" >&2
        exit 1
      fi
    done
    echo "Engine payload $abi: $expected_sha"
  done
fi

if [[ -z "$jarsigner" ]]; then
  echo "jarsigner is required to verify the Android App Bundle" >&2
  exit 2
fi
"$jarsigner" -verify -certs "$bundle_file" 2>&1 | grep -q 'jar verified\.'

sha256sum "$apk_dir"/*.apk "$bundle_file"
