/**
 * @module middleware/correlationId
 * @description Asigna un identificador único (UUID v4) a cada petición
 * entrante. Este Correlation ID viaja en la cabecera de respuesta
 * `X-Correlation-Id` y se incluye en todos los logs y mensajes de error
 * asociados a esa petición, para poder rastrear un incidente de punta a
 * punta sin exponer detalles internos al usuario final.
 */

'use strict';

const crypto = require('node:crypto');

/**
 * Genera y adjunta un Correlation ID a la petición/respuesta HTTP nativas.
 * @param {import('node:http').IncomingMessage} req Petición entrante.
 * @param {import('node:http').ServerResponse} res Respuesta saliente.
 */
function attachCorrelationId(req, res) {
  const incoming = req.headers['x-correlation-id'];
  const correlationId = typeof incoming === 'string' && incoming.length <= 100
    ? incoming
    : crypto.randomUUID();
  req.correlationId = correlationId;
  res.setHeader('X-Correlation-Id', correlationId);
}

module.exports = { attachCorrelationId };
