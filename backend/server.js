import { createServer } from 'node:http';
import { handleNodeRequest } from './src/app.js';

const port = Number(process.env.PORT || 3001);
const host = process.env.HOST || '0.0.0.0';

const server = createServer((req, res) => {
  handleNodeRequest(req, res).catch((error) => {
    console.error('[server] Unhandled error:', error);
    if (res.headersSent) {
      res.end();
      return;
    }

    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Internal server error' }));
  });
});

server.listen(port, host, () => {
  console.log(`[server] Listening on http://${host}:${port}`);
});
