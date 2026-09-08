import { useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const GENRES = ['Электроника', 'Хип-хоп', 'Рок', 'Поп', 'Эмбиент', 'Инди', 'Другое'];

function initials(name) {
  return (name || '?').trim().split(/\s+/).map((w) => w[0]).slice(0, 2).join('').toUpperCase();
}
function fmtTime(s) {
  if (!isFinite(s)) return '0:00';
  const m = Math.floor(s / 60), sec = Math.floor(s % 60);
  return m + ':' + String(sec).padStart(2, '0');
}
function fmtDate(ts) {
  return new Date(ts).toLocaleDateString('ru-RU', { day: 'numeric', month: 'short' });
}

export default function Home() {
  const [session, setSession] = useState(null);
  const [profile, setProfile] = useState(null);
  const [tracks, setTracks] = useState([]);
  const [loadingTracks, setLoadingTracks] = useState(true);
  const [view, setView] = useState('home');
  const [search, setSearch] = useState('');
  const [genreFilter, setGenreFilter] = useState('');

  const [authOpen, setAuthOpen] = useState(false);
  const [authTab, setAuthTab] = useState('login');
  const [loginId, setLoginId] = useState('');
  const [loginPass, setLoginPass] = useState('');
  const [loginErr, setLoginErr] = useState('');
  const [regName, setRegName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPass, setRegPass] = useState('');
  const [regErr, setRegErr] = useState('');

  const [uploadOpen, setUploadOpen] = useState(false);
  const [file, setFile] = useState(null);
  const [trackTitle, setTrackTitle] = useState('');
  const [trackGenre, setTrackGenre] = useState(GENRES[0]);
  const [uploadErr, setUploadErr] = useState('');
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

  const [currentTrack, setCurrentTrack] = useState(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [curTime, setCurTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const audioRef = useRef(null);

  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef(null);
  function toast(msg) {
    setToastMsg(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 2400);
  }

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data: listener } = supabase.auth.onAuthStateChange((_event, sess) => setSession(sess));
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) { setProfile(null); return; }
    ensureProfile();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session]);

  async function ensureProfile() {
    const user = session.user;
    let { data } = await supabase.from('profiles').select('*').eq('id', user.id).single();
    if (!data) {
      const name = user.user_metadata?.full_name || (user.email ? user.email.split('@')[0] : 'Артист');
      const { data: created } = await supabase.from('profiles').insert({ id: user.id, name }).select().single();
      data = created;
    }
    setProfile(data);
  }

  async function loadTracks() {
    setLoadingTracks(true);
    const { data, error } = await supabase
      .from('tracks')
      .select('id,title,genre,audio_path,author_id,created_at,profiles(name),likes(user_id)')
      .order('created_at', { ascending: false });
    if (!error) setTracks(data || []);
    setLoadingTracks(false);
  }
  useEffect(() => { loadTracks(); }, []);

  function audioUrl(path) {
    return supabase.storage.from('tracks').getPublicUrl(path).data.publicUrl;
  }

  async function doLogin() {
    setLoginErr('');
    const { error } = await supabase.auth.signInWithPassword({ email: loginId.trim(), password: loginPass });
    if (error) { setLoginErr('Неверный email или пароль'); return; }
    setAuthOpen(false);
    toast('Добро пожаловать');
  }
  async function doRegister() {
    setRegErr('');
    if (!regName || !regEmail || !regPass) { setRegErr('Заполните все поля'); return; }
    const { error } = await supabase.auth.signUp({
      email: regEmail.trim(), password: regPass, options: { data: { full_name: regName } },
    });
    if (error) { setRegErr(error.message); return; }
    setAuthOpen(false);
    toast('Аккаунт создан');
  }
  async function doGoogle() {
    await supabase.auth.signInWithOAuth({ provider: 'google', options: { redirectTo: window.location.origin } });
  }
  async function doLogout() {
    await supabase.auth.signOut();
    setView('home');
  }

  function handleFile(f) {
    if (!f) return;
    if (!f.type.startsWith('audio/')) { setUploadErr('Выберите аудиофайл'); return; }
    if (f.size > 15 * 1024 * 1024) { setUploadErr('Файл больше 15 МБ'); return; }
    setUploadErr('');
    setFile(f);
    if (!trackTitle) setTrackTitle(f.name.replace(/\.[^.]+$/, ''));
  }

  async function submitUpload() {
    if (!file) { setUploadErr('Выберите аудиофайл'); return; }
    if (!trackTitle.trim()) { setUploadErr('Введите название'); return; }
    setUploading(true);
    const path = `${session.user.id}/${Date.now()}-${file.name}`;
    const { error: upErr } = await supabase.storage.from('tracks').upload(path, file);
    if (upErr) { setUploadErr('Ошибка загрузки: ' + upErr.message); setUploading(false); return; }
    const { error: insErr } = await supabase.from('tracks').insert({
      title: trackTitle.trim(), genre: trackGenre, audio_path: path, author_id: session.user.id,
    });
    setUploading(false);
    if (insErr) { setUploadErr('Ошибка сохранения: ' + insErr.message); return; }
    setUploadOpen(false);
    setFile(null); setTrackTitle('');
    await loadTracks();
    setView('home');
    toast('Трек опубликован');
  }

  async function toggleLike(track) {
    if (!session) { setAuthOpen(true); return; }
    const liked = track.likes.some((l) => l.user_id === session.user.id);
    if (liked) {
      await supabase.from('likes').delete().eq('track_id', track.id).eq('user_id', session.user.id);
    } else {
      await supabase.from('likes').insert({ track_id: track.id, user_id: session.user.id });
    }
    loadTracks();
  }

  function togglePlay(track) {
    if (currentTrack?.id === track.id) {
      if (isPlaying) audioRef.current.pause(); else audioRef.current.play();
    } else {
      setCurrentTrack(track);
      setTimeout(() => {
        if (audioRef.current) {
          audioRef.current.src = audioUrl(track.audio_path);
          audioRef.current.play();
        }
      }, 0);
    }
  }

  const filtered = tracks.filter((t) => {
    const q = search.trim().toLowerCase();
    const matchesQ = !q || t.title.toLowerCase().includes(q) || (t.profiles?.name || '').toLowerCase().includes(q);
    const matchesG = !genreFilter || t.genre === genreFilter;
    return matchesQ && matchesG;
  });
  const myTracks = session ? tracks.filter((t) => t.author_id === session.user.id) : [];
  const genresPresent = [...new Set(tracks.map((t) => t.genre))].sort();

  function TrackRow({ t, idx }) {
    const liked = session && t.likes.some((l) => l.user_id === session.user.id);
    const playing = currentTrack?.id === t.id && isPlaying;
    return (
      <div className="track-row">
        <div className="track-num">{idx + 1}</div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14, minWidth: 0 }}>
          <button className={'track-play' + (playing ? ' playing' : '')} onClick={() => togglePlay(t)}>
            {playing ? <PauseIcon /> : <PlayIcon />}
          </button>
          <div className="track-info">
            <p className="track-title">{t.title}</p>
            <p className="track-meta">{t.profiles?.name || 'Артист'} · {fmtDate(t.created_at)}</p>
          </div>
        </div>
        <div className="track-genre">{t.genre}</div>
        <button className={'like-btn' + (liked ? ' liked' : '')} onClick={() => toggleLike(t)}>
          <HeartIcon filled={liked} /> {t.likes.length}
        </button>
      </div>
    );
  }

  return (
    <>
      <header>
        <div className="logo"><span className="mark"><LogoMark /></span>Arzam</div>
        <nav>
          <button className={'nav-link' + (view === 'home' ? ' active' : '')} onClick={() => setView('home')}>Главная</button>
          <button
            className={'nav-link' + (view === 'library' ? ' active' : '')}
            onClick={() => { if (!session) { setAuthOpen(true); return; } setView('library'); }}
          >Профиль</button>
        </nav>
        <div className="header-right">
          {session ? (
            <>
              <button className="btn btn-ghost" onClick={() => setUploadOpen(true)}>Загрузить</button>
              <div className="user-chip" onClick={() => { if (confirm('Выйти из аккаунта?')) doLogout(); }}>
                <div className="avatar">{initials(profile?.name)}</div>
                <span style={{ fontSize: 14 }}>{profile?.name}</span>
              </div>
            </>
          ) : (
            <>
              <button className="btn btn-ghost" onClick={() => { setAuthTab('login'); setAuthOpen(true); }}>Войти</button>
              <button className="btn btn-accent" onClick={() => { setAuthTab('register'); setAuthOpen(true); }}>Регистрация</button>
            </>
          )}
        </div>
      </header>

      <main>
        <section className="hero">
          <div className="eyebrow">Бесплатная площадка для музыкантов</div>
          <h1>Публикуй музыку так же легко, как её пишешь</h1>
          <p>Arzam — открытая платформа, где любой может выложить свой трек за пару минут, без модерации лейблов и без платы за размещение.</p>
          <div className="hero-actions">
            <button className="btn btn-accent" onClick={() => (session ? setUploadOpen(true) : setAuthOpen(true))}>Загрузить трек</button>
            <button className="btn btn-ghost" onClick={() => setView('home')}>Слушать ленту</button>
          </div>
        </section>

        {view === 'home' && (
          <div>
            <div className="section-head">
              <h2>Новые треки</h2>
              <div className="search-row">
                <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Поиск по названию или автору" />
                <select value={genreFilter} onChange={(e) => setGenreFilter(e.target.value)}>
                  <option value="">Все жанры</option>
                  {genresPresent.map((g) => <option key={g}>{g}</option>)}
                </select>
              </div>
            </div>
            <div className="tracklist">
              {loadingTracks ? (
                <div className="empty-state"><h3>Загрузка…</h3></div>
              ) : filtered.length === 0 ? (
                <div className="empty-state">
                  <h3>Пока тихо</h3>
                  <p>Треков не найдено. Стань первым, кто здесь прозвучит.</p>
                  <button className="btn btn-accent" onClick={() => (session ? setUploadOpen(true) : setAuthOpen(true))}>Загрузить трек</button>
                </div>
              ) : filtered.map((t, i) => <TrackRow key={t.id} t={t} idx={i} />)}
            </div>
          </div>
        )}

        {view === 'library' && session && (
          <div>
            <div className="section-head"><h2>Треки — {profile?.name}</h2></div>
            <div className="tracklist">
              {myTracks.length === 0 ? (
                <div className="empty-state">
                  <h3>Ты ещё ничего не выложил</h3>
                  <button className="btn btn-accent" onClick={() => setUploadOpen(true)}>Загрузить трек</button>
                </div>
              ) : myTracks.map((t, i) => <TrackRow key={t.id} t={t} idx={i} />)}
            </div>
          </div>
        )}
      </main>

      <footer><div>Arzam © 2026 — площадка для независимых артистов</div></footer>

      {authOpen && (
        <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) setAuthOpen(false); }}>
          <div className="modal">
            <button className="modal-close" onClick={() => setAuthOpen(false)}>✕</button>
            <div className="tabs">
              <button className={authTab === 'login' ? 'active' : ''} onClick={() => setAuthTab('login')}>Вход</button>
              <button className={authTab === 'register' ? 'active' : ''} onClick={() => setAuthTab('register')}>Регистрация</button>
            </div>
            {authTab === 'login' ? (
              <div>
                <h2>С возвращением</h2>
                <p className="sub">Войдите, чтобы загружать треки и ставить лайки</p>
                <div className="field"><label>Email</label><input value={loginId} onChange={(e) => setLoginId(e.target.value)} /></div>
                <div className="field"><label>Пароль</label><input type="password" value={loginPass} onChange={(e) => setLoginPass(e.target.value)} /></div>
                <div className="err">{loginErr}</div>
                <button className="btn btn-accent" onClick={doLogin}>Войти</button>
                <div className="divider">или</div>
                <button className="btn google-btn" onClick={doGoogle}><span className="g-icon"></span> Войти через Google</button>
              </div>
            ) : (
              <div>
                <h2>Создать аккаунт</h2>
                <p className="sub">Это займёт меньше минуты</p>
                <div className="field"><label>Имя артиста</label><input value={regName} onChange={(e) => setRegName(e.target.value)} /></div>
                <div className="field"><label>Email</label><input value={regEmail} onChange={(e) => setRegEmail(e.target.value)} /></div>
                <div className="field"><label>Пароль</label><input type="password" value={regPass} onChange={(e) => setRegPass(e.target.value)} /></div>
                <div className="err">{regErr}</div>
                <button className="btn btn-accent" onClick={doRegister}>Зарегистрироваться</button>
                <div className="divider">или</div>
                <button className="btn google-btn" onClick={doGoogle}><span className="g-icon"></span> Продолжить с Google</button>
              </div>
            )}
          </div>
        </div>
      )}

      {uploadOpen && (
        <div className="overlay show" onClick={(e) => { if (e.target === e.currentTarget) setUploadOpen(false); }}>
          <div className="modal">
            <button className="modal-close" onClick={() => setUploadOpen(false)}>✕</button>
            <h2>Загрузить трек</h2>
            <p className="sub">Файл будет виден всем посетителям сайта</p>
            <div className={'drop' + (file ? ' has-file' : '')} onClick={() => fileInputRef.current.click()}>
              <div>{file ? '✓ ' + file.name : 'Нажмите, чтобы выбрать аудиофайл'}</div>
              <input ref={fileInputRef} type="file" accept="audio/*" style={{ display: 'none' }} onChange={(e) => handleFile(e.target.files[0])} />
            </div>
            <div className="field"><label>Название трека</label><input value={trackTitle} onChange={(e) => setTrackTitle(e.target.value)} /></div>
            <div className="field">
              <label>Жанр</label>
              <select value={trackGenre} onChange={(e) => setTrackGenre(e.target.value)}>
                {GENRES.map((g) => <option key={g}>{g}</option>)}
              </select>
            </div>
            <div className="err">{uploadErr}</div>
            <button className="btn btn-accent" onClick={submitUpload} disabled={uploading}>{uploading ? 'Загрузка…' : 'Опубликовать'}</button>
          </div>
        </div>
      )}

      {currentTrack && (
        <div className="player-bar show">
          <button className="player-play" onClick={() => { if (isPlaying) audioRef.current.pause(); else audioRef.current.play(); }}>
            {isPlaying ? <PauseIcon dark /> : <PlayIcon dark />}
          </button>
          <div className="player-track-info">
            <div className="t">{currentTrack.title}</div>
            <div className="a">{currentTrack.profiles?.name}</div>
          </div>
          <div className="player-progress">
            <span>{fmtTime(curTime)}</span>
            <input
              type="range" min="0" max="100" value={duration ? (curTime / duration) * 100 : 0}
              onChange={(e) => { if (audioRef.current && duration) audioRef.current.currentTime = (e.target.value / 100) * duration; }}
            />
            <span>{fmtTime(duration)}</span>
          </div>
        </div>
      )}

      <audio
        ref={audioRef}
        onPlay={() => setIsPlaying(true)}
        onPause={() => setIsPlaying(false)}
        onTimeUpdate={() => { setCurTime(audioRef.current.currentTime); setDuration(audioRef.current.duration || 0); }}
      />
      {toastMsg && <div className="toast show">{toastMsg}</div>}
    </>
  );
}

function LogoMark() {
  return <svg viewBox="0 0 20 20" fill="none"><path d="M2 14 L2 9 M6 16 L6 5 M10 17 L10 3 M14 16 L14 6 M18 13 L18 8" stroke="#e8a33d" strokeWidth="2" strokeLinecap="round" /></svg>;
}
function PlayIcon({ dark }) {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill={dark ? '#1a1305' : 'currentColor'}><polygon points="6,4 20,12 6,20" /></svg>;
}
function PauseIcon({ dark }) {
  return <svg width="12" height="12" viewBox="0 0 24 24" fill={dark ? '#1a1305' : 'currentColor'}><rect x="5" y="4" width="5" height="16" /><rect x="14" y="4" width="5" height="16" /></svg>;
}
function HeartIcon({ filled }) {
  return <svg width="15" height="15" viewBox="0 0 24 24" fill={filled ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="1.8"><path d="M12 21s-7.5-4.8-10-9.3C.4 8 2 4 6 4c2.2 0 3.8 1.3 6 3.8C14.2 5.3 15.8 4 18 4c4 0 5.6 4 4 7.7C19.5 16.2 12 21 12 21z" /></svg>;
         }
