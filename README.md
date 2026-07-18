# SICOP-AG — Sistema de Comunicación P2P

Prototipo funcional de un sistema de comunicación peer-to-peer descentralizado,
desarrollado como parte de un proyecto de grado universitario.

## Contenido

- `sicop-ag.html` / `index.html` — prototipo autocontenido (HTML + CSS + JS,
  sin dependencias de servidor). Ambos archivos son idénticos; `index.html`
  existe para que GitHub Pages pueda publicarlo automáticamente.

## Funciones implementadas

- Igualdad funcional de nodos (cualquiera puede emitir, recibir o repetir).
- Enrutamiento multi-salto descentralizado (BFS sobre topología activa).
- Autodescubrimiento y autocuración de la red.
- Tolerancia a fallos y simulación de interferencia/DDoS.
- Red tolerante a retardos (DTN) con cola de reintento automático.
- Cifrado de extremo a extremo real (ECDH P-256 + AES-256-GCM, Web Crypto API).
- Difusión de un mismo mensaje a todos los nodos.
- Control de acceso por sesión (código de comandante vs. operador regular).
- Baja permanente de nodos (solo comandante) con notificación a la red.

## Cómo verlo

Abre `index.html` directamente en cualquier navegador moderno, o publícalo
gratis con **GitHub Pages**: *Settings → Pages → Deploy from branch → main → /(root)*.

## Alcance

Este es un prototipo de simulación de la lógica de red dentro del navegador,
correspondiente a la fase de diseño de un proyecto factible. No implementa
transporte físico entre dispositivos (Bluetooth/Wi-Fi Direct/radio).
