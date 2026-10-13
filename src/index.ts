/**
 * Ponto de entrada. Confere a versão do Node antes de carregar qualquer módulo:
 * o Gateway usa o WebSocket nativo (Node 22+) e o Prisma 7 exige Node 22.12+.
 */
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 12) || typeof WebSocket === 'undefined') {
  process.stderr.write(`Node ${process.versions.node} não é suportado: instale o Node 22.12 ou mais novo (https://nodejs.org).\n`);
  process.exit(1);
}

await import('./app.js');
