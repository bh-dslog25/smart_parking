import { createServer, type Socket } from 'node:net';

export type DeliveredEmail = { to: string[]; raw: string };

// A loopback-only SMTP inbox. No email can leave the test process.
export async function smtpInbox() {
  const messages: DeliveredEmail[] = [];
  const sockets = new Set<Socket>();
  let rejectDelivery = false;
  const server = createServer(socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
    socket.on('error', () => {});
    socket.setEncoding('utf8');
    let buffered = '', collecting = false, raw = '', to: string[] = [];
    socket.write('220 localhost test inbox\r\n');
    socket.on('data', chunk => {
      buffered += chunk;
      while (buffered.includes('\r\n')) {
        const end = buffered.indexOf('\r\n');
        const line = buffered.slice(0, end);
        buffered = buffered.slice(end + 2);
        if (collecting) {
          if (line === '.') {
            collecting = false;
            if (rejectDelivery) socket.write('451 Test delivery unavailable\r\n');
            else { messages.push({ to: [...to], raw }); socket.write('250 Message accepted\r\n'); }
          } else raw += (line.startsWith('..') ? line.slice(1) : line) + '\r\n';
        } else if (/^(EHLO|HELO)\b/i.test(line)) socket.write('250-localhost\r\n250 SIZE 1000000\r\n');
        else if (/^MAIL FROM:/i.test(line)) { raw = ''; to = []; socket.write('250 OK\r\n'); }
        else if (/^RCPT TO:/i.test(line)) { to.push(line.match(/<([^>]+)>/)?.[1] ?? ''); socket.write('250 OK\r\n'); }
        else if (/^DATA$/i.test(line)) { collecting = true; socket.write('354 End with a dot\r\n'); }
        else if (/^QUIT$/i.test(line)) socket.end('221 Bye\r\n');
        else if (/^(RSET|NOOP)\b/i.test(line)) socket.write('250 OK\r\n');
        else socket.write('502 Unsupported test command\r\n');
      }
    });
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('SMTP fixture failed to bind');
  return {
    port: address.port, messages,
    failDelivery(value: boolean) { rejectDelivery = value; },
    latestCode(email: string) {
      const message = [...messages].reverse().find(item => item.to.includes(email));
      const body = message?.raw.split('\r\n\r\n').slice(1).join('\r\n\r\n') ?? '';
      const code = body.match(/\b\d{6}\b/)?.[0];
      if (!code) throw new Error(`No six-digit email OTP delivered to ${email}`);
      return code;
    },
    async close() {
      for (const socket of sockets) socket.destroy();
      await new Promise<void>(resolve => server.close(() => resolve()));
    },
  };
}
