# Parche para habilitar el evento `message.sent` en openwa-api

Tu openwa-api (rmyndharis/OpenWA, basado en **whatsapp-web.js**) solo escucha el
evento `message` (entrantes). Para que emita `message.sent` (mensajes salientes,
incluidos los que escribes a mano desde el teléfono) hay que registrar el listener
`message_create` y disparar el webhook. Son **3 cambios pequeños**.

> ⚠️ Importante: `message_create` también dispara para los mensajes que envía el
> bot por la API (no solo los manuales). El filtro para no "pausarse a sí mismo"
> lo pongo yo en el chatbot, no aquí.

---

## 1) `src/engine/interfaces/whatsapp-engine.interface.ts`

Agrega `onOutgoingMessage` a la interfaz `EngineEventCallbacks`:

```typescript
export interface EngineEventCallbacks {
  onQRCode?: (qr: string) => void;
  onReady?: (phone: string, pushName: string) => void;
  onMessage?: (message: IncomingMessage) => void;
  onOutgoingMessage?: (message: IncomingMessage) => void; // <-- NUEVO
  onMessageAck?: (messageId: string, ack: number) => void;
  onDisconnected?: (reason: string) => void;
  onStateChanged?: (state: EngineStatus) => void;
}
```

## 2) `src/engine/adapters/whatsapp-web-js.adapter.ts`

Justo después del `this.client.on('message', ...)` existente, agrega:

```typescript
// Captura los mensajes SALIENTES (manuales desde el teléfono o por API)
this.client.on('message_create', async (msg) => {
  if (!msg.fromMe) return; // message_create también dispara entrantes; solo queremos los tuyos
  try {
    const outgoingMessage: IncomingMessage = {
      id: msg.id._serialized,
      from: msg.from,
      to: msg.to,
      chatId: msg.to,                          // en salientes el "chat" es el destinatario
      body: msg.body,
      type: msg.type,
      timestamp: msg.timestamp,
      fromMe: true,
      isGroup: (msg.to || '').endsWith('@g.us'),
    };
    this.callbacks.onOutgoingMessage?.(outgoingMessage);
  } catch (err) {
    this.logger?.error?.(`Error en message_create: ${(err as Error).message}`);
  }
});
```

## 3) `src/modules/session/session.service.ts`

En la llamada a `engine.initialize({ ... })`, junto al `onMessage`, agrega el
callback `onOutgoingMessage` que dispara el webhook `message.sent`:

```typescript
onOutgoingMessage: (message): void => {
  void this.sessionRepository.update(id, { lastActiveAt: new Date() });
  const messageData = { ...message };
  void this.webhookService.dispatch(id, 'message.sent', messageData as Record<string, unknown>);
  this.eventsGateway.emitMessage(id, messageData as Record<string, unknown>);
},
```

---

## Después de aplicar y desplegar

1. Reinicia/despliega el openwa-api.
2. Avísame: yo vuelvo a suscribir el chatbot a `message.sent` e implemento el
   **handoff automático** (cuando escribes a mano a un cliente → el bot se pausa
   solo en ese chat y sigue atendiendo a los demás), con el filtro para ignorar
   los envíos propios del bot.

## Cómo verificar que quedó funcionando

Con el webhook suscrito a `message.sent`, manda un WhatsApp **a mano** desde el
teléfono del bot a cualquier contacto. En los logs del chatbot debería aparecer
un evento `message.sent` con `fromMe: true`. (Yo te dejaré ese log al implementar.)
