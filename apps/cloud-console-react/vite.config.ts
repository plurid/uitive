import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { uitive } from '../../tools/vite/uitive.ts';

export default defineConfig({
  plugins: [uitive({ handler: '/src/server.ts' }), react()],
  server: { port: 5171 },
});
