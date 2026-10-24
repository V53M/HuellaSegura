import { EventEmitter } from 'node:events';

// Bus interno: el motor publica cambios y la API los reenvía por SSE a la plataforma web.
export const bus = new EventEmitter();
bus.setMaxListeners(100);
