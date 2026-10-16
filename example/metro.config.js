const path = require('path');
const { getDefaultConfig, mergeConfig } = require('@react-native/metro-config');

const root = path.resolve(__dirname, '..');
const escape = s => s.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&');

// The library's own devDependencies include older react / react-native copies.
// Block them so every import resolves to this app's single copy.
const singletons = ['react', 'react-native', '@babel/runtime'];

/**
 * Metro configuration for the example app. `rn-smart-tour` resolves to the
 * library's TypeScript source (../src) so edits show up without a build.
 *
 * @type {import('@react-native/metro-config').MetroConfig}
 */
const config = {
  watchFolders: [root],
  resolver: {
    blockList: singletons.map(m => new RegExp(`^${escape(path.join(root, 'node_modules', m))}\\/.*$`)),
    extraNodeModules: Object.fromEntries(singletons.map(m => [m, path.join(__dirname, 'node_modules', m)])),
    resolveRequest: (context, moduleName, platform) => {
      if (moduleName === 'rn-smart-tour') {
        return { type: 'sourceFile', filePath: path.join(root, 'src', 'index.ts') };
      }
      return context.resolveRequest(context, moduleName, platform);
    },
  },
};

module.exports = mergeConfig(getDefaultConfig(__dirname), config);
