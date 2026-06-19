import TelegramBot from 'node-telegram-bot-api';

export function initTelegramBot({ cache, dbSet, dbUpdate, dbAdd, dbDelete, client }) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const adminChatId = process.env.TELEGRAM_ADMIN_CHAT_ID;

  if (!token) {
    console.warn('⚠️ [Telegram Bot] No se ha configurado la variable TELEGRAM_BOT_TOKEN en .env. El bot de Telegram no se iniciará.');
    return {
      sendMessage: () => {},
      notificarAdmin: () => {}
    };
  }

  const bot = new TelegramBot(token, { polling: true });
  console.log('🤖 [Telegram Bot] Inicializado correctamente.');

  // Controlar las sesiones locales de los comandos del bot de Telegram
  // Por ejemplo, para el flujo de retiros.
  const tgSessions = {}; // chatId -> { estado: 'idle', montoRetiro: 0 }

  // Función para enviar notificaciones al administrador
  const notificarAdmin = (mensaje) => {
    if (adminChatId) {
      bot.sendMessage(adminChatId, mensaje, { parse_mode: 'Markdown' }).catch(err => {
        console.error('❌ [Telegram Bot] Error al enviar notificación al admin:', err.message);
      });
    }
  };

  // Escuchar mensajes
  bot.on('message', async (msg) => {
    const chatId = msg.chat.id;
    const text = (msg.text || '').trim();

    // 1. Manejar cuando el usuario comparte su número de contacto
    if (msg.contact) {
      const rawPhone = msg.contact.phone_number;
      // Limpiar el teléfono para dejar solo dígitos
      const cleanPhone = rawPhone.replace(/\D/g, '');
      
      // Buscar cliente en el caché
      let clienteData = cache.clientes.find(c => c.telefono === cleanPhone || c.id === cleanPhone);

      if (!clienteData) {
        // Registrar cliente si no existe en el sistema
        clienteData = {
          id: cleanPhone,
          nombre: msg.contact.first_name || 'Usuario Telegram',
          telefono: cleanPhone,
          clienteJid: `${cleanPhone}@c.us`,
          deuda: 0,
          totalJugado: 0,
          telegramChatId: chatId.toString(),
          fechaRegistro: new Date().toISOString()
        };
        await dbSet('clientes', cleanPhone, clienteData);
        console.log(`👤 Nuevo cliente registrado desde Telegram: ${clienteData.nombre} (${cleanPhone})`);
      } else {
        // Vincular telegramChatId
        clienteData.telegramChatId = chatId.toString();
        await dbUpdate('clientes', clienteData.id, { telegramChatId: chatId.toString() });
        console.log(`🔗 Cliente vinculado con Telegram ID ${chatId}: ${clienteData.nombre} (${cleanPhone})`);
      }

      await bot.sendMessage(
        chatId, 
        `🎉 *¡Cuenta vinculada con éxito!* 🎉\n\nBienvenido, *${clienteData.nombre}*.\n\nAhora puedes usar los siguientes comandos:\n\n📊 /saldo o /deuda - Consulta tu saldo actual\n🎟️ /ticket <numero> - Consulta el estado de un ticket\n💰 /retiro <monto> - Solicita un retiro de tu saldo a favor\n❓ /help - Muestra esta ayuda`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // 2. Comandos básicos sin vinculación
    if (text.startsWith('/start') || text.startsWith('/help')) {
      await bot.sendMessage(
        chatId,
        `🍀 *¡Bienvenido al Bot de la Agencia Betagama!* 🍀\n\nPara poder usar este bot, necesitamos vincular tu cuenta con tu número de teléfono.\n\nPor favor, presiona el botón de abajo para compartir tu contacto de Telegram 👇`,
        {
          reply_markup: {
            keyboard: [
              [{ text: '📱 Compartir mi número de contacto', request_contact: true }]
            ],
            one_time_keyboard: true,
            resize_keyboard: true
          }
        }
      );
      return;
    }

    // 3. Verificar si el usuario está vinculado
    const cliente = cache.clientes.find(c => c.telegramChatId === chatId.toString());
    if (!cliente) {
      await bot.sendMessage(
        chatId,
        `⚠️ *Cuenta no vinculada*\n\nPor favor, escribe /start para compartir tu número de contacto y vincular tu cuenta primero.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // 4. Manejo de estado de la sesión de Telegram (para el flujo de retiro)
    const session = tgSessions[chatId] || { estado: 'idle' };

    if (session.estado === 'esperando_pago_movil') {
      if (text.toLowerCase() === 'cancelar' || text.toLowerCase() === '/cancelar') {
        tgSessions[chatId] = { estado: 'idle' };
        await bot.sendMessage(chatId, `❌ *Retiro cancelado.*`);
        return;
      }

      const datosPago = text;
      const monto = session.montoRetiro;

      // Registrar solicitud de retiro en el caché y Firestore
      const retiroId = 'retiro_' + Math.random().toString(36).substring(2, 11);
      const timestamp = new Date().toISOString();

      const nuevoRetiro = {
        id: retiroId,
        clienteTelefono: cliente.telefono,
        clienteNombre: cliente.nombre,
        clienteJid: cliente.clienteJid || `${cliente.telefono}@c.us`,
        monto: monto,
        datosPagoMovil: datosPago,
        estado: 'pendiente', // pendiente, completado, rechazado
        fecha: timestamp,
        referencia: '',
        comentario: ''
      };

      await dbSet('retiros', retiroId, nuevoRetiro);

      // Actualizar balance del cliente
      const nuevaDeuda = (cliente.deuda || 0) + monto;
      cliente.deuda = nuevaDeuda;
      await dbUpdate('clientes', cliente.id, { deuda: nuevaDeuda });

      await bot.sendMessage(
        chatId,
        `✅ *¡Solicitud de retiro registrada con éxito!* \n\nTu retiro de *Bs. ${monto.toLocaleString('de-DE')}* ha sido registrado. Te notificaremos cuando tu Pago Móvil sea procesado por la administración.`,
        { parse_mode: 'Markdown' }
      );

      // Alerta al admin
      notificarAdmin(
        `💰 *Nueva Solicitud de Retiro (Telegram)* 💰\n\n*Cliente:* ${cliente.nombre} (${cliente.telefono})\n*Monto:* Bs. ${monto.toLocaleString('de-DE')}\n*Pago Móvil:* ${datosPago}`
      );

      tgSessions[chatId] = { estado: 'idle' };
      return;
    }

    // 5. Procesar comandos normales
    const args = text.split(' ');
    const command = args[0].toLowerCase();

    // FLUJO: Deuda/Saldo
    if (command === '/saldo' || command === '/deuda') {
      const saldoFavor = cliente.deuda < 0 ? Math.abs(cliente.deuda) : 0;
      if (cliente.deuda > 0) {
        await bot.sendMessage(
          chatId,
          `📊 *Balance de Cuenta*\n\nTienes una deuda pendiente de *Bs. ${cliente.deuda.toLocaleString('de-DE')}*.`,
          { parse_mode: 'Markdown' }
        );
      } else if (saldoFavor > 0) {
        await bot.sendMessage(
          chatId,
          `📊 *Balance de Cuenta*\n\nTienes un saldo a favor de *Bs. ${saldoFavor.toLocaleString('de-DE')}*.`,
          { parse_mode: 'Markdown' }
        );
      } else {
        await bot.sendMessage(
          chatId,
          `📊 *Balance de Cuenta*\n\nNo tienes deudas pendientes ni saldo a favor. ¡Estás al día!`,
          { parse_mode: 'Markdown' }
        );
      }
      return;
    }

    // FLUJO: Ver Ticket
    if (command === '/ticket') {
      const ticketNum = args[1];
      if (!ticketNum) {
        await bot.sendMessage(chatId, `⚠️ *Uso incorrecto*\n\nEscribe el comando indicando el número de ticket. Ejemplo: /ticket 123456`, { parse_mode: 'Markdown' });
        return;
      }

      // Buscar apuestas de este ticket
      const ticketJugadas = cache.jugadas.filter(j => j.ticketNumero === ticketNum);
      if (ticketJugadas.length === 0) {
        await bot.sendMessage(chatId, `❌ *Ticket no encontrado*\n\nNo encontramos ninguna jugada registrada bajo el ticket #${ticketNum}.`, { parse_mode: 'Markdown' });
        return;
      }

      // Verificar que el ticket pertenezca al cliente (por número de teléfono)
      const primerJugada = ticketJugadas[0];
      if (primerJugada.clienteTelefono !== cliente.telefono) {
        await bot.sendMessage(chatId, `🔒 *Acceso denegado*\n\nEste ticket no corresponde a tu número de teléfono registrado.`, { parse_mode: 'Markdown' });
        return;
      }

      const totalTicket = ticketJugadas.reduce((sum, j) => sum + j.monto, 0);
      const items = ticketJugadas.map(j => {
        let emoji = '⏳';
        if (j.estado === 'ganadora') emoji = '🏆';
        else if (j.estado === 'jugada') emoji = '✅';
        else if (j.estado === 'anulada') emoji = '❌';
        
        return `- *${j.valor}*: Bs. ${j.monto.toLocaleString('de-DE')} [${j.estado.toUpperCase()} ${emoji}]`;
      }).join('\n');

      const header = `🎟️ *Ticket #${ticketNum}*\n\n*Lotería:* ${primerJugada.loteria.toUpperCase()}\n*Sorteo:* ${primerJugada.sorteoHora} (${primerJugada.sorteoFecha})\n*Modalidad:* ${primerJugada.estadoPago === 'pagado' ? 'PAGADO ✅' : 'CRÉDITO (Fiado) 📝'}\n\n*Jugadas:*\n${items}\n\n*Monto Total:* Bs. *${totalTicket.toLocaleString('de-DE')}*`;

      await bot.sendMessage(chatId, header, { parse_mode: 'Markdown' });
      return;
    }

    // FLUJO: Retiro
    if (command === '/retiro') {
      const montoStr = args[1];
      if (!montoStr) {
        await bot.sendMessage(chatId, `⚠️ *Uso incorrecto*\n\nEscribe el comando indicando el monto a retirar. Ejemplo: /retiro 500`, { parse_mode: 'Markdown' });
        return;
      }

      // Normalizar monto
      let cleaned = montoStr.replace(/[^0-9,.]/g, '');
      if (cleaned.includes('.') && cleaned.includes(',')) {
        cleaned = cleaned.replace(/\./g, '').replace(',', '.');
      } else if (cleaned.includes(',')) {
        cleaned = cleaned.replace(',', '.');
      } else if (cleaned.includes('.')) {
        const parts = cleaned.split('.');
        if (parts.length === 2 && parts[1].length === 3) {
          cleaned = cleaned.replace(/\./g, '');
        }
      }
      const monto = parseFloat(cleaned);
      const saldoFavor = cliente.deuda < 0 ? Math.abs(cliente.deuda) : 0;

      if (isNaN(monto) || monto <= 0) {
        await bot.sendMessage(chatId, `⚠️ *Monto inválido*\n\nPor favor ingresa un monto numérico válido en Bolívares (ej: /retiro 1000).`, { parse_mode: 'Markdown' });
        return;
      }

      if (monto > saldoFavor) {
        await bot.sendMessage(chatId, `⚠️ *Saldo a favor insuficiente*\n\nTu saldo a favor actual es de *Bs. ${saldoFavor.toLocaleString('de-DE')}*. No puedes retirar una cantidad mayor.`, { parse_mode: 'Markdown' });
        return;
      }

      tgSessions[chatId] = {
        estado: 'esperando_pago_movil',
        montoRetiro: monto
      };

      await bot.sendMessage(
        chatId,
        `💰 *Solicitud de Retiro por Bs. ${monto.toLocaleString('de-DE')}*\n\nPor favor, responde a este mensaje indicando tus datos de Pago Móvil en el siguiente formato:\n\n*Banco, Cédula, Teléfono*\n\n_Ejemplo: Banesco, V-12345678, 04125555555_\n\nSi deseas cancelar, escribe *cancelar*.`,
        { parse_mode: 'Markdown' }
      );
      return;
    }

    // Si escribe algo y no es un comando y no está en un flujo de estado
    await bot.sendMessage(
      chatId,
      `❓ *Comando no reconocido*\n\nUsa alguno de los siguientes comandos:\n\n📊 /saldo o /deuda - Consulta tu saldo actual\n🎟️ /ticket <numero> - Consulta el estado de un ticket\n💰 /retiro <monto> - Solicita un retiro de tu saldo a favor\n❓ /help - Muestra esta ayuda`,
      { parse_mode: 'Markdown' }
    );
  });

  return {
    sendMessage: (targetChatId, messageText) => {
      bot.sendMessage(targetChatId, messageText, { parse_mode: 'Markdown' }).catch(err => {
        console.error(`❌ [Telegram Bot] Error al enviar mensaje a ${targetChatId}:`, err.message);
      });
    },
    notificarAdmin
  };
}
