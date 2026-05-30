# Guía de Contribución: Sistema de Mensajería Táctica P2P (Batallón Girardot)

Bienvenido al repositorio oficial del sistema de mensajería descentralizada. Este documento establece los estándares de ingeniería y metodologías ágiles que todo desarrollador debe seguir para garantizar la calidad, trazabilidad y seguridad del código base.

---

## 1. Estrategia de Ramas (Adaptación de GitFlow)

Nadie tiene permitido hacer un `push` directo a la rama `main` ni a la rama `develop`. Todo el trabajo debe realizarse en ramas aisladas y someterse a revisión.

| Tipo de Rama | Nomenclatura Estándar | Propósito y Destino |
| :--- | :--- | :--- |
| **Producción** | `main` | Código 100% estable, probado y listo para despliegue operativo. Es intocable directamente. |
| **Integración** | `develop` | Refleja el estado actual del desarrollo. Todas las nuevas funcionalidades convergen aquí. |
| **Funcionalidad** | `feature/nombre-corto` | Desarrollo de nuevas características. Nacen de `develop` y se fusionan de vuelta a `develop`. |
| **Corrección** | `bugfix/descripcion-error` | Solución de errores en la fase de desarrollo. Nacen y vuelven a `develop`. |
| **Emergencia** | `hotfix/falla-critica` | Parches urgentes en producción. Nacen de `main` y se fusionan tanto en `main` como en `develop`. |

---

## 2. Estándar de la Bitácora (Conventional Commits)

Mantener un historial limpio es crítico para la trazabilidad del proyecto. Todo mensaje de commit debe seguir la siguiente estructura: `tipo(ámbito opcional): descripción corta en minúsculas`.

| Tipo | Uso Cuándo... | Ejemplo de Commit |
| :--- | :--- | :--- |
| `feat` | Se añade una nueva funcionalidad al sistema. | `feat(p2p): implementar descubrimiento mdns` |
| `fix` | Se soluciona un error en el código. | `fix(ui): corregir desbordamiento de texto en chat` |
| `chore` | Se actualizan configuraciones, dependencias o herramientas. | `chore: actualizar libreria libp2p a v0.45` |
| `docs` | Se agregan o modifican documentos técnicos o README. | `docs: añadir diagramas de arquitectura` |
| `refactor`| Se mejora el código sin añadir funciones ni arreglar bugs. | `refactor(crypto): optimizar algoritmo de cifrado e2ee` |
| `test` | Se añaden o corrigen pruebas automatizadas. | `test(auth): agregar validacion de codigo militar` |

---

## 3. Flujo Obligatorio de Trabajo y Pull Requests (PR)

Para integrar tu código al proyecto, debes cumplir estrictamente con los siguientes pasos, en concordancia con nuestra Definición de Terminado (Definition of Done):

1. Actualiza tu rama local `develop` para sincronizar los últimos cambios del equipo.
2. Crea tu rama de trabajo siguiendo la nomenclatura de GitFlow (Ej: `git checkout -b feature/cifrado-mensajes`).
3. Realiza tus desarrollos haciendo commits pequeños, atómicos y usando el estándar de *Conventional Commits*.
4. Sube tu rama al repositorio remoto en GitHub.
5. Abre un **Pull Request (PR)** apuntando desde tu rama hacia `develop` (o hacia `main` si es un release programado).
6. Espera la ejecución automática y el estado "Verde" del Pipeline de Integración Continua (CI/CD).
7. Obtén la aprobación obligatoria (Approve) de al menos un (1) compañero de equipo mediante un **Peer Review**.
8. Una vez aprobado y con las pruebas pasadas, realiza el *Merge* y elimina la rama temporal de GitHub para mantener el repositorio limpio.