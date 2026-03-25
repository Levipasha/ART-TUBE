const http = require('http');
const { getApp } = require('./app');

const PORT = Number(process.env.PORT || 4000);

async function main() {
  const app = await getApp();
  const server = http.createServer(app);
  server.listen(PORT, () => {
    console.log(`ARTTUBE backend listening on http://localhost:${PORT}`);
  });
}

if (require.main === module) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}

