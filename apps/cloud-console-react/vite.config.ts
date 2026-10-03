import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { aptuitive } from '../../tools/vite/aptuitive.ts';

export default defineConfig({
  plugins: [aptuitive({ handler: '/src/server.ts' }), react()],
  server: { port: 5171 },
});
