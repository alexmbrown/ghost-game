import nextVitals from 'eslint-config-next/core-web-vitals';
import nextTs from 'eslint-config-next/typescript';
import { defineConfig, globalIgnores } from 'eslint/config';

export default defineConfig([
  ...nextVitals,
  ...nextTs,
  globalIgnores(['.next/**', 'out/**', 'build/**', 'next-env.d.ts', 'public/**']),
  {
    rules: {
      // Three.js render loops mutate refs/objects every frame by design.
      'react-hooks/immutability': 'off',
      'react-hooks/refs': 'off',
    },
  },
]);
