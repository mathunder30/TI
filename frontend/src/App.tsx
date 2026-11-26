import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  CircleCheck,
  CircleHelp,
  Layers3,
  ShieldCheck,
} from 'lucide-react';
import { Link, Navigate, Route, Routes, useLocation } from 'react-router';
import { apiUrl } from './lib/api';
import { useAuth } from './auth/useAuth';
import {
  CompleteOAuthPage,
  ConnectionsPage,
  LoginPage,
  RegisterPage,
  SimpleAuthPage,
} from './auth/AuthPages';
import { TicketDetailPage, TicketListPage } from './tickets/TicketPages';

type ApiStatus = 'checking' | 'online' | 'offline';
type ReadinessResponse = { dependencies?: { mysql?: string } };

function FoundationPage() {
  const { user, request, refresh, loading } = useAuth();
  const [logoutError, setLogoutError] = useState('');
  const [apiStatus, setApiStatus] = useState<ApiStatus>('checking');
  const [databaseStatus, setDatabaseStatus] = useState<ApiStatus>('checking');

  useEffect(() => {
    const controller = new AbortController();

    fetch(apiUrl('/api/v1/health/ready'), { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error('API indisponível');
        const readiness = (await response.json()) as ReadinessResponse;
        setApiStatus('online');
        setDatabaseStatus(readiness.dependencies?.mysql === 'ok' ? 'online' : 'offline');
      })
      .catch(() => {
        if (!controller.signal.aborted) {
          setApiStatus('offline');
          setDatabaseStatus('offline');
        }
      });

    return () => controller.abort();
  }, []);

  const statusLabel = {
    checking: 'Verificando serviços',
    online: 'API e banco conectados',
    offline: 'Serviço indisponível',
  }[apiStatus];
  const databaseStatusLabel = {
    checking: 'Verificando',
    online: 'Conectado',
    offline: 'Indisponível',
  }[databaseStatus];

  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Navegação principal">
        <Link className="brand" to="/" aria-label="São Camilo, início">
          <span className="brand-mark">SC</span>
          <span className="brand-copy">
            <strong>São Camilo</strong>
            <small>Portal de TI</small>
          </span>
        </Link>

        <div className="sidebar-label">PORTAL</div>
        <div className="nav-current" aria-current="page">
          <Layers3 size={18} strokeWidth={1.8} />
          <span>Visão geral</span>
        </div>

        <div className="sidebar-footer">
          <div className="support-icon">
            <CircleHelp size={17} />
          </div>
          <div>
            <strong>Central de suporte</strong>
            <span>Estrutura inicial do portal</span>
          </div>
        </div>
      </aside>

      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            Portal <span>/</span> Visão geral
          </div>
          <div className="topbar-actions">
            {user ? (
              <>
                <Link className="user-chip" to="/auth/connections">
                  {user.fullName} · {user.role === 'TI' ? 'TI' : 'Funcionário'}
                </Link>
                <button
                  className="text-button"
                  onClick={async () => {
                    const response = await request('/logout', { method: 'POST' });
                    if (response.ok) {
                      await refresh();
                    } else setLogoutError('Não foi possível encerrar a sessão.');
                  }}
                >
                  Sair
                </button>
              </>
            ) : (
              <Link className="button button-primary top-login" to="/auth/login">
                {loading ? 'Aguarde…' : 'Entrar'}
              </Link>
            )}
            <div className="environment-pill">
              <span /> Ambiente de desenvolvimento
            </div>
          </div>
        </header>

        <section className="page-content">
          <div className="eyebrow">
            <Activity size={15} /> FUNDAÇÃO DO SISTEMA
          </div>
          <div className="hero-row">
            <div>
              <h1>Portal de Chamados</h1>
              <p className="page-intro">
                Base técnica do atendimento de Tecnologia da Informação do São Camilo.
              </p>
            </div>
            <div className={`api-status api-status--${apiStatus}`} role="status" aria-live="polite">
              <span className="status-dot" />
              {statusLabel}
            </div>
          </div>

          <div className="welcome-card">
            <div className="welcome-copy">
              <div className="welcome-icon">
                <ShieldCheck size={21} />
              </div>
              <div>
                <p className="card-kicker">AMBIENTE PREPARADO</p>
                <h2>Uma base segura para o suporte das três unidades.</h2>
                <p>
                  Faça seu acesso ao portal com e-mail e senha. As opções Google e Apple ficam
                  disponíveis após a configuração segura das credenciais oficiais.
                </p>
                {!user && (
                  <div className="welcome-actions">
                    <Link className="button button-primary" to="/auth/login">
                      Entrar no portal
                    </Link>
                    <Link className="button button-secondary" to="/auth/register">
                      Criar conta de funcionário
                    </Link>
                  </div>
                )}
                {user && (
                  <p className="signed-in">
                    Sessão ativa para {user.email}. <Link to="/portal/chamados">Meus chamados</Link>{' '}
                    · <Link to="/auth/connections">Gerenciar métodos de acesso</Link>
                  </p>
                )}
                {logoutError && (
                  <p className="form-error" role="alert">
                    {logoutError}
                  </p>
                )}
              </div>
            </div>
            <div className="welcome-decoration" aria-hidden="true">
              <div className="decoration-ring decoration-ring--outer" />
              <div className="decoration-ring decoration-ring--inner" />
              <div className="decoration-core">
                <CircleCheck size={28} />
              </div>
            </div>
          </div>

          <div className="section-heading">
            <div>
              <h2>Componentes da fundação</h2>
              <p>Camadas técnicas já conectadas neste ambiente.</p>
            </div>
          </div>

          <div className="foundation-grid">
            <article className="foundation-card">
              <div className="foundation-card-top">
                <span className="component-icon component-icon--blue">
                  <Layers3 size={19} />
                </span>
                <span className="component-state">Preparado</span>
              </div>
              <h3>Aplicação web</h3>
              <p>React, TypeScript e Vite com rotas e estilos responsivos.</p>
              <Link className="card-link" to="/auth/login">
                Acessar portal <ArrowUpRight size={15} />
              </Link>
            </article>
            <article className="foundation-card">
              <div className="foundation-card-top">
                <span className="component-icon component-icon--violet">
                  <Activity size={19} />
                </span>
                <span className={`component-state component-state--${apiStatus}`}>
                  {apiStatus === 'checking'
                    ? 'Verificando'
                    : apiStatus === 'online'
                      ? 'Conectada'
                      : 'Indisponível'}
                </span>
              </div>
              <h3>API do portal</h3>
              <p>Express com health check, validação de configuração e erros centralizados.</p>
              <div className="card-link">
                Backend <ArrowUpRight size={15} />
              </div>
            </article>
            <article className="foundation-card">
              <div className="foundation-card-top">
                <span className="component-icon component-icon--green">
                  <CircleCheck size={19} />
                </span>
                <span className={`component-state component-state--${databaseStatus}`}>
                  {databaseStatusLabel}
                </span>
              </div>
              <h3>Banco de dados</h3>
              <p>MySQL e Prisma com schema relacional e migrations versionadas.</p>
              <div className="card-link">
                Persistência <ArrowUpRight size={15} />
              </div>
            </article>
          </div>

          <footer className="page-footer">
            Instituto Educacional São Camilo <span>·</span> Portal de Tecnologia da Informação
          </footer>
        </section>
      </main>
    </div>
  );
}

function NotFoundPage() {
  return (
    <main className="not-found">
      <h1>Página não encontrada</h1>
      <Link to="/">Voltar ao início</Link>
    </main>
  );
}

function EmployeeRoute({ children }: { children: React.ReactNode }) {
  const { user, loading } = useAuth();
  const location = useLocation();
  if (loading) return <main className="not-found">Verificando sessão…</main>;
  if (!user) return <Navigate to="/auth/login" replace state={{ from: location.pathname }} />;
  if (user.role !== 'FUNCIONARIO') return <Navigate to="/" replace />;
  return children;
}

export function App() {
  return (
    <Routes>
      <Route path="/" element={<FoundationPage />} />
      <Route
        path="/portal/chamados"
        element={
          <EmployeeRoute>
            <TicketListPage />
          </EmployeeRoute>
        }
      />
      <Route
        path="/portal/chamados/:ticketId"
        element={
          <EmployeeRoute>
            <TicketDetailPage />
          </EmployeeRoute>
        }
      />
      <Route path="/auth/login" element={<LoginPage />} />
      <Route path="/auth/register" element={<RegisterPage />} />
      <Route path="/auth/forgot-password" element={<SimpleAuthPage mode="forgot" />} />
      <Route path="/auth/verify-email" element={<SimpleAuthPage mode="verify" />} />
      <Route path="/auth/reset-password" element={<SimpleAuthPage mode="reset" />} />
      <Route path="/auth/complete" element={<CompleteOAuthPage />} />
      <Route path="/auth/connections" element={<ConnectionsPage />} />
      <Route path="*" element={<NotFoundPage />} />
    </Routes>
  );
}
