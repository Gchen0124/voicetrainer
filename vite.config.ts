import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { transcriptApiMiddleware } from './server/transcriptApi'

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => {
  // Cast process to any to avoid TS error: Property 'cwd' does not exist on type 'Process'
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [
      react(),
      {
        name: 'transcript-api',
        configureServer(server) {
          // Add our custom API middleware for YouTube transcript fetching
          server.middlewares.use(transcriptApiMiddleware);
        }
      }
    ],
    define: {
      // This enables process.env.API_KEY usage in the client code
      'process.env.API_KEY': JSON.stringify(env.API_KEY)
    }
  }
})