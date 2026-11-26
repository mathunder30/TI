import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowRight,
  CircleAlert,
  ClipboardList,
  Clock3,
  RefreshCw,
  TicketCheck,
} from 'lucide-react';
import { Link } from 'react-router';
import { useAuth } from '../auth/useAuth';
import { apiErrorMessage, apiFetch } from '../lib/api';
import { TicketShell } from './TicketPages';

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
type TicketSummary = {
  id: string;
  number: string;
  title: string;
  category: string;
  priority: TicketPriority;
  status: TicketStatus;
  createdAt: string;
  updatedAt: string;
  requester?: string;
  unit?: string;
};
type EmployeeDashboard = {
  summary: { active: number; inProgress: number; waitingForEmployee: number; resolved: number };
  recentTickets: TicketSummary[];
};
type TiDashboard = {
  summary: {
    total: number;
    open: number;
    inTriage: number;
    inProgress: number;
    waitingForEmployee: number;
    reopened: number;
    resolved: number;
  };
  byPriority: Record<TicketPriority, number>;
  recentTickets: TicketSummary[];
};
type State<T> =
  | { key: string; loading: true }
  | { key: string; loading: false; error: string }
  | { key: string; loading: false; data: T };

const statusLabels: Record<TicketStatus, string> = {
  ABERTO: 'Aberto',
  EM_TRIAGEM: 'Em triagem',
  EM_ATENDIMENTO: 'Em atendimento',
  AGUARDANDO_FUNCIONARIO: 'Aguardando funcionário',
  RESOLVIDO: 'Resolvido',
  FECHADO: 'Fechado',
  REABERTO: 'Reaberto',
  CANCELADO: 'Cancelado',
};
const priorityLabels: Record<TicketPriority, string> = {
  BAIXA: 'Baixa',
  MEDIA: 'Média',
  ALTA: 'Alta',
  CRITICA: 'Crítica',
};
const dateFormatter = new Intl.DateTimeFormat('pt-BR', {
  dateStyle: 'medium',
  timeStyle: 'short',
  timeZone: 'America/Sao_Paulo',
});

function useDashboard<T>(path: string) {
  const [retry, setRetry] = useState(0);
  const requestKey = `${path}:${retry}`;
  const [state, setState] = useState<State<T>>({ key: '', loading: true });
  useEffect(() => {
    const controller = new AbortController();
    apiFetch(path, { signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(await apiErrorMessage(response));
        return response.json() as Promise<T>;
      })
      .then((data) => setState({ key: requestKey, loading: false, data }))
      .catch((error: unknown) => {
        if (!controller.signal.aborted)
          setState({
            key: requestKey,
            loading: false,
            error: error instanceof Error ? error.message : 'Falha ao carregar.',
          });
      });
    return () => controller.abort();
  }, [path, requestKey]);
  return {
    state: state.key === requestKey ? state : ({ key: requestKey, loading: true } as const),
    refresh: () => setRetry((value) => value + 1),
  };
}

function MetricCard({
  label,
  value,
  tone = 'blue',
}: {
  label: string;
  value: number;
  tone?: string;
}) {
  return (
    <article className={`dashboard-metric dashboard-metric--${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function DashboardNotice<T>({
  state,
  retry,
  children,
}: {
  state: State<T>;
  retry: () => void;
  children: (data: T) => React.ReactNode;
}) {
  if (state.loading)
    return (
      <div className="dashboard-notice" role="status">
        <Activity className="ticket-spinner" size={18} /> Carregando indicadores…
      </div>
    );
  if ('error' in state)
    return (
      <div className="dashboard-notice dashboard-notice--error" role="alert">
        <CircleAlert size={20} />
        <span>{state.error}</span>
        <button className="button button-secondary" onClick={retry}>
          Tentar novamente
        </button>
      </div>
    );
  return children(state.data);
}

function RecentTickets({ tickets, ti = false }: { tickets: TicketSummary[]; ti?: boolean }) {
  if (tickets.length === 0)
    return (
      <div className="dashboard-empty">
        <ClipboardList size={22} />
        <strong>Nenhum chamado recente</strong>
        <span>As solicitações aparecerão aqui quando forem registradas.</span>
      </div>
    );
  return (
    <div className="dashboard-recent-list">
      {tickets.map((ticket) => (
        <Link
          className="dashboard-ticket"
          key={ticket.id}
          to={`${ti ? '/ti' : '/portal'}/chamados/${encodeURIComponent(ticket.id)}`}
        >
          <span className="dashboard-ticket-main">
            <small>
              {ticket.number} · {ticket.category}
            </small>
            <strong>{ticket.title}</strong>
            {ti && (
              <span>
                {ticket.requester} · {ticket.unit}
              </span>
            )}
          </span>
          <span className="dashboard-ticket-meta">
            <span className={`ticket-status ticket-status--${ticket.status.toLowerCase()}`}>
              {statusLabels[ticket.status]}
            </span>
            <small>
              <Clock3 size={13} /> {dateFormatter.format(new Date(ticket.updatedAt))}
            </small>
          </span>
        </Link>
      ))}
    </div>
  );
}

export function EmployeeDashboardPage() {
  const { user } = useAuth();
  const { state, refresh } = useDashboard<EmployeeDashboard>('/api/v1/tickets/dashboard/employee');
  return (
    <TicketShell title="Visão geral">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">
            <TicketCheck size={15} /> PORTAL DO FUNCIONÁRIO
          </p>
          <h1>Olá, {user?.fullName.split(' ')[0]}.</h1>
          <p className="page-intro">Acompanhe suas solicitações de suporte em um só lugar.</p>
        </div>
        <div className="dashboard-actions">
          <button className="button button-secondary" onClick={refresh}>
            <RefreshCw size={15} /> Atualizar
          </button>
          <Link className="button button-primary" to="/portal/chamados/novo">
            Abrir chamado <ArrowRight size={16} />
          </Link>
        </div>
      </div>
      <DashboardNotice state={state} retry={refresh}>
        {(data) => (
          <>
            <div className="dashboard-metrics">
              <MetricCard label="Chamados ativos" value={data.summary.active} />
              <MetricCard label="Em atendimento" value={data.summary.inProgress} tone="violet" />
              <MetricCard
                label="Aguardando sua resposta"
                value={data.summary.waitingForEmployee}
                tone="amber"
              />
              <MetricCard label="Resolvidos" value={data.summary.resolved} tone="green" />
            </div>
            <p className="dashboard-metric-note">
              Chamados ativos inclui todos os status ainda não fechados ou cancelados. Os
              indicadores de atendimento, espera e resolução são recortes específicos e podem se
              sobrepor a esse total.
            </p>
            <section className="dashboard-section">
              <div className="dashboard-section-heading">
                <div>
                  <h2>Chamados recentes</h2>
                  <p>Atualizados por último na sua conta.</p>
                </div>
                <Link to="/portal/chamados">
                  Consultar todos <ArrowRight size={15} />
                </Link>
              </div>
              <RecentTickets tickets={data.recentTickets} />
            </section>
          </>
        )}
      </DashboardNotice>
    </TicketShell>
  );
}

export function TiDashboardPage() {
  const { state, refresh } = useDashboard<TiDashboard>('/api/v1/tickets/dashboard/ti');
  return (
    <TicketShell title="Visão geral">
      <div className="dashboard-heading">
        <div>
          <p className="eyebrow">
            <TicketCheck size={15} /> OPERAÇÃO DE TI
          </p>
          <h1>Painel de atendimento</h1>
          <p className="page-intro">
            Visão consolidada dos chamados recebidos de todas as unidades.
          </p>
        </div>
        <div className="dashboard-actions">
          <button className="button button-secondary" onClick={refresh}>
            <RefreshCw size={15} /> Atualizar
          </button>
          <Link className="button button-primary" to="/ti/chamados">
            Fila de atendimento <ArrowRight size={16} />
          </Link>
        </div>
      </div>
      <DashboardNotice state={state} retry={refresh}>
        {(data) => (
          <>
            <div className="dashboard-metrics dashboard-metrics--ti">
              <MetricCard label="Total de chamados" value={data.summary.total} />
              <MetricCard label="Abertos" value={data.summary.open} />
              <MetricCard label="Em triagem" value={data.summary.inTriage} tone="violet" />
              <MetricCard label="Em atendimento" value={data.summary.inProgress} tone="blue" />
              <MetricCard
                label="Aguardando funcionário"
                value={data.summary.waitingForEmployee}
                tone="amber"
              />
              <MetricCard label="Reabertos" value={data.summary.reopened} tone="amber" />
              <MetricCard label="Resolvidos" value={data.summary.resolved} tone="green" />
            </div>
            <section className="dashboard-section dashboard-priority-section">
              <div className="dashboard-section-heading">
                <div>
                  <h2>Distribuição por prioridade</h2>
                  <p>Chamados ativos e encerrados no banco.</p>
                </div>
              </div>
              <div className="dashboard-priorities">
                {(Object.keys(priorityLabels) as TicketPriority[]).map((priority) => (
                  <div key={priority}>
                    <span className={`ticket-priority ticket-priority--${priority.toLowerCase()}`}>
                      {priorityLabels[priority]}
                    </span>
                    <strong>{data.byPriority[priority]}</strong>
                  </div>
                ))}
              </div>
            </section>
            <section className="dashboard-section">
              <div className="dashboard-section-heading">
                <div>
                  <h2>Chamados recentes</h2>
                  <p>Solicitações de todas as unidades.</p>
                </div>
                <Link to="/ti/chamados">
                  Abrir fila <ArrowRight size={15} />
                </Link>
              </div>
              <RecentTickets tickets={data.recentTickets} ti />
            </section>
          </>
        )}
      </DashboardNotice>
    </TicketShell>
  );
}
