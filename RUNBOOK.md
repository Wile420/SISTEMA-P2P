# RUNBOOK — SICOP-AG

Guía de primeros auxilios operativos del sistema. Este documento es la
**única fuente de verdad** para atender incidentes: en un ejercicio de caos,
los pasos ejecutados deben coincidir exactamente con lo aquí descrito.

---

## Fase 1 — Diagnóstico

Comandos y URLs exactas para verificar el estado del sistema ante un
incidente reportado.

### 1.1 Verificar salud del servicio

```bash
curl -s https://<host-de-produccion>/health
```

Respuesta esperada (HTTP 200):
```json
{ "status": "ok", "uptimeSeconds": 12345, "timestamp": "2026-07-19T12:00:00.000Z" }
```

- Si no responde o responde distinto de 200 → el proceso está caído o colgado. Ir a **Fase 2**.

### 1.2 Verificar el contenedor (si se corre con Docker/Compose)

```bash
docker ps --filter "name=sicop-ag"
docker inspect --format='{{.State.Health.Status}}' sicop-ag
```

### 1.3 Revisar los últimos logs estructurados

```bash
docker logs --tail 100 sicop-ag
```

Cada línea es JSON. Filtra por nivel de error:

```bash
docker logs sicop-ag 2>&1 | grep '"level":"error"'
```

### 1.4 Rastrear un incidente puntual por Correlation ID

Todo error visible para un usuario incluye un código: *"Ocurrió un error.
Reporte el código: `<uuid>`"*. Con ese UUID:

```bash
docker logs sicop-ag 2>&1 | grep "<uuid>"
```

Esto reconstruye la petición completa (ruta, error real, duración) sin
haber expuesto esos detalles al usuario final.

---

## Fase 2 — Protocolo ante caídas (niveles de escalado)

### Nivel L1 — Auto-recuperación (automática, 0 intervención humana)

El contenedor está configurado con `restart: unless-stopped` (ver
`docker-compose.yml`) y un `HEALTHCHECK` cada 30s. Si el proceso muere o
deja de responder salud, el motor de contenedores lo reinicia solo.
**No se requiere acción** — solo confirmar que se recuperó:

```bash
watch -n 5 curl -s https://<host-de-produccion>/health
```

Si tras **3 reinicios automáticos** (~2-3 min) sigue sin estabilizarse →
escalar a L2.

### Nivel L2 — Intervención manual del operador de turno

1. Confirmar el diagnóstico (Fase 1).
2. Reiniciar manualmente el servicio:
   ```bash
   docker compose restart sicop-ag
   ```
3. Si el contenedor no arranca, reconstruir la imagen desde el último
   commit sano de `main`:
   ```bash
   docker compose build --no-cache sicop-ag
   docker compose up -d sicop-ag
   ```
4. Verificar `/health` nuevamente.
5. Si se resuelve → documentar el incidente (causa raíz, hora, Correlation
   IDs involucrados) en un issue de GitHub etiquetado `incident`.

Si persiste el fallo tras reconstruir → escalar a L3.

### Nivel L3 — Incidente mayor / posible pérdida de datos

1. Congelar despliegues: pausar el pipeline de CD (deshabilitar temporalmente
   el workflow `cd-docker-publish.yml` desde la pestaña *Actions*).
2. Notificar al equipo completo (canal de incidentes).
3. Si hay sospecha de corrupción de datos → pasar a **Fase 3**.
4. Levantar el último artefacto Docker estable conocido:
   ```bash
   docker pull ghcr.io/<usuario>/sistema-p2p:<sha-del-ultimo-commit-sano>
   docker compose up -d
   ```

---

## Fase 3 — Recuperación ante desastres (corrupción total de datos)

Aplica la regla **3-2-1**: 3 copias de los datos, en 2 medios distintos,
1 de ellas fuera del entorno de producción.

### 3.1 Qué se respalda

El estado persistente del sistema es la bitácora de auditoría
(`data/audit.log`, JSON Lines, montada como volumen Docker `audit-data`).

### 3.2 Procedimiento de respaldo (preventivo, antes del desastre)

```bash
# Copia local (medio 1)
docker cp sicop-ag:/app/data/audit.log ./backups/audit-$(date +%Y%m%d-%H%M).log

# Copia a almacenamiento externo (medio 2, ej. bucket S3/Drive) - fuera del host
# de producción, cumpliendo la parte "1 offsite" de la regla 3-2-1.
```

Se recomienda automatizar este paso con un cron diario.

### 3.3 Procedimiento de restauración exacto (ante corrupción total)

1. Detener el servicio afectado:
   ```bash
   docker compose down
   ```
2. Eliminar el volumen corrupto:
   ```bash
   docker volume rm sistema-p2p_audit-data
   ```
3. Recrear el volumen y restaurar el respaldo más reciente válido:
   ```bash
   docker volume create sistema-p2p_audit-data
   docker run --rm -v sistema-p2p_audit-data:/app/data -v "$(pwd)/backups":/backup \
     alpine sh -c "cp /backup/audit-<fecha-del-respaldo-mas-reciente>.log /app/data/audit.log"
   ```
4. Reconstruir y levantar el sistema desde el último commit sano de `main`:
   ```bash
   git checkout main && git pull
   docker compose build --no-cache
   docker compose up -d
   ```
5. Verificar salud e integridad:
   ```bash
   curl -s https://<host-de-produccion>/health
   docker exec sicop-ag cat /app/data/audit.log | tail -5
   ```
6. Confirmar con el equipo que el sistema está 100% operativo y documentar
   el incidente (causa raíz, ventana de datos perdida entre el último
   respaldo y el desastre, acciones correctivas).

---

## Referencia rápida

| Situación | Acción |
|---|---|
| `/health` no responde | Fase 1.1 → 1.2 → esperar auto-recuperación (L1) |
| Reinicios automáticos no estabilizan | Escalar a L2 |
| Corrupción de `data/audit.log` | Fase 3 completa |
| Pipeline de CI en rojo bloqueando un PR | Ver log del job en Actions, corregir, no forzar merge |
