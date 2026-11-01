// https://docs.expo.dev/guides/using-eslint/
const { defineConfig } = require('eslint/config');
const expoConfig = require('eslint-config-expo/flat');

module.exports = defineConfig([
  expoConfig,
  {
    ignores: ['dist/*'],
  },
  {
    // Icon governance: new code must use the unified <Icon> from
    // @/src/components/Icon, not @expo/vector-icons directly.
    files: ['**/*.{ts,tsx}'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@expo/vector-icons',
              message:
                'Do not import @expo/vector-icons directly. Use the unified <Icon> from @/src/components/Icon (semantic names in docs/ICONS.md; raw Ionicons glyph names also work as a fallback).',
            },
          ],
        },
      ],
    },
  },
  {
    // The Icon wrapper and the tab layout legitimately touch the raw families.
    files: ['src/components/Icon.tsx', 'app/(tabs)/_layout.tsx'],
    rules: { 'no-restricted-imports': 'off' },
  },
]);
