import { createServer } from 'node:http';

const server = createServer(async (request, response) => {
  if (request.headers.authorization !== `Bearer ${process.env.SCENE_SERVICE_TOKEN}`) {
    response.writeHead(401).end();
    return;
  }
  if (request.url === '/health') {
    response.end('ready');
    return;
  }
  const chunks = [];
  for await (const chunk of request) chunks.push(chunk);
  const payload = Buffer.concat(chunks).toString();
  if (request.url === '/render') await new Promise(resolve => setTimeout(resolve, 1200));
  response.setHeader('Content-Type', 'application/json');
  response.end(JSON.stringify({ pid: process.pid, route: request.url, payload }));
});
server.listen(Number(process.env.PORT), process.env.SCENE_SERVICE_HOST);
