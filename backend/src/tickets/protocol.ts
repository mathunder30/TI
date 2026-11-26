import type { Prisma } from '../generated/prisma/client.ts';

export function saoPauloCalendarYear(date: Date): number {
  const year = new Intl.DateTimeFormat('en-US', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
  })
    .formatToParts(date)
    .find((part) => part.type === 'year')?.value;
  if (!year) throw new Error('Não foi possível calcular o ano do protocolo.');
  return Number(year);
}

export function formatTicketProtocol(year: number, sequence: number): string {
  if (!Number.isInteger(year) || year < 1 || !Number.isInteger(sequence) || sequence < 1) {
    throw new Error('Ano ou sequência do protocolo inválidos.');
  }
  return `SC-${year}-${String(sequence).padStart(5, '0')}`;
}

export async function nextTicketProtocol(
  transaction: Prisma.TransactionClient,
  year: number,
): Promise<string> {
  await transaction.$executeRaw`
    INSERT INTO ticket_protocol_counters (year, lastNumber, createdAt, updatedAt)
    VALUES (${year}, 0, CURRENT_TIMESTAMP(3), CURRENT_TIMESTAMP(3))
    ON DUPLICATE KEY UPDATE lastNumber = lastNumber
  `;
  await transaction.$executeRaw`
    UPDATE ticket_protocol_counters
    SET lastNumber = lastNumber + 1, updatedAt = CURRENT_TIMESTAMP(3)
    WHERE year = ${year}
  `;

  const counter = await transaction.ticketProtocolCounter.findUniqueOrThrow({ where: { year } });
  return formatTicketProtocol(year, counter.lastNumber);
}
