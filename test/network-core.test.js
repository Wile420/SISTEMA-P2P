'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');

const {
  edgeKey,
  buildActiveGraph,
  bfsPath,
  resiliencePercent,
  generateNodeKeyPair,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
  validateMessagePayload,
  sanitizeText,
  ValidationError,
} = require('../src/lib/network-core');

test('edgeKey es simétrico sin importar el orden de los ids', () => {
  assert.equal(edgeKey('a', 'b'), edgeKey('b', 'a'));
});

test('buildActiveGraph excluye nodos offline y enlaces interferidos', () => {
  const nodes = [
    { id: 'A', status: 'online' },
    { id: 'B', status: 'offline' },
    { id: 'C', status: 'online' },
  ];
  const edges = [
    { a: 'A', b: 'B' }, // B está offline: no debe aparecer en el grafo activo
    { a: 'A', b: 'C', jammedLink: true }, // enlace cortado: no debe aparecer
  ];
  const graph = buildActiveGraph(nodes, edges);
  assert.deepEqual(graph.A, []);
  assert.deepEqual(graph.C, []);
});

test('bfsPath encuentra la ruta más corta en una red multi-salto', () => {
  const nodes = ['A', 'B', 'C', 'D'].map((id) => ({ id, status: 'online' }));
  const edges = [{ a: 'A', b: 'B' }, { a: 'B', b: 'C' }, { a: 'C', b: 'D' }];
  const graph = buildActiveGraph(nodes, edges);
  const path = bfsPath('A', 'D', graph);
  assert.deepEqual(path, ['A', 'B', 'C', 'D']);
});

test('bfsPath retorna null cuando no existe ruta disponible (red particionada)', () => {
  const nodes = ['A', 'B', 'C'].map((id) => ({ id, status: 'online' }));
  const edges = [{ a: 'A', b: 'B' }]; // C queda aislado
  const graph = buildActiveGraph(nodes, edges);
  assert.equal(bfsPath('A', 'C', graph), null);
});

test('resiliencePercent refleja la caída de un nodo puente', () => {
  const nodes = ['A', 'B', 'C'].map((id) => ({ id, status: 'online' }));
  const edges = [{ a: 'A', b: 'B' }, { a: 'B', b: 'C' }];
  const fullGraph = buildActiveGraph(nodes, edges);
  assert.equal(resiliencePercent(nodes, fullGraph, 'A'), 100);

  const withBOffline = nodes.map((n) => (n.id === 'B' ? { ...n, status: 'offline' } : n));
  const partitionedGraph = buildActiveGraph(withBOffline, edges);
  const resilience = resiliencePercent(withBOffline, partitionedGraph, 'A');
  assert.ok(resilience < 100, 'la resiliencia debe bajar si se cae el nodo puente');
});

test('cifrado y descifrado E2EE (ECDH + AES-256-GCM) recuperan el texto original', () => {
  const alice = generateNodeKeyPair();
  const bob = generateNodeKeyPair();

  const keyAlice = deriveSharedKey(alice.privateKey, bob.publicKey);
  const keyBob = deriveSharedKey(bob.privateKey, alice.publicKey);
  assert.deepEqual(keyAlice, keyBob, 'ambos extremos deben derivar la misma clave compartida');

  const encrypted = encryptMessage(keyAlice, 'ORDEN: avanzar a posición Norte');
  const decrypted = decryptMessage(keyBob, encrypted);
  assert.equal(decrypted, 'ORDEN: avanzar a posición Norte');
});

test('decryptMessage lanza error si la clave o el mensaje fueron alterados', () => {
  const alice = generateNodeKeyPair();
  const bob = generateNodeKeyPair();
  const mallory = generateNodeKeyPair();

  const keyAlice = deriveSharedKey(alice.privateKey, bob.publicKey);
  const keyMallory = deriveSharedKey(mallory.privateKey, bob.publicKey);

  const encrypted = encryptMessage(keyAlice, 'mensaje confidencial');
  assert.throws(() => decryptMessage(keyMallory, encrypted));
});

test('validateMessagePayload acepta un mensaje bien formado y lo normaliza', () => {
  const result = validateMessagePayload({ type: 'orden', text: '  avanzar  ', fromId: 'n1', toId: 'n2' });
  assert.equal(result.type, 'ORDEN');
  assert.equal(result.text, 'avanzar');
});

test('validateMessagePayload rechaza un tipo de mensaje no permitido', () => {
  assert.throws(
    () => validateMessagePayload({ type: 'ATAQUE_NUCLEAR', text: 'x' }),
    ValidationError,
  );
});

test('validateMessagePayload rechaza texto vacío o excesivamente largo', () => {
  assert.throws(() => validateMessagePayload({ type: 'INFO', text: '   ' }), ValidationError);
  assert.throws(() => validateMessagePayload({ type: 'INFO', text: 'x'.repeat(501) }), ValidationError);
});

test('validateMessagePayload rechaza payloads que no son objetos', () => {
  assert.throws(() => validateMessagePayload(null), ValidationError);
  assert.throws(() => validateMessagePayload('texto suelto'), ValidationError);
  assert.throws(() => validateMessagePayload(['a', 'b']), ValidationError);
});

test('sanitizeText elimina etiquetas HTML/script y caracteres de control', () => {
  const dirty = '<script>alert(1)</script>Hola\u0007Mundo';
  assert.equal(sanitizeText(dirty), 'alert(1)HolaMundo');
});
