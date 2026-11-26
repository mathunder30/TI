import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '../auth/AuthContext';
import { TicketDetailPage, TicketListPage } from './TicketPages';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function response(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('portal do funcionário', () => {
  it('carrega lista realista da API, aplica filtros e abre detalhes com snapshots e timeline', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/v1/auth/session') {
        return response({
          csrfToken: 'csrf-test',
          user: {
            id: 'employee-1',
            fullName: 'Ana Funcionária',
            email: 'ana@example.com',
            role: 'FUNCIONARIO',
            unit: { id: 'unit-1', name: 'Unidade Centro' },
            department: { id: 'dept-1', name: 'Recepção' },
            authProviders: ['PASSWORD'],
          },
        });
      }
      if (url.pathname === '/api/v1/tickets/categories')
        return response({ categories: [{ id: 'cat-1', name: 'Equipamentos' }] });
      if (url.pathname === '/api/v1/tickets') {
        return response({
          items: [
            {
              id: 'ticket-1',
              number: 'SC-2026-00001',
              title: 'Computador da recepção',
              category: 'Equipamentos',
              priority: 'ALTA',
              status: 'EM_ATENDIMENTO',
              createdAt: '2026-11-20T12:00:00Z',
              updatedAt: '2026-11-21T12:00:00Z',
            },
          ],
          pagination: {
            page: 1,
            pageSize: 20,
            totalItems: 1,
            totalPages: 1,
            hasPreviousPage: false,
            hasNextPage: false,
          },
        });
      }
      if (url.pathname === '/api/v1/tickets/ticket-1') {
        return response({
          ticket: {
            id: 'ticket-1',
            number: 'SC-2026-00001',
            title: 'Computador da recepção',
            description: 'O equipamento não liga após queda de energia.',
            category: 'Equipamentos',
            priority: 'ALTA',
            suggestedPriority: 'MEDIA',
            status: 'EM_ATENDIMENTO',
            requester: { name: 'Ana Funcionária', email: 'ana@example.com' },
            unit: 'Unidade Centro',
            department: 'Recepção',
            resolution: null,
            createdAt: '2026-11-20T12:00:00Z',
            updatedAt: '2026-11-21T12:00:00Z',
          },
        });
      }
      if (url.pathname === '/api/v1/tickets/ticket-1/timeline')
        return response({
          timeline: [
            {
              id: 'event-1',
              type: 'ABERTURA',
              label: 'Chamado aberto',
              createdAt: '2026-11-20T12:00:00Z',
              actor: 'Você',
              from: null,
              to: 'Aberto',
            },
          ],
        });
      if (url.pathname === '/api/v1/tickets/ticket-1/messages') {
        if (init?.method === 'POST')
          return response({ message: { id: 'message-2', body: 'Mensagem enviada' } }, 201);
        return response({
          messages: [
            {
              id: 'message-1',
              authorNameSnapshot: 'Equipe TI',
              author: 'TI',
              body: 'Recebemos a solicitação.',
              createdAt: '2026-11-20T13:00:00Z',
            },
          ],
        });
      }
      if (url.pathname === '/api/v1/tickets/ticket-1/attachments')
        return init?.method === 'POST'
          ? response({ attachment: { id: 'attachment-1' } }, 201)
          : response({ attachments: [] });
      return response({ message: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);

    render(
      <MemoryRouter initialEntries={['/portal/chamados']}>
        <AuthProvider>
          <Routes>
            <Route path="/portal/chamados" element={<TicketListPage />} />
            <Route path="/portal/chamados/:ticketId" element={<TicketDetailPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByText('SC-2026-00001')).toBeInTheDocument();
    expect(screen.getByText('Computador da recepção')).toBeInTheDocument();
    fireEvent.change(screen.getByRole('searchbox'), { target: { value: 'Computador' } });
    fireEvent.click(screen.getByRole('button', { name: 'Aplicar filtros' }));
    await waitFor(() =>
      expect(fetchMock.mock.calls.some(([input]) => String(input).includes('q=Computador'))).toBe(
        true,
      ),
    );

    fireEvent.click(screen.getByRole('link', { name: 'Abrir chamado SC-2026-00001' }));
    expect(
      await screen.findByRole('heading', { name: 'Computador da recepção' }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Ana Funcionária')).toHaveLength(3);
    expect(screen.getAllByText('Unidade Centro')).toHaveLength(2);
    expect(screen.getByText('Recepção')).toBeInTheDocument();
    expect(screen.getByText('Chamado aberto')).toBeInTheDocument();
    expect(screen.getByText('Recebemos a solicitação.')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Nova mensagem pública'), {
      target: { value: 'Mensagem enviada' },
    });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar mensagem' }));
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input).endsWith('/messages') && init?.method === 'POST',
        ),
      ).toBe(true),
    );
    const sendCall = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith('/messages') && init?.method === 'POST',
    );
    expect(new Headers(sendCall?.[1]?.headers).get('x-csrf-token')).toBe('csrf-test');
  });
});
