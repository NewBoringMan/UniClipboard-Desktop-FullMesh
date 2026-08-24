import { ConfigPlugin, withAppBuildGradle, createRunOncePlugin } from 'expo/config-plugins';

/**
 * Configures Android ABI splits so that separate APKs are built for
 * every CPU architecture published by the independent core Release.
 *
 * The universal APK is the simplest sideloading artifact, while the three
 * split APKs make architecture-specific distribution and verification
 * possible. This must stay in sync with
 * `reactNativeArchitectures` in `withGradleBuildTuning.ts`.
 *
 * The universal APK and AAB are built in a separate `-PucUniversalOnly`
 * invocation. AGP 8.12 emits incomplete APK split archives when application
 * abiFilters and enabled ABI splits are combined in the same invocation.
 *
 * All variants share the same versionCode (no per-ABI offset).
 */
const withAbiSplits: ConfigPlugin = (config) => {
  return withAppBuildGradle(config, (config) => {
    let contents = config.modResults.contents;
    const obsoleteExcludes =
      'excludes += ["**/armeabi/*.so", "**/mips/*.so", "**/mips64/*.so", "**/x86/*.so"]';
    contents = contents.replace(`\n            ${obsoleteExcludes}`, '');

    if (!contents.includes('ucUniversalOnly')) {
      contents = contents.replace(
        /defaultConfig\s*\{/,
        (match) => `${match}
        if (project.hasProperty("ucUniversalOnly")) {
            ndk {
                abiFilters "armeabi-v7a", "arm64-v8a", "x86_64"
            }
        }`
      );
    }

    // --- 1. splits block ---
    const splitsConfig = `
    splits {
        abi {
            enable !project.hasProperty("ucUniversalOnly")
            reset()
            include "armeabi-v7a", "arm64-v8a", "x86_64"
            universalApk false
        }
    }
`;

    if (!contents.includes('splits {')) {
      const androidBlockMatch = contents.match(/^android\s*\{[\s\S]*?\n\}/m);
      if (androidBlockMatch) {
        const androidBlock = androidBlockMatch[0];
        const modified = androidBlock.replace(/\n\}$/, splitsConfig + '\n}');
        contents = contents.replace(androidBlock, modified);
        console.log('✓ Added splits configuration to build.gradle');
      }
    } else {
      // Splits already present (a re-prebuild without --clean). Rewrite the
      // `include` line in place so stale ABIs are dropped and stay in sync with
      // the independent core Release.
      const includeRe = /include\s+[^\n]*/;
      if (includeRe.test(contents)) {
        contents = contents.replace(includeRe, 'include "armeabi-v7a", "arm64-v8a", "x86_64"');
        console.log('✓ Updated splits include list in build.gradle');
      } else {
        console.log('ℹ splits already configured in build.gradle');
      }
    }

    contents = contents.replace(
      /enable\s+(true|false|!project\.hasProperty\("ucUniversalOnly"\))/,
      'enable !project.hasProperty("ucUniversalOnly")'
    );
    config.modResults.contents = contents.replace(
      /universalApk\s+(true|false)/,
      'universalApk false'
    );

    return config;
  });
};

export default createRunOncePlugin(withAbiSplits, 'withAbiSplits', '3.0.0');
