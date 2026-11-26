import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router';
import { AuthProvider } from '../auth/AuthContext';
import { EmployeeDashboardPage, TiDashboardPage } from './DashboardPages';
import { TicketCreatePage } from './TicketPages';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function session(role: 'FUNCIONARIO' | 'TI') {
  return json({
    csrfToken: 'csrf-dashboard',
    user: {
      id: role === 'TI' ? 'ti-1' : 'employee-1',
      fullName: role === 'TI' ? 'Responsável TI' : 'Ana Funcionária',
      email: 'ana@example.com',
      role,
      unit: { id: 'unit-1', name: 'Unidade Centro' },
      department: { id: 'dept-1', name: 'Recepção' },
      authProviders: ['PASSWORD'],
    },
  });
}

describe('dashboards', () => {
  it('mostra os indicadores e chamados do funcionário com acesso rápido', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/v1/auth/session') return session('FUNCIONARIO');
      if (url.pathname === '/api/v1/tickets/dashboard/employee')
        return json({
          summary: { open: 2, inProgress: 1, waitingForEmployee: 3, resolved: 4 },
          recentTickets: [
            {
              id: 'ticket-1',
              number: 'SC-2026-00001',
              title: 'Impressora da recepção',
              category: 'Equipamentos',
              priority: 'ALTA',
              status: 'EM_ATENDIMENTO',
              createdAt: '2026-11-20T12:00:00Z',
              updatedAt: '2026-11-21T12:00:00Z',
            },
          ],
        });
      return json({ message: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/portal']}>
        <AuthProvider>
          <Routes>
            <Route path="/portal" element={<EmployeeDashboardPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('heading', { name: 'Olá, Ana.' })).toBeInTheDocument();
    expect(screen.getByText('Chamados abertos').parentElement).toHaveTextContent('2');
    expect(screen.getByText('Aguardando sua resposta').parentElement).toHaveTextContent('3');
    expect(await screen.findByText('Impressora da recepção')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Abrir chamado/ })).toHaveAttribute(
      'href',
      '/portal/chamados/novo',
    );
    expect(
      fetchMock.mock.calls.some(([input]) => String(input).includes('/dashboard/employee')),
    ).toBe(true);
  });

  it('mostra o resumo global do TI, prioridades e unidades', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/v1/auth/session') return session('TI');
      if (url.pathname === '/api/v1/tickets/dashboard/ti')
        return json({
          summary: {
            total: 7,
            open: 1,
            inTriage: 1,
            inProgress: 1,
            waitingForEmployee: 1,
            reopened: 1,
            resolved: 2,
          },
          byPriority: { BAIXA: 1, MEDIA: 2, ALTA: 3, CRITICA: 1 },
          recentTickets: [
            {
              id: 'ticket-2',
              number: 'SC-2026-00002',
              title: 'Rede Unidade Norte',
              category: 'Rede e conectividade',
              priority: 'CRITICA',
              status: 'ABERTO',
              requester: 'Carlos',
              unit: 'Unidade Norte',
              createdAt: '2026-11-20T12:00:00Z',
              updatedAt: '2026-11-21T12:00:00Z',
            },
          ],
        });
      return json({ message: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/ti']}>
        <AuthProvider>
          <Routes>
            <Route path="/ti" element={<TiDashboardPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByText('Rede Unidade Norte')).toBeInTheDocument();
    expect(screen.getByText('Total de chamados').parentElement).toHaveTextContent('7');
    expect(screen.getByText('Em triagem').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Crítica').parentElement).toHaveTextContent('1');
    expect(screen.getByText('Carlos · Unidade Norte')).toBeInTheDocument();
    expect(fetchMock.mock.calls.some(([input]) => String(input).includes('/dashboard/ti'))).toBe(
      true,
    );
  });

  it('trata falha e painel sem registros, permitindo nova consulta', async () => {
    let fail = true;
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/v1/auth/session') return session('FUNCIONARIO');
      if (url.pathname === '/api/v1/tickets/dashboard/employee') {
        if (fail) return json({ error: { message: 'Serviço temporariamente indisponível.' } }, 503);
        return json({
          summary: { open: 0, inProgress: 0, waitingForEmployee: 0, resolved: 0 },
          recentTickets: [],
        });
      }
      return json({ message: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/portal']}>
        <AuthProvider>
          <Routes>
            <Route path="/portal" element={<EmployeeDashboardPage />} />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('temporariamente indisponível');
    fail = false;
    fireEvent.click(screen.getByRole('button', { name: 'Tentar novamente' }));
    expect(await screen.findByText('Nenhum chamado recente')).toBeInTheDocument();
    expect(
      fetchMock.mock.calls.filter(([input]) => String(input).includes('/dashboard/employee')),
    ).toHaveLength(2);
  });

  it('abre um chamado pela API com CSRF e encaminha ao detalhe', async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = new URL(String(input), 'http://localhost');
      if (url.pathname === '/api/v1/auth/session') return session('FUNCIONARIO');
      if (url.pathname === '/api/v1/tickets/categories')
        return json({ categories: [{ id: 'category-1', name: 'Equipamentos' }] });
      if (url.pathname === '/api/v1/tickets' && init?.method === 'POST')
        return json({ ticket: { id: 'ticket-created' } }, 201);
      return json({ message: 'Not found' }, 404);
    });
    vi.stubGlobal('fetch', fetchMock);
    render(
      <MemoryRouter initialEntries={['/portal/chamados/novo']}>
        <AuthProvider>
          <Routes>
            <Route path="/portal/chamados/novo" element={<TicketCreatePage />} />
            <Route
              path="/portal/chamados/:ticketId"
              element={<div>Detalhe do chamado criado</div>}
            />
          </Routes>
        </AuthProvider>
      </MemoryRouter>,
    );
    fireEvent.change(await screen.findByLabelText('Título'), {
      target: { value: 'Impressora sem papel' },
    });
    fireEvent.change(screen.getByLabelText('Descrição'), {
      target: { value: 'A impressora da recepção precisa de atendimento técnico.' },
    });
    fireEvent.change(screen.getByLabelText('Categoria'), { target: { value: 'category-1' } });
    fireEvent.click(screen.getByRole('button', { name: 'Enviar chamado' }));
    expect(await screen.findByText('Detalhe do chamado criado')).toBeInTheDocument();
    await waitFor(() =>
      expect(
        fetchMock.mock.calls.some(
          ([input, init]) => String(input).endsWith('/api/v1/tickets') && init?.method === 'POST',
        ),
      ).toBe(true),
    );
    const submission = fetchMock.mock.calls.find(
      ([input, init]) => String(input).endsWith('/api/v1/tickets') && init?.method === 'POST',
    );
    expect(new Headers(submission?.[1]?.headers).get('x-csrf-token')).toBe('csrf-dashboard');
  });
});
