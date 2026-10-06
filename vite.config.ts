import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

// base './' : les chemins sont relatifs, l'app marche aussi bien à la racine
// d'un domaine que dans un sous-dossier (https://<pseudo>.github.io/MailSort/).
export default defineConfig({
  base: './',
  plugins: [react()],
  build: {
    target: 'es2022',
  },
  test: {
    include: ['tests/**/*.test.ts'],
    environment: 'node',
  },
});
