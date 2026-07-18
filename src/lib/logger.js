/**
 * @module logger
 * @description Logger estructurado en formato JSON (una línea por evento),
 * legible tanto por humanos en consola como por herramientas de
 * observabilidad (ej. recolectores de logs). Cada línea incluye nivel,
 * timestamp ISO 8601, mensaje y metadatos arbitrarios (incluido el
 * Correlation ID de la petición cuando aplica).
 */

'use strict';

const LEVELS = Object.freeze(['debug', 'info', 'warn', 'error']);

/**
 * Escribe una línea de log estructurado a stdout/stderr.
 * @param {'debug'|'info'|'warn'|'error'} level Nivel del evento.
 * @param {string} message Mensaje humano-legible, breve.
 * @param {object} [meta] Metadatos adicionales (correlationId, ruta, error, etc.).
 */
function log(level, message, meta = {}) {
  const entry = {
    level,
    timestamp: new Date().toISOString(),
    message,
    ...meta,
  };
  const line = JSON.stringify(entry);
  if (level === 'error' || level === 'warn') {
    process.stderr.write(line + '\n');
  } else {
    process.stdout.write(line + '\n');
  }
}

const logger = {};
LEVELS.forEach((level) => {
  logger[level] = (message, meta) => log(level, message, meta);
});

module.exports = logger;
