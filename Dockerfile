# SICOP-AG — artefacto inmutable de producción.
# Sin dependencias de runtime: solo necesita el motor de Node.js.

FROM node:20-alpine

WORKDIR /app

# Copiamos primero el manifiesto para aprovechar la cache de capas de Docker.
COPY package.json ./
COPY src ./src
COPY public ./public

ENV NODE_ENV=production
ENV PORT=3000

EXPOSE 3000

RUN chown -R node:node /app

# Verificación de salud usada por Docker/orquestadores para detectar procesos
# colgados y activar la política de reinicio (self-healing).
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD node -e "require('http').get('http://localhost:'+(process.env.PORT||3000)+'/health', r => process.exit(r.statusCode===200?0:1)).on('error', () => process.exit(1))"

USER node

CMD ["node", "src/server.js"]
