import { useEffect, useState } from 'react';
import { NavLink, Route, Routes, useLocation } from 'react-router-dom';
import { api, errorText } from './api';
import { Toaster } from './components/ui';
import Overview from './pages/Overview';
import Videos from './pages/Videos';
import VideoForm from './pages/VideoForm';
import VideoDetail from './pages/VideoDetail';
import Performance from './pages/Performance';
import Retention from './pages/Retention';
import Categories from './pages/Categories';
import { HooksPage, VisualPage } from './pages/Dimensions';
import Ranking from './pages/Ranking';
import Intelligence from './pages/Intelligence';
import Lab from './pages/Lab';
import Advisor from './pages/Advisor';
import Memory from './pages/Memory';
import Settings from './pages/Settings';
import Import from './pages/Import';
import Reports from './pages/Reports';

const NAV = [
  { to: '/', label: 'Overview', end: true },
  { to: '/videos', label: 'Videos' },
  { to: '/rendimiento', label: 'Rendimiento' },
  { to: '/retencion', label: 'Retención' },
  { to: '/categorias', label: 'Categorías' },
  { to: '/hooks', label: 'Hooks y storytelling' },
  { to: '/estilos', label: 'Estilos visuales' },
  { to: '/ranking', label: 'Ranking' },
  { to: '/laboratorio', label: 'Laboratorio' },
  { to: '/advisor', label: 'AI Advisor' },
  { to: '/memoria', label: 'Memoria histórica' },
  { to: '/configuracion', label: 'Configuración' },
];
const EXTRA = [
  { to: '/inteligencia', label: 'Inteligencia de contenido' },
  { to: '/informes', label: 'Informes' },
  { to: '/importar', label: 'Importar CSV' },
];

function Login({ onDone }: { onDone: () => void }) {
  const [pw, setPw] = useState('');
  const [err, setErr] = useState<string | null>(null);
  return (
    <form className="card login" onSubmit={async (e) => { e.preventDefault(); try { await api.post('/api/login', { password: pw }); onDone(); } catch (x) { setErr(errorText(x)); } }}>
      <div className="brand"><div className="brand-mark" /><div><div className="brand-name">Mundo Curioso Analytics</div><div className="brand-sub">Acceso privado</div></div></div>
      <label className="field">Contraseña<input type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoFocus /></label>
      {err && <div className="notice error" style={{ marginTop: 10 }}>{err}</div>}
      <button className="btn-primary" style={{ marginTop: 12, width: '100%', justifyContent: 'center' }}>Entrar</button>
    </form>
  );
}

export default function App() {
  const [session, setSession] = useState<{ auth_required: boolean; authenticated: boolean } | null>(null);
  const [account, setAccount] = useState<{ handle: string } | null>(null);
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  const check = () => api.get('/api/session').then(setSession).catch(() => setSession({ auth_required: false, authenticated: true }));
  useEffect(() => { check(); const h = () => check(); window.addEventListener('mca:unauthorized', h); return () => window.removeEventListener('mca:unauthorized', h); }, []);
  useEffect(() => { if (session?.authenticated) api.get('/api/account').then(setAccount).catch(() => {}); }, [session?.authenticated]);
  useEffect(() => { setOpen(false); window.scrollTo(0, 0); }, [loc.pathname]);
  if (!session) return null;
  if (!session.authenticated) return <Login onDone={check} />;
  return (
    <div className="layout">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <div className="brand-mark" />
          <div><div className="brand-name">Mundo Curioso<br />Analytics</div><div className="brand-sub">@{account?.handle ?? 'mundo.curioso13'}</div></div>
        </div>
        <nav className="nav">
          {NAV.map((n, i) => <NavLink key={n.to} to={n.to} end={n.end}><span className="num">{i + 1}</span>{n.label}</NavLink>)}
          <div className="nav-sep" />
          {EXTRA.map((n) => <NavLink key={n.to} to={n.to}><span className="num">·</span>{n.label}</NavLink>)}
          {session.auth_required && <><div className="nav-sep" /><a href="#" onClick={async (e) => { e.preventDefault(); await api.post('/api/logout'); check(); }}><span className="num" />Cerrar sesión</a></>}
        </nav>
      </aside>
      <div style={{ minWidth: 0 }}>
        <div className="mobile-bar">
          <button className="btn-ghost" aria-label="Abrir menú" onClick={() => setOpen(true)}>☰</button>
          <strong>Mundo Curioso Analytics</strong>
        </div>
        {open && <div style={{ position: 'fixed', inset: 0, zIndex: 45 }} onClick={() => setOpen(false)} />}
        <main className="main">
          <Routes>
            <Route path="/" element={<Overview />} />
            <Route path="/videos" element={<Videos />} />
            <Route path="/videos/nuevo" element={<VideoForm />} />
            <Route path="/videos/:id" element={<VideoDetail />} />
            <Route path="/videos/:id/editar" element={<VideoForm />} />
            <Route path="/rendimiento" element={<Performance />} />
            <Route path="/retencion" element={<Retention />} />
            <Route path="/categorias" element={<Categories />} />
            <Route path="/hooks" element={<HooksPage />} />
            <Route path="/estilos" element={<VisualPage />} />
            <Route path="/ranking" element={<Ranking />} />
            <Route path="/inteligencia" element={<Intelligence />} />
            <Route path="/laboratorio" element={<Lab />} />
            <Route path="/advisor" element={<Advisor />} />
            <Route path="/memoria" element={<Memory />} />
            <Route path="/configuracion" element={<Settings />} />
            <Route path="/importar" element={<Import />} />
            <Route path="/informes" element={<Reports />} />
            <Route path="*" element={<div className="empty"><strong>Página no encontrada</strong></div>} />
          </Routes>
        </main>
      </div>
      <Toaster />
    </div>
  );
}
