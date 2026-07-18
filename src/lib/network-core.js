/**
 * @module network-core
 * @description Lógica central del sistema SICOP-AG: enrutamiento multi-salto
 * sobre un grafo de nodos, cifrado de extremo a extremo (E2EE) y validación
 * defensiva de mensajes entrantes. Implementado únicamente con módulos
 * nativos de Node.js (sin dependencias externas) para que pueda probarse
 * y ejecutarse en cualquier entorno limpio con solo `node` instalado.
 *
 * Esta es la implementación de referencia, documentada y cubierta por
 * pruebas unitarias (ver /test), de los mismos algoritmos que el prototipo
 * interactivo de navegador (public/index.html) implementa del lado cliente
 * con Web Crypto API para la demostración visual.
 */

'use strict';

const crypto = require('node:crypto');

/** Tipos de mensaje permitidos por el sistema. */
const ALLOWED_MESSAGE_TYPES = Object.freeze(['ORDEN', 'ALERTA', 'REPORTE', 'INFO', 'SISTEMA']);

/** Longitud máxima permitida para el contenido de un mensaje. */
const MAX_MESSAGE_LENGTH = 500;

/**
 * Error de validación con código de estado HTTP asociado, para que las
 * capas superiores (servidor) puedan responder sin filtrar detalles internos.
 */
class ValidationError extends Error {
  /**
   * @param {string} message Mensaje seguro, apto para mostrar al usuario final.
   * @param {object} [details] Detalles internos (solo para logs, nunca para el cliente).
   */
  constructor(message, details = {}) {
    super(message);
    this.name = 'ValidationError';
    this.statusCode = 400;
    this.details = details;
  }
}

/**
 * Genera una clave estable e independiente del orden para un enlace entre
 * dos nodos (a-b es equivalente a b-a).
 * @param {string} a Id del primer nodo.
 * @param {string} b Id del segundo nodo.
 * @returns {string} Clave canónica del enlace.
 */
function edgeKey(a, b) {
  return [a, b].sort().join('_');
}

/**
 * Construye el grafo de adyacencia activo a partir de la lista de nodos y
 * enlaces, excluyendo nodos fuera de línea/interferidos y enlaces cortados.
 * @param {Array<{id:string,status:string}>} nodes Lista de nodos.
 * @param {Array<{a:string,b:string,jammedLink?:boolean}>} edges Lista de enlaces.
 * @returns {Object<string,string[]>} Mapa id -> ids vecinos alcanzables.
 */
function buildActiveGraph(nodes, edges) {
  const graph = {};
  const statusById = new Map(nodes.map((n) => [n.id, n.status]));
  nodes.forEach((n) => { graph[n.id] = []; });

  edges.forEach((e) => {
    if (e.jammedLink) return;
    if (statusById.get(e.a) !== 'online' || statusById.get(e.b) !== 'online') return;
    if (!graph[e.a] || !graph[e.b]) return;
    graph[e.a].push(e.b);
    graph[e.b].push(e.a);
  });

  return graph;
}

/**
 * Búsqueda en anchura (BFS) para hallar la ruta más corta (en saltos) entre
 * dos nodos sobre un grafo de adyacencia dado. Es la base del enrutamiento
 * multi-salto descentralizado: no existe ningún nodo coordinador, solo se
 * recorre la topología activa en el momento del envío.
 * @param {string} startId Id del nodo origen.
 * @param {string} endId Id del nodo destino.
 * @param {Object<string,string[]>} graph Grafo de adyacencia (ver buildActiveGraph).
 * @returns {string[]|null} Arreglo de ids desde el origen hasta el destino
 * (ambos incluidos), o null si no existe ruta disponible.
 */
function bfsPath(startId, endId, graph) {
  if (startId === endId) return [startId];
  const visited = new Set([startId]);
  const parent = {};
  const queue = [startId];

  while (queue.length) {
    const current = queue.shift();
    for (const next of graph[current] || []) {
      if (visited.has(next)) continue;
      visited.add(next);
      parent[next] = current;
      if (next === endId) {
        const path = [endId];
        let cursor = endId;
        while (parent[cursor] !== undefined) {
          cursor = parent[cursor];
          path.unshift(cursor);
        }
        return path;
      }
      queue.push(next);
    }
  }
  return null;
}

/**
 * Calcula el porcentaje de nodos en línea alcanzables desde un nodo raíz,
 * usado como métrica de resiliencia de la red (ver README, sección Métricas).
 * @param {Array<{id:string,status:string}>} nodes Lista de nodos.
 * @param {Object<string,string[]>} graph Grafo de adyacencia activo.
 * @param {string} rootId Id del nodo raíz desde el cual medir alcanzabilidad.
 * @returns {number} Porcentaje entero (0-100) de nodos en línea alcanzables.
 */
function resiliencePercent(nodes, graph, rootId) {
  const online = nodes.filter((n) => n.status === 'online');
  if (!online.length || !graph[rootId]) return 0;

  const visited = new Set([rootId]);
  const queue = [rootId];
  while (queue.length) {
    const current = queue.shift();
    (graph[current] || []).forEach((next) => {
      if (!visited.has(next)) { visited.add(next); queue.push(next); }
    });
  }
  return Math.round((visited.size / online.length) * 100);
}

/**
 * Genera un par de claves ECDH (curva P-256) para un nodo nuevo.
 * @returns {crypto.KeyPairKeyObjectResult} Par de claves pública/privada.
 */
function generateNodeKeyPair() {
  return crypto.generateKeyPairSync('ec', { namedCurve: 'prime256v1' });
}

/**
 * Deriva la clave simétrica compartida (E2EE) entre dos nodos mediante ECDH.
 * @param {crypto.KeyObject} privateKey Clave privada del emisor.
 * @param {crypto.KeyObject} publicKey Clave pública del receptor.
 * @returns {Buffer} Material de clave de 32 bytes apto para AES-256-GCM.
 */
function deriveSharedKey(privateKey, publicKey) {
  const secret = crypto.diffieHellman({ privateKey, publicKey });
  // Se deriva una clave de 32 bytes con SHA-256 a partir del secreto ECDH
  // crudo, siguiendo la práctica estándar de no usar el secreto sin procesar.
  return crypto.createHash('sha256').update(secret).digest();
}

/**
 * Cifra un mensaje en texto plano con AES-256-GCM usando la clave compartida.
 * @param {Buffer} sharedKey Clave simétrica de 32 bytes.
 * @param {string} plaintext Texto plano a cifrar.
 * @returns {{iv:string, ciphertext:string, authTag:string}} Componentes en base64.
 */
function encryptMessage(sharedKey, plaintext) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', sharedKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), 'utf8'), cipher.final()]);
  return {
    iv: iv.toString('base64'),
    ciphertext: ciphertext.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
  };
}

/**
 * Descifra un mensaje AES-256-GCM previamente cifrado con {@link encryptMessage}.
 * @param {Buffer} sharedKey Clave simétrica de 32 bytes.
 * @param {{iv:string, ciphertext:string, authTag:string}} payload Componentes en base64.
 * @returns {string} Texto plano descifrado.
 * @throws {Error} Si la autenticación falla (mensaje alterado o clave incorrecta).
 */
function decryptMessage(sharedKey, payload) {
  const decipher = crypto.createDecipheriv('aes-256-gcm', sharedKey, Buffer.from(payload.iv, 'base64'));
  decipher.setAuthTag(Buffer.from(payload.authTag, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(payload.ciphertext, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

/**
 * Sanitiza una cadena de texto eliminando etiquetas HTML/script y caracteres
 * de control, para evitar inyección al mostrar el contenido en un cliente.
 * @param {string} input Texto sin procesar.
 * @returns {string} Texto sanitizado.
 */
function sanitizeText(input) {
  return String(input)
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001F\u007F]/g, '')
    .replace(/<[^>]*>/g, '')
    .trim();
}

/**
 * Valida y sanitiza el payload de un mensaje entrante (código defensivo /
 * BlueTeam). Nunca confía en los datos externos: valida tipo, longitud y
 * formato antes de que el dato toque cualquier lógica de negocio.
 * @param {object} payload Cuerpo recibido en la petición.
 * @param {string} payload.type Tipo de mensaje (debe estar en ALLOWED_MESSAGE_TYPES).
 * @param {string} payload.text Contenido del mensaje.
 * @param {string} [payload.fromId] Id del nodo emisor.
 * @param {string} [payload.toId] Id del nodo destino.
 * @returns {{type:string, text:string, fromId:string|null, toId:string|null}} Payload validado y sanitizado.
 * @throws {ValidationError} Si el payload no cumple el formato esperado.
 */
function validateMessagePayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    throw new ValidationError('Estructura de mensaje inválida.', { reason: 'payload_not_object' });
  }

  const { type, text, fromId, toId } = payload;

  if (typeof type !== 'string' || !ALLOWED_MESSAGE_TYPES.includes(type.toUpperCase())) {
    throw new ValidationError('Tipo de mensaje inválido.', {
      reason: 'invalid_type',
      allowed: ALLOWED_MESSAGE_TYPES,
    });
  }

  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new ValidationError('El contenido del mensaje no puede estar vacío.', { reason: 'empty_text' });
  }

  if (text.length > MAX_MESSAGE_LENGTH) {
    throw new ValidationError(`El contenido excede el máximo de ${MAX_MESSAGE_LENGTH} caracteres.`, {
      reason: 'text_too_long',
      length: text.length,
    });
  }

  if (fromId !== undefined && typeof fromId !== 'string') {
    throw new ValidationError('Identificador de emisor inválido.', { reason: 'invalid_fromId' });
  }
  if (toId !== undefined && typeof toId !== 'string') {
    throw new ValidationError('Identificador de destino inválido.', { reason: 'invalid_toId' });
  }

  return {
    type: type.toUpperCase(),
    text: sanitizeText(text),
    fromId: fromId ? sanitizeText(fromId) : null,
    toId: toId ? sanitizeText(toId) : null,
  };
}

module.exports = {
  ALLOWED_MESSAGE_TYPES,
  MAX_MESSAGE_LENGTH,
  ValidationError,
  edgeKey,
  buildActiveGraph,
  bfsPath,
  resiliencePercent,
  generateNodeKeyPair,
  deriveSharedKey,
  encryptMessage,
  decryptMessage,
  sanitizeText,
  validateMessagePayload,
};
