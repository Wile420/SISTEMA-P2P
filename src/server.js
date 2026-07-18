/**
 * @module server
 * @description Servidor del sistema SICOP-AG. Implementado únicamente con
 * el módulo nativo `http` de Node.js (cero dependencias en tiempo de
 * ejecución) para garantizar que el proyecto se pueda clonar y ejecutar en
 * cualquier entorno limpio con solo `node` instalado.
 *
 * Rutas expuestas:
 *  - GET  /health                 Estado operativo del sistema (self-healing).
 *  - POST /api/messages/validate  Valida/sanitiza y "procesa" (cifra) un mensaje.
 *  - GET  /* (estático)           Sirve el prototipo interactivo (public/).
 */

'use strict';

const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');

const logger = require('./lib/logger');
const { attachCorrelationId } = require('./middleware/correlationId');
const {
  validateMessagePayload,
  ValidationError,
  generateNodeKeyPair,
  deriveSharedKey,
  encryptMessage,
} = require('./lib/network-core');

const PORT = Number(process.env.PORT) || 3000;
const PUBLIC_DIR = path.join(__dirname, '..', 'public');
const AUDIT_LOG_PATH = path.join(__dirname, '..', 'data', 'audit.log');

const START_TIME = Date.now();

// Par de claves "de demostración" del servidor, usado únicamente para
// mostrar el cifrado E2EE real (ECDH + AES-256-GCM) sobre los mensajes
// que llegan a /api/messages/validate. No sustituye el cifrado por pares
// que hace el prototipo del navegador; es una demostración server-side
// del mismo mecanismo criptográfico, con fines de prueba automatizada.
const demoServerKeyPair = generateNodeKeyPair();

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

/**
 * Escribe una línea en la bitácora de auditoría (append-only), usada como
 * "base de datos" mínima del sistema para fines de trazabilidad y como
 * objeto de las pruebas de recuperación descritas en RUNBOOK.md.
 * @param {object} entry Entrada a registrar (se le agrega timestamp).
 */
function appendAudit(entry) {
  try {
    fs.mkdirSync(path.dirname(AUDIT_LOG_PATH), { recursive: true });
    fs.appendFileSync(AUDIT_LOG_PATH, JSON.stringify({ timestamp: new Date().toISOString(), ...entry }) + '\n');
  } catch (err) {
    // La auditoría nunca debe tumbar una petición: se registra el fallo y se continúa.
    logger.error('No se pudo escribir en la bitácora de auditoría', { error: err.message });
  }
}

/**
 * Lee el cuerpo de una petición HTTP como texto, con límite de tamaño para
 * evitar ataques de payload excesivo (defensa básica de disponibilidad).
 * @param {import('node:http').IncomingMessage} req Petición entrante.
 * @param {number} [limitBytes] Límite de tamaño en bytes.
 * @returns {Promise<string>} Cuerpo crudo como cadena.
 */
function readBody(req, limitBytes = 10_000) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > limitBytes) {
        reject(new ValidationError('El cuerpo de la petición excede el tamaño permitido.', { reason: 'payload_too_large' }));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

/**
 * Responde con un JSON, fijando cabeceras de seguridad básicas.
 * @param {import('node:http').ServerResponse} res Respuesta saliente.
 * @param {number} statusCode Código HTTP.
 * @param {object} body Cuerpo a serializar.
 */
function sendJson(res, statusCode, body) {
  const payload = JSON.stringify(body);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'X-Content-Type-Options': 'nosniff',
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

/**
 * Ruta de verificación de salud del sistema (self-healing / observabilidad).
 * @param {import('node:http').ServerResponse} res Respuesta saliente.
 */
function handleHealth(res) {
  sendJson(res, 200, {
    status: 'ok',
    uptimeSeconds: Math.round((Date.now() - START_TIME) / 1000),
    timestamp: new Date().toISOString(),
  });
}

/**
 * Valida, sanitiza y cifra (E2EE de demostración) un mensaje entrante.
 * Código defensivo: nunca deja pasar un payload sin validar y nunca expone
 * detalles internos (rutas, stack traces) en la respuesta al cliente.
 * @param {import('node:http').IncomingMessage} req Petición entrante.
 * @param {import('node:http').ServerResponse} res Respuesta saliente.
 */
async function handleValidateMessage(req, res) {
  const raw = await readBody(req);
  let payload;
  try {
    payload = JSON.parse(raw || '{}');
  } catch {
    throw new ValidationError('El cuerpo de la petición no es JSON válido.', { reason: 'invalid_json' });
  }

  const clean = validateMessagePayload(payload);

  // Cifra el texto validado con una clave efímera derivada por ECDH, como
  // demostración de "procesamiento de datos / cifrado local" (Avance #4.1).
  const ephemeral = generateNodeKeyPair();
  const sharedKey = deriveSharedKey(ephemeral.privateKey, demoServerKeyPair.publicKey);
  const encrypted = encryptMessage(sharedKey, clean.text);

  appendAudit({
    event: 'message_validated',
    correlationId: req.correlationId,
    type: clean.type,
    fromId: clean.fromId,
    toId: clean.toId,
    textLength: clean.text.length,
  });

  sendJson(res, 200, {
    status: 'accepted',
    correlationId: req.correlationId,
    type: clean.type,
    encryptedPreview: encrypted.ciphertext.slice(0, 24) + '…',
    algorithm: 'ECDH-P256 + AES-256-GCM',
  });
}

/**
 * Sirve archivos estáticos del prototipo desde /public, con protección
 * básica contra path traversal.
 * @param {import('node:http').IncomingMessage} req Petición entrante.
 * @param {import('node:http').ServerResponse} res Respuesta saliente.
 */
function handleStatic(req, res) {
  const urlPath = decodeURIComponent(req.url.split('?')[0]);
  const safePath = path.normalize(urlPath === '/' ? '/index.html' : urlPath).replace(/^(\.\.[/\\])+/, '');
  const filePath = path.join(PUBLIC_DIR, safePath);

  if (!filePath.startsWith(PUBLIC_DIR)) {
    sendJson(res, 400, { status: 'error', message: 'Ruta inválida.', correlationId: req.correlationId });
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      sendJson(res, 404, { status: 'error', message: 'Recurso no encontrado.', correlationId: req.correlationId });
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

/**
 * Manejador HTTP raíz: enruta la petición, mide su duración, adjunta el
 * Correlation ID y captura cualquier error (defensivo) sin exponer
 * información interna al cliente final.
 * @param {import('node:http').IncomingMessage} req Petición entrante.
 * @param {import('node:http').ServerResponse} res Respuesta saliente.
 */
async function requestHandler(req, res) {
  attachCorrelationId(req, res);
  const start = Date.now();

  try {
    if (req.method === 'GET' && req.url === '/health') {
      handleHealth(res);
    } else if (req.method === 'POST' && req.url === '/api/messages/validate') {
      await handleValidateMessage(req, res);
    } else if (req.method === 'GET') {
      handleStatic(req, res);
    } else {
      sendJson(res, 405, { status: 'error', message: 'Método no permitido.', correlationId: req.correlationId });
    }
  } catch (err) {
    const isValidation = err instanceof ValidationError;
    const statusCode = isValidation ? err.statusCode : 500;

    // [ERROR] con contexto completo SOLO en el log del servidor.
    logger.error(isValidation ? 'Solicitud rechazada por validación' : 'Error interno no controlado', {
      correlationId: req.correlationId,
      route: req.url,
      error: err.message,
      details: isValidation ? err.details : undefined,
      stack: isValidation ? undefined : err.stack,
    });

    // Al cliente solo llega un mensaje seguro + el Correlation ID para soporte.
    sendJson(res, statusCode, {
      status: 'error',
      message: isValidation ? err.message : 'Ocurrió un error. Reporte el código: ' + req.correlationId,
      correlationId: req.correlationId,
    });
  } finally {
    logger.info('request', {
      correlationId: req.correlationId,
      method: req.method,
      route: req.url,
      statusCode: res.statusCode,
      durationMs: Date.now() - start,
    });
  }
}

const server = http.createServer((req, res) => {
  requestHandler(req, res).catch((err) => {
    logger.error('Error no capturado en el manejador de peticiones', { error: err.message, stack: err.stack });
    if (!res.headersSent) sendJson(res, 500, { status: 'error', message: 'Error interno.' });
  });
});

// Defensa a nivel de proceso: nunca morir en silencio (Avance #4.3).
process.on('uncaughtException', (err) => {
  logger.error('[ERROR] uncaughtException', { error: err.message, stack: err.stack });
});
process.on('unhandledRejection', (reason) => {
  logger.error('[ERROR] unhandledRejection', { reason: String(reason) });
});

if (require.main === module) {
  server.listen(PORT, () => {
    logger.info('Servidor SICOP-AG iniciado', { port: PORT, pid: process.pid });
  });
}

module.exports = { server, requestHandler };
