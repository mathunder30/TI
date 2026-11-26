import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  Layers3,
  Search,
  TicketCheck,
} from 'lucide-react';
import { Link, useParams, useSearchParams } from 'react-router';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { useAuth } from '../auth/useAuth';

type TicketStatus =
  | 'ABERTO'
  | 'EM_TRIAGEM'
  | 'EM_ATENDIMENTO'
  | 'AGUARDANDO_FUNCIONARIO'
  | 'RESOLVIDO'
  | 'FECHADO'
  | 'REABERTO'
  | 'CANCELADO';
type TicketPriority = 'BAIXA' | 'MEDIA' | 'ALTA' | 'CRITICA';
type TicketListItem = {
  id: string;
  number: string;
  title: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
};
type TicketPageData = {
  items: TicketListItem[];
  pagination: {
    page: number;
    pageSize: number;
    totalItems: number;
    totalPages: number;
    hasPreviousPage: boolean;
    hasNextPage: boolean;
  };
};
type Category = { id: string; name: string };
type TicketDetail = TicketListItem & {
  description: string;
  suggestedPriority: TicketPriority;
  requester: { name: string; email: string };
  unit: string;
  department: string;
};
type TimelineEvent = {
  id: string;
  type: string;
  label: string;
  createdAt: string;
  actor: string;
  from: string | null;
  to: string | null;
};
type LoadState<T> =
  | { key: string; status: 'loading' }
  | { key: string; status: 'error'; message: string }
  | { key: string; status: 'success'; data: T };

const STATUS_LABELS: Record<TicketStatus, string> = {
  ABERTO: 'Aberto',
  EM_TRIAGEM: 'Em triagem',
  EM_ATENDIMENTO: 'Em atendimento',
  AGUARDANDO_FUNCIONARIO: 'Aguardando você',
  RESOLVIDO: 'Resolvido',
  FECHADO: 'Fechado',
  REABERTO: 'Reaberto',
  CANCELADO: 'Cancelado',
};
const PRIORITY_LABELS: Record<TicketPriority, string> = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
  CRITICA: 'Crítica',
};
const DATE_FORMATTER = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function formatDate(value: string) {
  return DATE_FORMATTER.format(new Date(value));
}

function StatusBadge({ status }: { status: TicketStatus }) {
  return (
    <span className={`ticket-status ticket-status--${status.toLowerCase()}`}>
      {STATUS_LABELS[status]}
    </span>
  );
}

function PriorityLabel({ priority }: { priority: TicketPriority }) {
  return (
    <span className={`ticket-priority ticket-priority--${priority.toLowerCase()}`}>
      {PRIORITY_LABELS[priority]}
    </span>
  );
}

function TicketShell({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  return (
    <div className="app-frame">
      <aside className="sidebar" aria-label="Navegação do funcionário">
        <Link className="brand" to="/" aria-label="São Camilo, início">
          <span className="brand-mark">SC</span>
          <span className="brand-copy">
            <strong>São Camilo</strong>
            <small>Portal de TI</small>
          </span>
        </Link>
        <div className="sidebar-label">PORTAL DO FUNCIONÁRIO</div>
        <Link className="nav-current" to="/portal/chamados" aria-current="page">
          <TicketCheck size={18} strokeWidth={1.8} />
          <span>Meus chamados</span>
        </Link>
        <div className="sidebar-footer">
          <div className="support-icon">
            <CircleHelp size={17} />
          </div>
          <div>
            <strong>{user?.fullName ?? 'Funcionário'}</strong>
            <span>{user?.unit.name ?? 'São Camilo'}</span>
          </div>
        </div>
      </aside>
      <main className="main-content">
        <header className="topbar">
          <div className="breadcrumb">
            <Link to="/">Portal</Link>
            <span>/</span>
            {title}
          </div>
          <div className="topbar-actions">
            {user && (
              <Link className="user-chip" to="/auth/connections">
                {user.fullName}
              </Link>
            )}
            <Link className="text-button" to="/">
              Início
            </Link>
          </div>
        </header>
        <section className="ticket-page-content">{children}</section>
      </main>
    </div>
  );
}

function TicketLoadError({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div className="ticket-state ticket-state--error" role="alert">
      <strong>Não foi possível carregar os chamados.</strong>
      <span>{message}</span>
      <button className="button button-secondary" onClick={onRetry}>
        Tentar novamente
      </button>
    </div>
  );
}

function activeFilterKey(params: URLSearchParams) {
  return ['q', 'status', 'priority', 'categoryId'].map((key) => params.get(key) ?? '').join('|');
}

export function TicketListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const [retryCount, setRetryCount] = useState(0);
  const [categoryState, setCategoryState] = useState<LoadState<Category[]>>({
    key: 'categories',
    status: 'loading',
  });
  const queryKey = searchParams.toString();
  const [result, setResult] = useState<LoadState<TicketPageData>>({
    key: queryKey,
    status: 'loading',
  });
  const page = Number(searchParams.get('page') || '1');
  const filterKey = activeFilterKey(searchParams);

  useEffect(() => {
    const controller = new AbortController();
    apiFetch('/api/v1/tickets/categories', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response));
        return response.json() as Promise<{ categories: Category[] }>;
      })
      .then((data) =>
        setCategoryState({ key: 'categories', status: 'success', data: data.categories }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setCategoryState({
            key: 'categories',
            status: 'error',
            message: error instanceof Error ? error.message : 'Falha na consulta.',
          } as LoadState<Category[]>);
        }
      });
    return () => controller.abort();
  }, []);

  useEffect(() => {
    const controller = new AbortController();
    const suffix = queryKey ? `?${queryKey}` : '';
    apiFetch(`/api/v1/tickets${suffix}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response));
        return response.json() as Promise<TicketPageData>;
      })
      .then((data) => setResult({ key: queryKey, status: 'success', data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            key: queryKey,
            status: 'error',
            message: error instanceof Error ? error.message : 'Falha na consulta.',
          });
        }
      });
    return () => controller.abort();
  }, [queryKey, retryCount]);

  const loading = result.key !== queryKey || result.status === 'loading';
  const error = result.key === queryKey && result.status === 'error' ? result.message : null;
  const data = result.key === queryKey && result.status === 'success' ? result.data : null;

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const field of ['q', 'status', 'priority', 'categoryId']) {
      const value = String(form.get(field) ?? '').trim();
      if (value) next.set(field, value);
    }
    next.set('page', '1');
    next.set('pageSize', '20');
    setSearchParams(next);
  }

  function changePage(nextPage: number) {
    const next = new URLSearchParams(searchParams);
    next.set('page', String(nextPage));
    next.set('pageSize', '20');
    setSearchParams(next);
  }

  return (
    <TicketShell title="Meus chamados">
      <div className="ticket-page-heading">
        <div>
          <p className="eyebrow">
            <Layers3 size={15} /> ÁREA DO FUNCIONÁRIO
          </p>
          <h1>Meus chamados</h1>
          <p className="page-intro">
            Acompanhe suas solicitações e consulte o histórico de atendimento.
          </p>
        </div>
        <div className="ticket-count" aria-live="polite">
          {data?.pagination.totalItems ?? '—'} solicitações
        </div>
      </div>

      <form className="ticket-filters" onSubmit={applyFilters} key={filterKey}>
        <label className="ticket-search-field">
          Pesquisar
          <span className="ticket-search-input">
            <Search size={16} />
            <input
              name="q"
              type="search"
              defaultValue={searchParams.get('q') ?? ''}
              placeholder="Protocolo ou título"
            />
          </span>
        </label>
        <label>
          Status
          <select name="status" defaultValue={searchParams.get('status') ?? ''}>
            <option value="">Todos</option>
            {Object.entries(STATUS_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Prioridade
          <select name="priority" defaultValue={searchParams.get('priority') ?? ''}>
            <option value="">Todas</option>
            {Object.entries(PRIORITY_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
        </label>
        <label>
          Categoria
          <select name="categoryId" defaultValue={searchParams.get('categoryId') ?? ''}>
            <option value="">Todas</option>
            {categoryState.status === 'success' &&
              categoryState.data.map((category) => (
                <option key={category.id} value={category.id}>
                  {category.name}
                </option>
              ))}
          </select>
        </label>
        <button className="button button-primary" type="submit">
          Aplicar filtros
        </button>
      </form>
      {categoryState.status === 'error' && (
        <p className="form-error" role="status">
          As categorias não puderam ser carregadas; os outros filtros continuam disponíveis.
        </p>
      )}

      {loading && (
        <div className="ticket-state" role="status">
          <Activity size={18} className="ticket-spinner" /> Carregando chamados…
        </div>
      )}
      {!loading && error && (
        <TicketLoadError message={error} onRetry={() => setRetryCount((count) => count + 1)} />
      )}
      {!loading && !error && data && data.items.length === 0 && (
        <div className="ticket-state ticket-state--empty">
          <TicketCheck size={25} />
          <strong>Nenhum chamado encontrado</strong>
          <span>Tente alterar os filtros ou a pesquisa.</span>
        </div>
      )}
      {!loading && !error && data && data.items.length > 0 && (
        <>
          <div className="ticket-table-wrap">
            <table className="ticket-table">
              <thead>
                <tr>
                  <th>Protocolo</th>
                  <th>Solicitação</th>
                  <th>Categoria</th>
                  <th>Prioridade</th>
                  <th>Status</th>
                  <th>Abertura</th>
                  <th>Última atualização</th>
                  <th>
                    <span className="sr-only">Ações</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <Link className="ticket-number" to={`/portal/chamados/${ticket.id}`}>
                        {ticket.number}
                      </Link>
                    </td>
                    <td className="ticket-title-cell">{ticket.title}</td>
                    <td>{ticket.category}</td>
                    <td>
                      <PriorityLabel priority={ticket.priority} />
                    </td>
                    <td>
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td>{formatDate(ticket.createdAt)}</td>
                    <td>{formatDate(ticket.updatedAt)}</td>
                    <td>
                      <Link
                        className="ticket-open-link"
                        aria-label={`Abrir chamado ${ticket.number}`}
                        to={`/portal/chamados/${ticket.id}`}
                      >
                        <ArrowRight size={17} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ticket-pagination" aria-label="Paginação">
            <span>
              {data.pagination.totalItems} solicitação(ões) · Página {data.pagination.page} de{' '}
              {Math.max(data.pagination.totalPages, 1)}
            </span>
            <div>
              <button
                className="button button-secondary"
                disabled={!data.pagination.hasPreviousPage}
                onClick={() => changePage(page - 1)}
              >
                <ArrowLeft size={15} /> Anterior
              </button>
              <button
                className="button button-secondary"
                disabled={!data.pagination.hasNextPage}
                onClick={() => changePage(page + 1)}
              >
                Próxima <ArrowRight size={15} />
              </button>
            </div>
          </div>
        </>
      )}
    </TicketShell>
  );
}

export function TicketDetailPage() {
  const { ticketId = '' } = useParams();
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState<
    LoadState<{ ticket: TicketDetail; timeline: TimelineEvent[] }>
  >({ key: ticketId, status: 'loading' });
  const loading = result.key !== ticketId || result.status === 'loading';
  const error = result.key === ticketId && result.status === 'error' ? result.message : null;
  const data = result.key === ticketId && result.status === 'success' ? result.data : null;

  useEffect(() => {
    const controller = new AbortController();
    const base = `/api/v1/tickets/${encodeURIComponent(ticketId)}`;
    Promise.all([
      apiFetch(base, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response));
        return response.json() as Promise<{ ticket: TicketDetail }>;
      }),
      apiFetch(`${base}/timeline`, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response));
        return response.json() as Promise<{ timeline: TimelineEvent[] }>;
      }),
    ])
      .then(([ticketResult, timelineResult]) =>
        setResult({
          key: ticketId,
          status: 'success',
          data: { ticket: ticketResult.ticket, timeline: timelineResult.timeline },
        }),
      )
      .catch((error: unknown) => {
        if (!controller.signal.aborted) {
          setResult({
            key: ticketId,
            status: 'error',
            message: error instanceof Error ? error.message : 'Falha na consulta.',
          });
        }
      });
    return () => controller.abort();
  }, [ticketId, retryCount]);

  return (
    <TicketShell title="Detalhes do chamado">
      <div className="ticket-detail-back">
        <Link to="/portal/chamados">
          <ArrowLeft size={16} /> Voltar para meus chamados
        </Link>
      </div>
      {loading && (
        <div className="ticket-state" role="status">
          <Activity size={18} className="ticket-spinner" /> Carregando detalhes…
        </div>
      )}
      {!loading && error && (
        <TicketLoadError message={error} onRetry={() => setRetryCount((count) => count + 1)} />
      )}
      {!loading && !error && data && (
        <>
          <div className="ticket-detail-heading">
            <div>
              <p className="eyebrow">CHAMADO · {data.ticket.number}</p>
              <h1>{data.ticket.title}</h1>
            </div>
            <StatusBadge status={data.ticket.status} />
          </div>
          <div className="ticket-detail-grid">
            <section className="ticket-detail-card">
              <h2>Solicitação</h2>
              <div className="ticket-facts">
                <div>
                  <span>Categoria</span>
                  <strong>{data.ticket.category}</strong>
                </div>
                <div>
                  <span>Prioridade atual</span>
                  <strong>
                    <PriorityLabel priority={data.ticket.priority} />
                  </strong>
                </div>
                <div>
                  <span>Prioridade sugerida</span>
                  <strong>{PRIORITY_LABELS[data.ticket.suggestedPriority]}</strong>
                </div>
                <div>
                  <span>Abertura</span>
                  <strong>{formatDate(data.ticket.createdAt)}</strong>
                </div>
                <div>
                  <span>Última atualização</span>
                  <strong>{formatDate(data.ticket.updatedAt)}</strong>
                </div>
              </div>
              <div className="ticket-description">
                <h3>Descrição</h3>
                <p>{data.ticket.description}</p>
              </div>
            </section>
            <section className="ticket-detail-card ticket-requester-card">
              <h2>Dados registrados na abertura</h2>
              <div className="ticket-facts ticket-facts--stacked">
                <div>
                  <span>Solicitante</span>
                  <strong>{data.ticket.requester.name}</strong>
                </div>
                <div>
                  <span>E-mail</span>
                  <strong>{data.ticket.requester.email}</strong>
                </div>
                <div>
                  <span>Unidade</span>
                  <strong>{data.ticket.unit}</strong>
                </div>
                <div>
                  <span>Setor</span>
                  <strong>{data.ticket.department}</strong>
                </div>
                <div>
                  <span>Categoria registrada</span>
                  <strong>{data.ticket.category}</strong>
                </div>
              </div>
            </section>
          </div>
          <section className="ticket-detail-card ticket-timeline-card">
            <div className="section-heading">
              <div>
                <h2>Histórico do chamado</h2>
                <p>Movimentações em ordem cronológica.</p>
              </div>
            </div>
            {data.timeline.length === 0 ? (
              <p className="timeline-empty">Ainda não há movimentações para exibir.</p>
            ) : (
              <ol className="ticket-timeline">
                {data.timeline.map((event) => (
                  <li key={event.id}>
                    <span className="timeline-marker" aria-hidden="true" />
                    <div className="timeline-event">
                      <strong>{event.label}</strong>
                      {event.from && event.to && (
                        <span>
                          {event.from} → {event.to}
                        </span>
                      )}
                      <small>
                        {event.actor} · {formatDate(event.createdAt)}
                      </small>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </section>
        </>
      )}
    </TicketShell>
  );
}
