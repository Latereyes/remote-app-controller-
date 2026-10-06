// App finta per i test: risponde su PORT, accetta la chiusura gentile con il token giusto.
import http from 'node:http';

const server = http.createServer((req, res) => {
  if (req.url === '/shutdown' && req.method === 'POST') {
    const ok = req.headers['x-control-token'] === process.env.CONTROL_TOKEN;
    res.writeHead(ok ? 200 : 403).end();
    if (ok) { console.log('chiusura gentile'); setTimeout(() => process.exit(0), 50); }
    return;
  }
  res.writeHead(200).end('ok');
});
setTimeout(() => server.listen(Number(process.env.PORT), '127.0.0.1', () => console.log(`\x1b[32mpronto\x1b[0m su ${process.env.PORT}`)), Number(process.env.DELAY_MS || 0));
