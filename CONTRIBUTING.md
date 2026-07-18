# Guía de contribución — SICOP-AG

Este documento define el flujo de trabajo Git (GitFlow adaptado) que sigue
este proyecto: nombramiento de ramas, formato de commits y proceso de
Pull Request. Es de cumplimiento obligatorio para todo el equipo.

## 1. Rama principal protegida

`main` representa producción. Está protegida:

- Nadie hace `git push` directo a `main` (ni siquiera el administrador del repo).
- Todo cambio entra exclusivamente vía **Pull Request**.
- Un PR necesita como mínimo **1 aprobación** de un compañero (Peer Review).
- El PR debe pasar el pipeline de CI (`.github/workflows/ci.yml`) en verde
  (lint + pruebas unitarias) antes de poder fusionarse. Si el check está en
  rojo, el botón de merge queda bloqueado.

Cómo configurar la protección en GitHub: **Settings → Branches → Add branch
protection rule** → rama `main` → activar *"Require a pull request before
merging"* (mínimo 1 aprobación) + *"Require status checks to pass before
merging"* (seleccionar el job `build-and-test`) + *"Do not allow bypassing
the above settings"*.

## 2. Convención de nombramiento de ramas

```
<tipo>/<descripcion-corta-en-kebab-case>
```

| Tipo | Uso |
|---|---|
| `feature/` | Nueva funcionalidad (ej. `feature/broadcast-mensajes`) |
| `fix/` | Corrección de errores (ej. `fix/boton-baja-nodo`) |
| `docs/` | Cambios de documentación únicamente |
| `chore/` | Mantenimiento, dependencias, configuración |
| `test/` | Agregar o corregir pruebas |
| `refactor/` | Cambios internos sin alterar comportamiento |

Ejemplo: `feature/health-check-endpoint`.

## 3. Conventional Commits

Todos los commits siguen el estándar [Conventional Commits](https://www.conventionalcommits.org/es/):

```
<tipo>(<alcance-opcional>): <descripción en imperativo> (Tarea #N)
```

Tipos permitidos: `feat`, `fix`, `docs`, `test`, `refactor`, `chore`, `ci`, `perf`.

Ejemplos reales de este proyecto:

```
feat: implementar cifrado E2EE con ECDH+AES-256-GCM en el backend (Avance #4)
fix: reemplazar confirm() nativo por confirmación en linea (bloqueado por sandbox) (Avance #4)
test: agregar suite de pruebas unitarias para network-core (Avance #4)
docs: agregar RUNBOOK con protocolo de incidentes (Avance #6)
ci: agregar pipeline de publicacion de imagen Docker (Avance #5)
```

Cada commit o Pull Request debe referenciar el avance/tarea correspondiente
del plan de desarrollo, para poder comparar en la bitácora lo hecho vs. lo
pendiente.

## 4. Flujo de Pull Request

1. Crear la rama desde `main` actualizado: `git checkout -b feature/mi-cambio`.
2. Commitear siguiendo Conventional Commits.
3. `git push origin feature/mi-cambio`.
4. Abrir el PR contra `main`, describiendo qué se hizo y qué tarea resuelve.
5. Esperar a que el pipeline de CI termine en verde.
6. Solicitar revisión a un compañero. Atender comentarios si los hay.
7. Una vez aprobado y en verde, fusionar con **Squash and merge** (mantiene
   el historial de `main` limpio, un commit por PR).
8. Borrar la rama después de fusionar.

## 5. Definition of Done (DoD)

Un cambio no se considera terminado hasta que:

- [ ] Pasa el linter sin errores (`npm run lint`).
- [ ] Pasa las pruebas unitarias en GitHub Actions (pipeline en verde).
- [ ] Fue revisado y aprobado por otro compañero en el PR.
- [ ] Está documentado con comentarios JSDoc en el código.
- [ ] Funciona en un entorno limpio usando únicamente el `.env` (`cp .env.example .env`).
