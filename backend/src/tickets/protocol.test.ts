import { describe, expect, it } from 'vitest';
import { formatTicketProtocol, saoPauloCalendarYear } from './protocol.js';

describe('ano civil do protocolo em Brasília', () => {
  it('usa o ano local mesmo quando o instante UTC já está no próximo ano', () => {
    expect(saoPauloCalendarYear(new Date('2027-01-01T02:30:00.000Z'))).toBe(2026);
  });

  it('avança o ano depois da meia-noite de Brasília', () => {
    expect(saoPauloCalendarYear(new Date('2027-01-01T03:00:00.000Z'))).toBe(2027);
  });

  it('formata o protocolo anual com sequência de cinco dígitos', () => {
    expect(formatTicketProtocol(2026, 1)).toBe('SC-2026-00001');
  });
});
