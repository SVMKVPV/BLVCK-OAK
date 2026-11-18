import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';

const root = resolve(process.argv[2] || 'dist');
const port = Number(process.argv[3] || 4173);
const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.webp': 'image/webp', '.mp4': 'video/mp4', '.glb': 'model/gltf-binary', '.ico': 'image/x-icon', '.webmanifest': 'application/manifest+json', '.xml': 'application/xml', '.txt': 'text/plain' };

// Static preview of dist/. Netlify Functions are not available here; API calls return 404.
createServer(async (request, response) => {
  let path = decodeURIComponent(new URL(request.url, 'http://local').pathname);
  let file = join(root, path);
  if (!file.startsWith(root)) { response.writeHead(403).end(); return; }
  try {
    if ((await stat(file)).isDirectory()) file = join(file, 'index.html');
  } catch {
    if (!extname(file)) file += '.html';
  }
  try {
    const body = await readFile(file);
    const range = request.headers.range?.match(/bytes=(\d+)-(\d*)/);
    const type = types[extname(file)] || 'application/octet-stream';
    if (range) {
      const start = Number(range[1]); const end = range[2] ? Number(range[2]) : body.length - 1;
      response.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${body.length}`, 'accept-ranges': 'bytes', 'content-length': end - start + 1 });
      response.end(body.subarray(start, end + 1));
      return;
    }
    response.writeHead(200, { 'content-type': type, 'accept-ranges': 'bytes' }).end(body);
  } catch {
    response.writeHead(404, { 'content-type': 'text/plain' }).end('Not found');
  }
}).listen(port, '0.0.0.0', () => console.log(`Serving ${root} on http://127.0.0.1:${port}`));
