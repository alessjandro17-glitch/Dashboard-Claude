import { useEffect, useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api, errorText } from '../api';
import { Card, ErrorNote, Field, PageHead, SortTable, Tabs, toast, useApi } from '../components/ui';
import { fmtDate, fmtInt } from '../format';

const ACC_FIELDS: [string, string][] = [
  ['followers_count', 'Seguidores (total ese día)'], ['new_followers', 'Nuevos seguidores (netos)'], ['reach', 'Alcance de la cuenta'],
  ['impressions', 'Impresiones'], ['views', 'Visualizaciones'], ['profile_visits', 'Visitas al perfil'],
];
const TABLES = ['videos', 'video_metrics_snapshots', 'video_creative_attributes', 'content_categories', 'account_daily_metrics', 'content_experiments', 'experiment_videos', 'experiment_results', 'historical_patterns', 'recommendations', 'decisions', 'analysis_runs', 'production_notes', 'audit_log'];

function AccountMetrics() {
  const list = useApi<any[]>('/api/account-metrics');
  const blank = () => ({ date: new Date().toISOString().slice(0, 10), notes: '', ...Object.fromEntries(ACC_FIELDS.map(([k]) => [k, ''])) }) as Record<string, string>;
  const [f, setF] = useState(blank);
  const [edit, setEdit] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  async function submit(e: FormEvent) {
    e.preventDefault();
    setErr(null);
    const body: Record<string, unknown> = { date: f.date, notes: f.notes || null };
    for (const [k] of ACC_FIELDS) body[k] = f[k].trim() === '' ? null : Number(f[k].replace(/\./g, '').replace(',', '.'));
    try {
      if (edit) await api.put(`/api/account-metrics/${edit.id}`, body); else await api.post('/api/account-metrics', body);
      toast('Registro guardado'); setF(blank()); setEdit(null); list.reload();
    } catch (x) { setErr(errorText(x)); }
  }
  return (
    <div className="grid grid-2">
      <Card title={edit ? `Editar ${fmtDate(edit.date)}` : 'Registrar día'}>
        <form onSubmit={submit} className="stack">
          <div className="form-grid">
            <Field label="Fecha *"><input type="date" required value={f.date} onChange={(e) => setF({ ...f, date: e.target.value })} /></Field>
            {ACC_FIELDS.map(([k, l]) => <Field key={k} label={l}><input inputMode="numeric" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} placeholder="No registrado" /></Field>)}
            <Field label="Notas" wide><input value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} /></Field>
          </div>
          <ErrorNote error={err} />
          <div className="row"><button className="btn-primary">Guardar</button>{edit && <button type="button" onClick={() => { setEdit(null); setF(blank()); }}>Cancelar</button>}<Link className="btn" to="/importar?tipo=cuenta">Importar CSV de cuenta</Link></div>
          <p className="hint">Usa los datos del panel de Estadísticas de Instagram. Alcance, impresiones y visualizaciones son métricas distintas: regístralas por separado y deja vacías las que no tengas.</p>
        </form>
      </Card>
      <Card title="Registros de la cuenta">
        <div style={{ maxHeight: 460, overflowY: 'auto' }}>
          <SortTable rows={list.data || []} initialSort={{ key: 'date', dir: 'desc' }} columns={[
            { key: 'date', label: 'Fecha', value: (r) => r.date, render: (r) => fmtDate(r.date) },
            { key: 'f', label: 'Seguidores', num: true, value: (r) => r.followers_count, render: (r) => r.followers_count === null ? null : fmtInt(r.followers_count) },
            { key: 'r', label: 'Alcance', num: true, value: (r) => r.reach, render: (r) => r.reach === null ? null : fmtInt(r.reach) },
            { key: 'v', label: 'Visualiz.', num: true, value: (r) => r.views, render: (r) => r.views === null ? null : fmtInt(r.views) },
            { key: 'a', label: '', sortable: false, render: (r) => <div className="row"><button className="btn-ghost" onClick={() => { setEdit(r); setF({ date: r.date.slice(0, 10), notes: r.notes ?? '', ...Object.fromEntries(ACC_FIELDS.map(([k]) => [k, r[k]?.toString() ?? ''])) }); }}>Editar</button><button className="btn-ghost btn-danger" onClick={async () => { if (confirm('¿Eliminar este registro?')) { await api.del(`/api/account-metrics/${r.id}`); list.reload(); } }}>Eliminar</button></div> },
          ]} empty={<p className="muted">Sin registros de cuenta.</p>} />
        </div>
      </Card>
    </div>
  );
}

export default function Settings() {
  const [params] = useSearchParams();
  const [tab, setTab] = useState(params.get('tab') || 'cuenta');
  const status = useApi<any>('/api/status');
  const account = useApi<any>('/api/account');
  const [handle, setHandle] = useState('');
  useEffect(() => { if (account.data) setHandle(account.data.handle); }, [account.data]);
  const s = status.data;
  return (
    <>
      <PageHead title="Configuración" sub="Cuenta, métricas diarias, integraciones, sistema y copias de seguridad." />
      <Tabs value={tab} onChange={setTab} options={[
        { value: 'cuenta', label: 'Métricas de la cuenta' }, { value: 'integraciones', label: 'Integraciones' }, { value: 'datos', label: 'Datos y copias' }, { value: 'sistema', label: 'Sistema' },
      ]} />
      {tab === 'cuenta' && (
        <>
          <Card title="Cuenta">
            <form className="row" onSubmit={async (e) => { e.preventDefault(); try { await api.put('/api/account', { handle, display_name: account.data?.display_name }); toast('Cuenta actualizada'); account.reload(); } catch (x) { toast(errorText(x), 'error'); } }}>
              <span className="muted">@</span><input value={handle} onChange={(e) => setHandle(e.target.value)} aria-label="Usuario de Instagram" />
              <button>Guardar</button>
            </form>
          </Card>
          <div className="section-gap"><AccountMetrics /></div>
        </>
      )}
      {tab === 'integraciones' && s && (
        <div className="grid grid-2">
          <InstagramCard onChange={status.reload} />
          <Card title="AI Advisor (Claude)">
            <p>Estado: <span className={`badge ${s.advisor_configured ? 'alta' : 'warn'}`}>{s.advisor_configured ? 'Clave configurada' : 'No configurado'}</span></p>
            <p className="small">{s.advisor_configured ? <>Listo. Úsalo en <Link to="/advisor">AI Advisor</Link>.</> : <>Añade <code>ANTHROPIC_API_KEY=…</code> al archivo <code>.env</code> del servidor y reinicia la app.</>} La clave se guarda solo en el servidor, nunca en el navegador.</p>
          </Card>
        </div>
      )}
      {tab === 'datos' && (
        <div className="grid grid-2">
          <Card title="Copia de seguridad completa">
            <p className="small">Descarga todas las tablas en un único archivo JSON. Guárdalo periódicamente.</p>
            <a className="btn btn-primary" href="/api/export/backup.json">Descargar copia (JSON)</a>
            <p className="hint section-gap">En Supabase también tienes copias automáticas diarias del plan de pago y puedes usar <code>pg_dump</code> con la cadena de conexión.</p>
          </Card>
          <Card title="Exportar tablas a CSV">
            <div className="row">{TABLES.map((t) => <a key={t} className="btn" href={`/api/export/${t}.csv`}>{t}</a>)}</div>
          </Card>
          <Card title="Importar"><div className="row"><Link className="btn" to="/importar">Importar videos y métricas (CSV)</Link><Link className="btn" to="/importar?tipo=cuenta">Importar métricas de cuenta (CSV)</Link></div></Card>
          <Card title="Informes"><Link className="btn" to="/informes">Generar informe semanal, mensual, trimestral o anual</Link></Card>
        </div>
      )}
      {tab === 'sistema' && s && (
        <Card title="Estado del sistema">
          <dl className="dl">
            <dt>Base de datos</dt><dd>{s.database.engine} en {s.database.host}{s.database.supabase ? ' (Supabase)' : ''}</dd>
            <dt>Migraciones</dt><dd>{s.database.migrations.map((m: any) => `${m.name} (${fmtDate(m.applied_at)})`).join(', ')}</dd>
            <dt>Acceso con contraseña</dt><dd>{s.auth_enabled ? 'Activado' : 'Desactivado (define APP_PASSWORD para activarlo)'}</dd>
            <dt>Muestra mínima por grupo</dt><dd>{s.min_group} videos</dd>
            <dt>Muestra mínima para ranking</dt><dd>{s.min_ranking} videos</dd>
          </dl>
        </Card>
      )}
    </>
  );
}

const IG_STATUS: Record<string, [string, string]> = {
  no_configurada: ['No conectada', 'warn'], conectada: ['Conectada', 'alta'], token_caducado: ['Token caducado', 'warn'], error: ['Error', 'warn'],
};
const IG_RETURN: Record<string, string> = {
  ok: 'Cuenta de Instagram conectada.', cancelado: 'Conexión cancelada en Instagram.', estado_invalido: 'La conexión no se pudo verificar. Vuelve a intentarlo.', error: 'Instagram rechazó la conexión. Mira el detalle del error abajo.',
};

function InstagramCard({ onChange }: { onChange: () => void }) {
  const st = useApi<any>('/api/instagram/status');
  const [params] = useSearchParams();
  const [token, setToken] = useState('');
  const [igId, setIgId] = useState('');
  const isFb = token.trim().startsWith('EAA');
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<any>(null);
  const [err, setErr] = useState<string | null>(null);
  const d = st.data;
  const returned = params.get('instagram');
  async function run(name: string, fn: () => Promise<any>) {
    setErr(null); setBusy(name);
    try { await fn(); st.reload(); onChange(); } catch (x) { setErr(errorText(x)); st.reload(); } finally { setBusy(null); }
  }
  const [label, cls] = IG_STATUS[d?.status] ?? [d?.status, 'warn'];
  return (
    <Card title="Instagram (API oficial de Meta)">
      {!d ? <p className="small muted">Cargando…</p> : (
        <div className="stack">
          {returned && IG_RETURN[returned] && <div className={`notice ${returned === 'ok' ? '' : 'warn'}`}>{IG_RETURN[returned]}</div>}
          <p>Estado: <span className={`badge ${cls}`}>{label}</span>{d.username && <> · <strong>@{d.username}</strong></>}</p>
          {d.status === 'conectada' && (
            <dl className="dl">
              <dt>Última sincronización</dt><dd>{d.last_sync_at ? fmtDate(d.last_sync_at, true) : 'Nunca'}</dd>
              <dt>Automática</dt><dd>{d.sync_hours > 0 ? `cada ${d.sync_hours} h (Reels de los últimos 60 días)` : 'desactivada'}</dd>
              {d.token_expires_at && <><dt>Token caduca</dt><dd>{fmtDate(d.token_expires_at)} (se renueva solo al sincronizar)</dd></>}
            </dl>
          )}
          {d.last_error && <div className="notice warn">{d.last_error}</div>}
          {d.status === 'conectada' ? (
            <div className="row">
              <button className="btn-primary" disabled={!!busy} onClick={() => run('sync', async () => setResult(await api.post('/api/instagram/sync', {})))}>{busy === 'sync' ? 'Sincronizando…' : 'Sincronizar ahora'}</button>
              <button disabled={!!busy} onClick={() => run('all', async () => setResult(await api.post('/api/instagram/sync', { all: true })))}>{busy === 'all' ? 'Sincronizando…' : 'Sincronizar todo el historial'}</button>
              <button className="btn-ghost" disabled={!!busy} onClick={() => { if (confirm('¿Desconectar Instagram? Las mediciones ya guardadas se conservan.')) run('off', () => api.post('/api/instagram/disconnect')); }}>Desconectar</button>
            </div>
          ) : (
            <>
              <form className="stack" onSubmit={(e) => { e.preventDefault(); run('token', async () => { await api.post('/api/instagram/token', { access_token: token, ig_user_id: igId.trim() || undefined }); setToken(''); setIgId(''); toast('Instagram conectado'); }); }}>
                <Field label="Token de acceso" wide hint={<>Token de Instagram (IGAA…) o, en apps nuevas de Meta, token de usuario del sistema (EAA…) generado en business.facebook.com → Usuarios del sistema, con los permisos instagram_basic e instagram_manage_insights. Se guarda cifrado.</>}>
                  <input type="password" autoComplete="off" value={token} onChange={(e) => setToken(e.target.value)} placeholder="IGAA… o EAA…" />
                </Field>
                {isFb && (
                  <Field label="ID de la cuenta de Instagram" hint="business.facebook.com → Configuración → Cuentas → Cuentas de Instagram. Solo números.">
                    <input inputMode="numeric" value={igId} onChange={(e) => setIgId(e.target.value)} placeholder="17841400000000000" />
                  </Field>
                )}
                <div className="row">
                  <button className="btn-primary" disabled={!!busy || token.trim().length < 20}>{busy === 'token' ? 'Comprobando…' : 'Conectar con token'}</button>
                  {d.app_configured && <a className="btn" href="/api/instagram/connect">Conectar con Instagram (OAuth)</a>}
                </div>
              </form>
            </>
          )}
          <ErrorNote error={err} />
          {result && (
            <div className="notice">
              {result.reels} Reels revisados · {result.videos_created} videos nuevos · {result.snapshots_created} mediciones nuevas · {result.unchanged} sin cambios
              {result.followers_count !== null && <> · {fmtInt(result.followers_count)} seguidores</>}
              {result.account_days > 0 && <> · {result.account_days} días de métricas de cuenta</>}
              {result.failed.length > 0 && <> · {result.failed.length} sin métricas. Error: {result.failed[0].error}</>}
            </div>
          )}
          <p className="hint">Se importan, por Reel: reproducciones, alcance, me gusta, comentarios, compartidos, guardados y tiempos de reproducción. La API no da impresiones, visitas al perfil ni seguidores por Reel: regístralos a mano si los necesitas. Instagram puede tardar hasta 48 h en consolidar las cifras. Sin scraping.</p>
        </div>
      )}
    </Card>
  );
}
