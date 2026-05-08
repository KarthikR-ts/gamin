import { defineConfig } from 'vite';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export default defineConfig({
  server: {
    port: 3000,
    strictPort: true,
  },
  plugins: [
    {
      name: 'serve-public-index',
      configureServer(server) {
        // Intercept requests to serve public/index.html as the entry point
        server.middlewares.use((req, res, next) => {
          const url = req.url ? req.url.split('?')[0] : '';
          if (url === '/' || url === '/index.html') {
            const htmlPath = path.resolve(__dirname, 'public/index.html');
            try {
              const html = fs.readFileSync(htmlPath, 'utf-8');
              server.transformIndexHtml(req.url || '/', html)
                .then(transformedHtml => {
                  res.statusCode = 200;
                  res.setHeader('Content-Type', 'text/html');
                  res.end(transformedHtml);
                })
                .catch(next);
            } catch (err) {
              next(err);
            }
          } else {
            next();
          }
        });
      }
    }
  ]
});
