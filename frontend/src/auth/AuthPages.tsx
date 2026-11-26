import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router';
import { apiUrl } from '../lib/api';
import { useAuth } from './useAuth';

type ProviderState = {
  emailPassword: boolean;
  emailDelivery: boolean;
  google: boolean;
  apple: boolean;
};
type Unit = { id: string; name: string; departments: { id: string; name: string }[] };
const emptyProviders: ProviderState = {
  emailPassword: true,
  emailDelivery: false,
  google: false,
  apple: false,
};

async function errorText(response: Response) {
  const body = await response.json().catch(() => null);
  return body?.error?.message || body?.message || 'Não foi possível concluir. Tente novamente.';
}

function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: React.ReactNode;
}) {
  return (
    <main className="auth-page">
      <section className="auth-card">
        <Link className="brand auth-brand" to="/">
          <span className="brand-mark">SC</span>
          <span className="brand-copy">
            <strong>São Camilo</strong>
            <small>Portal de TI</small>
          </span>
        </Link>
        <p className="auth-eyebrow">ACESSO AO PORTAL</p>
        <h1>{title}</h1>
        <p className="auth-subtitle">{subtitle}</p>
        {children}
      </section>
    </main>
  );
}

function useProviders() {
  const [providers, setProviders] = useState(emptyProviders);
  useEffect(() => {
    fetch(apiUrl('/api/v1/auth/providers'))
      .then((r) => (r.ok ? r.json() : null))
      .then((v) => {
        if (v) setProviders(v);
      })
      .catch(() => undefined);
  }, []);
  return providers;
}

function OAuthButtons({ intent }: { intent: 'login' | 'signup' | 'link' }) {
  const providers = useProviders();
  const { request } = useAuth();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState('');
  async function start(provider: 'google' | 'apple') {
    setBusy(provider);
    setError('');
    try {
      const response = await request(`/oauth/${provider}/start`, {
        method: 'POST',
        body: JSON.stringify({
          intent: intent === 'signup' ? 'signup' : intent === 'link' ? 'link' : 'login',
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data?.error?.message || 'Provedor indisponível.');
      window.location.assign(data.authorizationUrl);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Falha ao iniciar login.');
      setBusy('');
    }
  }
  return (
    <>
      <div className="oauth-buttons">
        <button
          className="button button-secondary"
          disabled={!providers.google || !!busy}
          onClick={() => void start('google')}
        >
          {busy === 'google' ? 'Abrindo…' : 'Continuar com Google'}
          {!providers.google && <small>Não configurado</small>}
        </button>
        <button
          className="button button-secondary"
          disabled={!providers.apple || !!busy}
          onClick={() => void start('apple')}
        >
          {busy === 'apple' ? 'Abrindo…' : 'Continuar com Apple'}
          {!providers.apple && <small>Não configurado</small>}
        </button>
      </div>
      {error && (
        <p className="form-error" role="alert">
          {error}
        </p>
      )}
    </>
  );
}

export function LoginPage() {
  const { request, refresh, user } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (user) navigate('/');
  }, [user, navigate]);
  const oauthMessage: Record<string, string> = {
    provider_unavailable: 'Este provedor ainda não está configurado.',
    account_link_required:
      'Já existe uma conta com este e-mail. Entre pelo método já vinculado e associe o novo provedor em Métodos de acesso.',
    account_not_found: 'Não há conta vinculada. Crie seu cadastro para continuar.',
    provider_email_unverified: 'O provedor não confirmou o e-mail.',
    oauth_failed: 'Não foi possível validar o acesso externo. Tente novamente.',
    account_inactive: 'Esta conta está desativada.',
    link_session_expired: 'Sua sessão expirou; entre novamente para vincular o provedor.',
    provider_already_linked: 'Este provedor já está associado a outra conta.',
  };
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const r = await request('/login', {
      method: 'POST',
      body: JSON.stringify({ email: fd.get('email'), password: fd.get('password') }),
    });
    if (!r.ok) setError(await errorText(r));
    else {
      await refresh();
      navigate('/');
    }
    setBusy(false);
  }
  return (
    <AuthShell title="Acesse sua conta" subtitle="Entre para acompanhar o atendimento de TI.">
      {params.get('oauthError') && (
        <p className="notice notice-error" role="alert">
          {oauthMessage[params.get('oauthError')!] || 'Falha na autenticação externa.'}
        </p>
      )}
      <form className="auth-form" onSubmit={submit}>
        <label>
          E-mail
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Senha
          <input name="password" type="password" autoComplete="current-password" required />
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary" disabled={busy}>
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
      <div className="auth-links">
        <Link to="/auth/forgot-password">Esqueci minha senha</Link>
        <span>
          Não tem conta? <Link to="/auth/register">Cadastre-se</Link>
        </span>
      </div>
      <div className="divider">
        <span>ou</span>
      </div>
      <OAuthButtons intent="login" />
      <p className="auth-footnote">
        O acesso por Google e Apple estará disponível quando as credenciais oficiais forem
        configuradas.
      </p>
    </AuthShell>
  );
}

export function RegisterPage() {
  const providers = useProviders();
  const { request } = useAuth();
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    fetch(apiUrl('/api/v1/auth/registration-options'))
      .then((r) => r.json())
      .then((d) => setUnits(d.units || []))
      .catch(() => setError('Não foi possível carregar unidades e setores.'));
  }, []);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const r = await request('/register', {
      method: 'POST',
      body: JSON.stringify({
        fullName: fd.get('fullName'),
        email: fd.get('email'),
        password: fd.get('password'),
        unitId: fd.get('unitId'),
        departmentId: fd.get('departmentId'),
      }),
    });
    if (r.ok) setNotice('Cadastro criado. Verifique seu e-mail para ativar a conta.');
    else setError(await errorText(r));
    setBusy(false);
  }
  const departments = units.find((u) => u.id === unitId)?.departments || [];
  return (
    <AuthShell
      title="Crie sua conta"
      subtitle="Use um e-mail pessoal ou institucional. O cadastro cria apenas perfil de funcionário."
    >
      <form className="auth-form" onSubmit={submit}>
        <label>
          Nome completo
          <input name="fullName" autoComplete="name" minLength={2} maxLength={160} required />
        </label>
        <label>
          E-mail
          <input name="email" type="email" autoComplete="email" required />
        </label>
        <label>
          Senha
          <input
            name="password"
            type="password"
            autoComplete="new-password"
            minLength={12}
            required
          />
          <small>Use pelo menos 12 caracteres.</small>
        </label>
        <label>
          Unidade
          <select name="unitId" value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
            <option value="">Selecione</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Setor
          <select name="departmentId" required disabled={!unitId}>
            <option value="">Selecione</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {!providers.emailDelivery && (
          <p className="notice">
            Cadastro por e-mail ficará disponível após a configuração do serviço de envio.
          </p>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {notice && (
          <p className="notice notice-success" role="status">
            {notice}
          </p>
        )}
        <button
          className="button button-primary"
          disabled={busy || !providers.emailDelivery || units.length === 0}
        >
          {busy ? 'Enviando…' : 'Criar conta'}
        </button>
      </form>
      <div className="divider">
        <span>ou cadastre-se com</span>
      </div>
      <OAuthButtons intent="signup" />
      <p className="auth-links centered">
        <Link to="/auth/login">Já tenho uma conta</Link>
      </p>
    </AuthShell>
  );
}

export function SimpleAuthPage({ mode }: { mode: 'forgot' | 'verify' | 'reset' }) {
  const { request, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError('');
    const fd = new FormData(e.currentTarget);
    const path =
      mode === 'forgot'
        ? '/password/forgot'
        : mode === 'verify'
          ? '/email/verify'
          : '/password/reset';
    const body =
      mode === 'forgot'
        ? { email: fd.get('email') }
        : mode === 'verify'
          ? { token: params.get('token') }
          : { token: params.get('token'), password: fd.get('password') };
    const r = await request(path, { method: 'POST', body: JSON.stringify(body) });
    if (!r.ok) setError(await errorText(r));
    else if (mode === 'verify') {
      await refresh();
      navigate('/');
    } else
      setMessage(
        mode === 'forgot'
          ? 'Se a conta existir, enviaremos instruções para o e-mail informado.'
          : 'Senha redefinida. Você já pode entrar.',
      );
    setBusy(false);
  }
  const title =
    mode === 'forgot'
      ? 'Recuperar senha'
      : mode === 'verify'
        ? 'Verificar e-mail'
        : 'Definir nova senha';
  return (
    <AuthShell
      title={title}
      subtitle={
        mode === 'forgot'
          ? 'Informe seu e-mail para receber instruções de recuperação.'
          : mode === 'verify'
            ? 'Confirme seu endereço de e-mail para ativar a conta.'
            : 'Escolha uma nova senha com pelo menos 12 caracteres.'
      }
    >
      <form className="auth-form" onSubmit={submit}>
        {mode === 'forgot' && (
          <label>
            E-mail
            <input name="email" type="email" required />
          </label>
        )}
        {mode === 'reset' && (
          <label>
            Nova senha
            <input
              name="password"
              type="password"
              minLength={12}
              autoComplete="new-password"
              required
            />
          </label>
        )}
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        {message && (
          <p className="notice notice-success" role="status">
            {message}
          </p>
        )}
        {mode !== 'forgot' && !params.get('token') && (
          <p className="notice notice-error">
            Link inválido ou incompleto. Solicite um novo e-mail.
          </p>
        )}
        <button
          className="button button-primary"
          disabled={busy || (mode !== 'forgot' && !params.get('token'))}
        >
          {busy
            ? 'Aguarde…'
            : mode === 'forgot'
              ? 'Enviar instruções'
              : mode === 'verify'
                ? 'Verificar e-mail'
                : 'Salvar nova senha'}
        </button>
      </form>
      {mode === 'forgot' && (
        <p className="auth-footnote">
          A recuperação será ativada após configurar o envio de e-mail.
        </p>
      )}
      <p className="auth-links centered">
        <Link to="/auth/login">Voltar para entrar</Link>
      </p>
    </AuthShell>
  );
}

export function CompleteOAuthPage() {
  const { request, refresh } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [units, setUnits] = useState<Unit[]>([]);
  const [unitId, setUnitId] = useState('');
  const [error, setError] = useState('');
  const [email, setEmail] = useState('');
  const [suggested, setSuggested] = useState('');
  const token = params.get('token') || '';
  useEffect(() => {
    if (!token) return;
    fetch(apiUrl(`/api/v1/auth/oauth/pending?token=${encodeURIComponent(token)}`))
      .then(async (r) => {
        if (!r.ok) throw new Error(await errorText(r));
        return r.json();
      })
      .then((d) => {
        setEmail(d.email);
        setSuggested(d.fullName || '');
        setUnits(d.units || []);
      })
      .catch((e) => setError(e.message));
  }, [token]);
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await request('/oauth/complete', {
      method: 'POST',
      body: JSON.stringify({
        token,
        fullName: fd.get('fullName'),
        unitId: fd.get('unitId'),
        departmentId: fd.get('departmentId'),
      }),
    });
    if (!r.ok) setError(await errorText(r));
    else {
      await refresh();
      navigate('/');
    }
  }
  const departments = units.find((u) => u.id === unitId)?.departments || [];
  return (
    <AuthShell
      title="Complete seu cadastro"
      subtitle="Revise seus dados e informe unidade e setor."
    >
      <p className="auth-email">{email}</p>
      <form className="auth-form" onSubmit={submit}>
        <label>
          Nome completo
          <input name="fullName" defaultValue={suggested} minLength={2} required />
        </label>
        <label>
          Unidade
          <select name="unitId" value={unitId} onChange={(e) => setUnitId(e.target.value)} required>
            <option value="">Selecione</option>
            {units.map((u) => (
              <option key={u.id} value={u.id}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          Setor
          <select name="departmentId" required disabled={!unitId}>
            <option value="">Selecione</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <button className="button button-primary" disabled={!token || !email}>
          Concluir cadastro
        </button>
      </form>
    </AuthShell>
  );
}

export function ConnectionsPage() {
  const { user, request, refresh } = useAuth();
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function addPassword(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const fd = new FormData(e.currentTarget);
    const r = await request('/password/link', {
      method: 'POST',
      body: JSON.stringify({ password: fd.get('password') }),
    });
    if (!r.ok) setError(await errorText(r));
    else {
      setMessage('Senha vinculada à conta.');
      await refresh();
    }
  }
  return (
    <AuthShell
      title="Métodos de acesso"
      subtitle="Associe provedores depois de entrar na sua conta. Os métodos usam o mesmo perfil."
    >
      {user ? (
        <>
          <p className="auth-email">Conta: {user.email}</p>
          <ul className="provider-list">
            {user.authProviders.map((p) => (
              <li key={p}>{p === 'PASSWORD' ? 'E-mail e senha' : p}</li>
            ))}
          </ul>
          <OAuthButtons intent="link" />
          <form className="auth-form connection-form" onSubmit={addPassword}>
            <label>
              Vincular senha (mínimo 12 caracteres)
              <input name="password" type="password" minLength={12} required />
            </label>
            <button className="button button-secondary">Adicionar senha</button>
          </form>
          {message && <p className="notice notice-success">{message}</p>}
          {error && (
            <p className="form-error" role="alert">
              {error}
            </p>
          )}
        </>
      ) : (
        <p>Entre na conta para gerenciar os métodos de acesso.</p>
      )}
      <p className="auth-links centered">
        <Link to="/">Voltar ao portal</Link>
      </p>
    </AuthShell>
  );
}
