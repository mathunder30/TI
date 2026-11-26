import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { App } from './App';
import { AuthProvider } from './auth/AuthContext';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('fundação do portal', () => {
  it('exibe a base do sistema e confirma quando a API responde', async () => {
    vi.stubGlobal(
      'fetch',
      vi
        .fn()
        .mockResolvedValue(
          new Response(JSON.stringify({ dependencies: { mysql: 'ok' } }), { status: 200 }),
        ),
    );

    render(
      <MemoryRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(screen.getByRole('heading', { name: 'Portal de Chamados' })).toBeInTheDocument();
    expect(await screen.findByRole('status')).toHaveTextContent('API e banco conectados');
    expect(screen.getByText('Conectado')).toBeInTheDocument();
  });

  it('apresenta uma mensagem clara se a API não responder', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('offline')));

    render(
      <MemoryRouter>
        <AuthProvider>
          <App />
        </AuthProvider>
      </MemoryRouter>,
    );

    expect(await screen.findByRole('status')).toHaveTextContent('Serviço indisponível');
  });
});
