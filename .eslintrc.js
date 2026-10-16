module.exports = {
  root: true,
  extends: '@react-native',
  ignorePatterns: ['lib/', 'example/', 'node_modules/'],
  rules: {
    'react-native/no-inline-styles': 'off',
    // The build uses the automatic JSX runtime, so React need not be in scope.
    'react/react-in-jsx-scope': 'off',
    // Single-line early returns (`if (!x) return;`) are the house style.
    curly: 'off',
  },
};
