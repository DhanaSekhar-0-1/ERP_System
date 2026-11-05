const { withAppBuildGradle } = require('expo/config-plugins');

const ARGUMENT = 'arguments "-DCMAKE_OBJECT_PATH_MAX=250"';

/**
 * Windows build tools fail on paths over 260 characters, and native object paths under
 * node_modules exceed that. This makes CMake replace long object paths with short hashes.
 */
module.exports = (config) =>
  withAppBuildGradle(config, (result) => {
    if (!result.modResults.contents.includes(ARGUMENT)) {
      result.modResults.contents = result.modResults.contents.replace(
        /defaultConfig\s*\{/,
        (match) => `${match}\n        externalNativeBuild { cmake { ${ARGUMENT} } }`,
      );
    }
    return result;
  });
