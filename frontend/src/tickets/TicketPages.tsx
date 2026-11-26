import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  CircleHelp,
  Layers3,
  Send,
  Paperclip,
  Download,
  Check,
  RotateCcw,
  Search,
  TicketCheck,
} from 'lucide-react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router';
import { apiErrorMessage, apiFetch, apiUrl } from '../lib/api';
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
  resolution: string | null;
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
type TicketMessage = {
  id: string;
  authorNameSnapshot: string;
  author: string;
  body: string;
  createdAt: string;
};
type TicketAttachment = {
  id: string;
  originalName: string;
  mimeType: string;
  byteSize: number;
  createdAt: string;
  uploader: string;
};

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

export function TicketShell({ title, children }: { title: string; children: ReactNode }) {
  const { user } = useAuth();
  const isTi = user?.role === 'TI';
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
        <div className="sidebar-label">{isTi ? 'PORTAL DE TI' : 'PORTAL DO FUNCIONÁRIO'}</div>
        <Link
          className={title === 'Visão geral' ? 'nav-current' : 'nav-link'}
          to={isTi ? '/ti' : '/portal'}
          aria-current={title === 'Visão geral' ? 'page' : undefined}
        >
          <Layers3 size={18} strokeWidth={1.8} />
          <span>Visão geral</span>
        </Link>
        <Link
          className={
            title === (isTi ? 'Fila de atendimento' : 'Meus chamados') ? 'nav-current' : 'nav-link'
          }
          to={isTi ? '/ti/chamados' : '/portal/chamados'}
          aria-current={
            title === (isTi ? 'Fila de atendimento' : 'Meus chamados') ? 'page' : undefined
          }
        >
          <TicketCheck size={18} strokeWidth={1.8} />
          <span>{isTi ? 'Fila de atendimento' : 'Meus chamados'}</span>
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

export function TicketCreatePage() {
  const { user, csrfToken } = useAuth();
  const navigate = useNavigate();
  const [categories, setCategories] = useState<LoadState<Category[]>>({
    key: 'categories',
    status: 'loading',
  });
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  useEffect(() => {
    const controller = new AbortController();
    apiFetch('/api/v1/tickets/categories', { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response));
        return response.json() as Promise<{ categories: Category[] }>;
      })
      .then((data) =>
        setCategories({ key: 'categories', status: 'success', data: data.categories }),
      )
      .catch((cause: unknown) => {
        if (!controller.signal.aborted)
          setCategories({
            key: 'categories',
            status: 'error',
            message: cause instanceof Error ? cause.message : 'Falha ao carregar categorias.',
          });
      });
    return () => controller.abort();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError('');
    setSaving(true);
    const data = new FormData(event.currentTarget);
    try {
      const response = await apiFetch('/api/v1/tickets', {
        method: 'POST',
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
        body: JSON.stringify({
          title: String(data.get('title') ?? ''),
          description: String(data.get('description') ?? ''),
          categoryId: String(data.get('categoryId') ?? ''),
          priority: String(data.get('priority') ?? 'MEDIA'),
        }),
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response));
      const result = (await response.json()) as { ticket: { id: string } };
      navigate(`/portal/chamados/${encodeURIComponent(result.ticket.id)}`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o chamado.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <TicketShell title="Abrir chamado">
      <div className="ticket-page-heading">
        <div>
          <p className="eyebrow">
            <TicketCheck size={15} /> NOVA SOLICITAÇÃO
          </p>
          <h1>Abrir chamado</h1>
          <p className="page-intro">
            Descreva o que precisa de suporte. Seus dados de unidade e setor vêm do perfil.
          </p>
        </div>
      </div>
      <form className="ticket-create-card ticket-create-form" onSubmit={submit}>
        <div className="ticket-profile-snapshot">
          <div>
            <span>Funcionário</span>
            <strong>{user?.fullName}</strong>
          </div>
          <div>
            <span>Unidade</span>
            <strong>{user?.unit.name}</strong>
          </div>
          <div>
            <span>Setor</span>
            <strong>{user?.department.name}</strong>
          </div>
        </div>
        <label>
          Título
          <input name="title" required minLength={5} maxLength={200} />
        </label>
        <label>
          Descrição
          <textarea name="description" required minLength={10} maxLength={10000} rows={6} />
        </label>
        <div className="ticket-create-row">
          <label>
            Categoria
            <select
              name="categoryId"
              required
              disabled={categories.status !== 'success'}
              defaultValue=""
            >
              <option value="" disabled>
                {categories.status === 'loading' ? 'Carregando…' : 'Selecione'}
              </option>
              {categories.status === 'success' &&
                categories.data.map((category) => (
                  <option key={category.id} value={category.id}>
                    {category.name}
                  </option>
                ))}
            </select>
          </label>
          <label>
            Prioridade sugerida
            <select name="priority" defaultValue="MEDIA">
              <option value="BAIXA">Baixa</option>
              <option value="MEDIA">Média</option>
              <option value="ALTA">Alta</option>
              <option value="CRITICA">Crítica</option>
            </select>
          </label>
        </div>
        {categories.status === 'error' && (
          <p className="form-error" role="alert">
            Não foi possível carregar as categorias: {categories.message}
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="ticket-create-actions">
          <Link className="button button-secondary" to="/portal">
            Cancelar
          </Link>
          <button
            className="button button-primary"
            type="submit"
            disabled={saving || categories.status !== 'success'}
          >
            {saving ? 'Enviando…' : 'Enviar chamado'}
          </button>
        </div>
      </form>
    </TicketShell>
  );
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

type TiQueueItem = TicketListItem & { requester: string; unit: string };
type TiQueueData = { items: TiQueueItem[]; pagination: TicketPageData['pagination'] };

export function TiQueuePage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const queryKey = searchParams.toString();
  const [result, setResult] = useState<LoadState<TiQueueData>>({
    key: queryKey,
    status: 'loading',
  });
  const [retry, setRetry] = useState(0);
  const page = Number(searchParams.get('page') || '1');
  const filterKey = ['q', 'status', 'priority'].map((key) => searchParams.get(key) ?? '').join('|');
  useEffect(() => {
    const controller = new AbortController();
    const query = new URLSearchParams(queryKey);
    query.set('page', String(page));
    query.set('pageSize', '20');
    apiFetch(`/api/v1/tickets/ti?${query.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response));
        return response.json() as Promise<TiQueueData>;
      })
      .then((data) => setResult({ key: queryKey, status: 'success', data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setResult({
            key: queryKey,
            status: 'error',
            message: error instanceof Error ? error.message : 'Falha na consulta.',
          });
      });
    return () => controller.abort();
  }, [page, queryKey, retry]);

  function applyFilters(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const next = new URLSearchParams();
    for (const field of ['q', 'status', 'priority']) {
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

  const loading = result.key !== queryKey || result.status === 'loading';
  const error = result.key === queryKey && result.status === 'error' ? result.message : null;
  const data = result.key === queryKey && result.status === 'success' ? result.data : null;

  return (
    <TicketShell title="Fila de atendimento">
      <div className="ticket-page-heading">
        <div>
          <p className="eyebrow">
            <Layers3 size={15} /> ÁREA DE TI
          </p>
          <h1>Fila de atendimento</h1>
          <p className="page-intro">Chamados recebidos para triagem e atendimento.</p>
        </div>
        {data && <div className="ticket-count">{data.pagination.totalItems} chamados</div>}
      </div>
      <form className="ticket-filters" onSubmit={applyFilters} key={filterKey}>
        <label>
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
        <button className="button button-primary" type="submit">
          Aplicar filtros
        </button>
      </form>
      {loading && (
        <div className="ticket-state" role="status">
          <Activity size={18} className="ticket-spinner" /> Carregando chamados…
        </div>
      )}
      {!loading && error && (
        <TicketLoadError message={error} onRetry={() => setRetry((count) => count + 1)} />
      )}
      {!loading && !error && data?.items.length === 0 && (
        <div className="ticket-state ticket-state--empty">
          <TicketCheck size={25} />
          <strong>Nenhum chamado recebido</strong>
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
                  <th>Solicitante</th>
                  <th>Unidade</th>
                  <th>Prioridade</th>
                  <th>Status</th>
                  <th>Atualização</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.items.map((ticket) => (
                  <tr key={ticket.id}>
                    <td>
                      <Link className="ticket-number" to={`/ti/chamados/${ticket.id}`}>
                        {ticket.number}
                      </Link>
                    </td>
                    <td className="ticket-title-cell">{ticket.title}</td>
                    <td>{ticket.requester}</td>
                    <td>{ticket.unit}</td>
                    <td>
                      <PriorityLabel priority={ticket.priority} />
                    </td>
                    <td>
                      <StatusBadge status={ticket.status} />
                    </td>
                    <td>{formatDate(ticket.updatedAt)}</td>
                    <td>
                      <Link
                        className="ticket-open-link"
                        aria-label={`Abrir chamado ${ticket.number}`}
                        to={`/ti/chamados/${ticket.id}`}
                      >
                        <ArrowRight size={17} />
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="ticket-pagination">
            <span>
              {data.pagination.totalItems} chamados · Página {data.pagination.page} de{' '}
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
  const { user, csrfToken } = useAuth();
  const [retryCount, setRetryCount] = useState(0);
  const [result, setResult] = useState<
    LoadState<{
      ticket: TicketDetail;
      timeline: TimelineEvent[];
      messages: TicketMessage[];
      attachments: TicketAttachment[];
    }>
  >({ key: ticketId, status: 'loading' });
  const [message, setMessage] = useState('');
  const [reason, setReason] = useState('');
  const [informationRequest, setInformationRequest] = useState('');
  const [resolution, setResolution] = useState('');
  const [actionError, setActionError] = useState('');
  const [busy, setBusy] = useState(false);
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
      apiFetch(`${base}/messages`, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response));
        return response.json() as Promise<{ messages: TicketMessage[] }>;
      }),
      apiFetch(`${base}/attachments`, { signal: controller.signal }).then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response));
        return response.json() as Promise<{ attachments: TicketAttachment[] }>;
      }),
    ])
      .then(([ticketResult, timelineResult, messageResult, attachmentResult]) =>
        setResult({
          key: ticketId,
          status: 'success',
          data: {
            ticket: ticketResult.ticket,
            timeline: timelineResult.timeline,
            messages: messageResult.messages,
            attachments: attachmentResult.attachments,
          },
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

  async function postAction(path: string, body: unknown, method = 'POST') {
    setBusy(true);
    setActionError('');
    try {
      const response = await apiFetch(`/api/v1/tickets/${encodeURIComponent(ticketId)}/${path}`, {
        method,
        headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await apiErrorMessage(response));
      setRetryCount((count) => count + 1);
      return true;
    } catch (error) {
      setActionError(
        error instanceof Error ? error.message : 'Não foi possível concluir a operação.',
      );
      return false;
    } finally {
      setBusy(false);
    }
  }

  async function sendMessage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await postAction('messages', { body: message })) setMessage('');
  }

  async function uploadAttachment(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const file = new FormData(form).get('file');
    if (!file || typeof file === 'string' || file.size === 0) {
      setActionError('Selecione um arquivo JPG, JPEG, PNG ou PDF.');
      return;
    }
    setBusy(true);
    setActionError('');
    try {
      const response = await apiFetch(
        `/api/v1/tickets/${encodeURIComponent(ticketId)}/attachments`,
        {
          method: 'POST',
          headers: csrfToken ? { 'x-csrf-token': csrfToken } : undefined,
          body: new FormData(form),
        },
      );
      if (!response.ok) throw new Error(await apiErrorMessage(response));
      form.reset();
      setRetryCount((count) => count + 1);
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Não foi possível enviar o anexo.');
    } finally {
      setBusy(false);
    }
  }

  const isTi = user?.role === 'TI';
  const backPath = isTi ? '/ti/chamados' : '/portal/chamados';

  return (
    <TicketShell title="Detalhes do chamado">
      <div className="ticket-detail-back">
        <Link to={backPath}>
          <ArrowLeft size={16} />{' '}
          {isTi ? 'Voltar para fila de atendimento' : 'Voltar para meus chamados'}
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
          {data.ticket.resolution && (
            <section className="ticket-detail-card ticket-resolution-card">
              <h2>Solução registrada por TI</h2>
              <p>{data.ticket.resolution}</p>
            </section>
          )}
          <section className="ticket-detail-card ticket-conversation-card">
            <div className="section-heading">
              <div>
                <h2>Conversa do chamado</h2>
                <p>Mensagens públicas entre o funcionário solicitante e TI.</p>
              </div>
            </div>
            <div className="ticket-messages" aria-live="polite">
              {data.messages.length === 0 ? (
                <p className="timeline-empty">Ainda não há mensagens nesta conversa.</p>
              ) : (
                data.messages.map((item) => (
                  <article
                    className={`ticket-message ${item.author === 'Você' ? 'ticket-message--self' : ''}`}
                    key={item.id}
                  >
                    <div>
                      <strong>{item.authorNameSnapshot}</strong>
                      <small>
                        {item.author} · {formatDate(item.createdAt)}
                      </small>
                    </div>
                    <p>{item.body}</p>
                  </article>
                ))
              )}
            </div>
            {data.ticket.status !== 'FECHADO' && data.ticket.status !== 'CANCELADO' && (
              <form className="ticket-message-form" onSubmit={sendMessage}>
                <label htmlFor="ticket-message">Nova mensagem pública</label>
                <textarea
                  id="ticket-message"
                  value={message}
                  onChange={(event) => setMessage(event.target.value)}
                  minLength={1}
                  maxLength={5000}
                  required
                  placeholder="Escreva uma mensagem para o chamado…"
                />
                <button className="button button-primary" disabled={busy || !message.trim()}>
                  <Send size={15} /> Enviar mensagem
                </button>
              </form>
            )}
          </section>
          <section className="ticket-detail-card ticket-attachments-card">
            <div className="section-heading">
              <div>
                <h2>Anexos</h2>
                <p>Arquivos disponíveis somente para participantes autorizados.</p>
              </div>
            </div>
            {data.attachments.length > 0 && (
              <ul className="ticket-attachment-list">
                {data.attachments.map((item) => (
                  <li key={item.id}>
                    <span>
                      <Paperclip size={15} />
                      <strong>{item.originalName}</strong>
                      <small>
                        {item.uploader} · {(item.byteSize / 1024).toFixed(0)} KB ·{' '}
                        {formatDate(item.createdAt)}
                      </small>
                    </span>
                    <a
                      href={apiUrl(
                        `/api/v1/tickets/${encodeURIComponent(ticketId)}/attachments/${encodeURIComponent(item.id)}`,
                      )}
                    >
                      <Download size={15} /> Baixar
                    </a>
                  </li>
                ))}
              </ul>
            )}
            {data.attachments.length === 0 && (
              <p className="timeline-empty">Nenhum anexo neste chamado.</p>
            )}
            {data.ticket.status !== 'FECHADO' && data.ticket.status !== 'CANCELADO' && (
              <form className="ticket-upload-form" onSubmit={uploadAttachment}>
                <label htmlFor="ticket-file">Adicionar JPG, JPEG, PNG ou PDF</label>
                <input
                  id="ticket-file"
                  type="file"
                  name="file"
                  accept=".jpg,.jpeg,.png,.pdf,image/jpeg,image/png,application/pdf"
                  required
                />
                <button className="button button-secondary" disabled={busy}>
                  <Paperclip size={15} /> Enviar anexo
                </button>
              </form>
            )}
          </section>
          {isTi && (
            <section className="ticket-detail-card ticket-ti-actions">
              <h2>Ações de atendimento</h2>
              {['ABERTO', 'REABERTO'].includes(data.ticket.status) && (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() =>
                    void postAction('status', { status: 'EM_TRIAGEM' }, 'PATCH').then(() =>
                      setActionError(''),
                    )
                  }
                >
                  Iniciar triagem
                </button>
              )}
              {['EM_TRIAGEM', 'AGUARDANDO_FUNCIONARIO'].includes(data.ticket.status) && (
                <button
                  className="button button-secondary"
                  disabled={busy}
                  onClick={() => void postAction('status', { status: 'EM_ATENDIMENTO' }, 'PATCH')}
                >
                  Iniciar atendimento
                </button>
              )}
              {!['FECHADO', 'CANCELADO', 'RESOLVIDO'].includes(data.ticket.status) && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void postAction('request-information', { body: informationRequest }).then(
                      (ok) => {
                        if (ok) setInformationRequest('');
                      },
                    );
                  }}
                >
                  <label>Solicitar informações adicionais</label>
                  <textarea
                    value={informationRequest}
                    onChange={(event) => setInformationRequest(event.target.value)}
                    minLength={1}
                    maxLength={5000}
                    required
                  />
                  <button
                    className="button button-secondary"
                    disabled={busy || !informationRequest.trim()}
                  >
                    Solicitar informações
                  </button>
                </form>
              )}
              {data.ticket.status === 'EM_ATENDIMENTO' && (
                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void postAction('resolve', { resolution }).then((ok) => {
                      if (ok) setResolution('');
                    });
                  }}
                >
                  <label>Registrar solução</label>
                  <textarea
                    value={resolution}
                    onChange={(event) => setResolution(event.target.value)}
                    minLength={10}
                    maxLength={5000}
                    required
                  />
                  <button
                    className="button button-primary"
                    disabled={busy || resolution.trim().length < 10}
                  >
                    <Check size={15} /> Marcar como resolvido
                  </button>
                </form>
              )}
            </section>
          )}
          {!isTi && data.ticket.status === 'RESOLVIDO' && (
            <section className="ticket-detail-card ticket-employee-actions">
              <h2>A solução resolveu o problema?</h2>
              <button
                className="button button-primary"
                disabled={busy}
                onClick={() => void postAction('confirm-resolution', {})}
              >
                <Check size={15} /> Confirmar resolução e encerrar
              </button>
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void postAction('reopen', { reason }).then((ok) => {
                    if (ok) setReason('');
                  });
                }}
              >
                <label>Solicitar reabertura e explicar o motivo</label>
                <textarea
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                  minLength={10}
                  maxLength={2000}
                  required
                />
                <button
                  className="button button-secondary"
                  disabled={busy || reason.trim().length < 10}
                >
                  <RotateCcw size={15} /> Solicitar reabertura
                </button>
              </form>
            </section>
          )}
          {actionError && (
            <p className="form-error" role="alert">
              {actionError}
            </p>
          )}
        </>
      )}
    </TicketShell>
  );
}
