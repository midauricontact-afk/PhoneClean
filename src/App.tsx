import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { TabId } from './core/actions';
import { appStore, initApp } from './state/app';
import { initDrive } from './state/drive';
import { loadPhotos } from './state/photos';
import { Dialog } from './ui/components/Dialog';
import { IconChecklist, IconCloud, IconGear, IconHome, IconMap, IconPhoto } from './ui/icons';
import { DriveScreen } from './ui/screens/DriveScreen';
import { GuideScreen } from './ui/screens/GuideScreen';
import { HomeScreen } from './ui/screens/HomeScreen';
import { PhotosScreen } from './ui/screens/PhotosScreen';
import { SettingsScreen } from './ui/screens/SettingsScreen';
import { StorageScreen } from './ui/screens/StorageScreen';
import { UIContext, type DialogRequest, type UI } from './ui/uiContext';

const TABS: { id: TabId; label: string; title: string; icon: ReactNode }[] = [
  { id: 'home', label: 'Accueil', title: 'Accueil', icon: <IconHome /> },
  { id: 'storage', label: 'Stockage', title: 'Stockage iPhone', icon: <IconMap /> },
  { id: 'guide', label: 'Nettoyage', title: 'Nettoyage guidé', icon: <IconChecklist /> },
  { id: 'photos', label: 'Photos', title: 'Photos et vidéos', icon: <IconPhoto /> },
  { id: 'drive', label: 'Drive', title: 'Google Drive', icon: <IconCloud /> },
  { id: 'settings', label: 'Réglages', title: 'Réglages', icon: <IconGear /> },
];

export function App() {
  const app = appStore.use();
  const [tab, setTab] = useState<TabId>('home');
  const [dialog, setDialog] = useState<DialogRequest | null>(null);
  const resolver = useRef<((id: string | null) => void) | null>(null);

  useEffect(() => {
    void initApp().then(() => Promise.all([loadPhotos(), initDrive()]));
  }, []);

  const ask = useCallback(
    (req: DialogRequest) =>
      new Promise<string | null>((resolve) => {
        resolver.current?.(null);
        resolver.current = resolve;
        setDialog(req);
      }),
    [],
  );

  const ui = useMemo<UI>(
    () => ({
      ask,
      goTab: (t) => {
        window.scrollTo({ top: 0 });
        setTab(t);
      },
    }),
    [ask],
  );

  if (!app.ready) return <div className="splash" aria-busy="true" />;

  const current = TABS.find((t) => t.id === tab)!;

  return (
    <UIContext.Provider value={ui}>
      <div className="app">
        <header className="topbar">
          <h1>{current.title}</h1>
        </header>

        <main className="content">
          {tab === 'home' && <HomeScreen />}
          {tab === 'storage' && <StorageScreen />}
          {tab === 'guide' && <GuideScreen />}
          {tab === 'photos' && <PhotosScreen />}
          {tab === 'drive' && <DriveScreen />}
          {tab === 'settings' && <SettingsScreen />}
        </main>

        <nav className="tabbar" aria-label="Navigation">
          {TABS.map((t) => (
            <button
              key={t.id}
              className={tab === t.id ? 'active' : ''}
              aria-current={tab === t.id ? 'page' : undefined}
              onClick={() => {
                window.scrollTo({ top: 0, behavior: tab === t.id ? 'smooth' : 'auto' });
                setTab(t.id);
              }}
            >
              {t.icon}
              <span>{t.label}</span>
            </button>
          ))}
        </nav>
      </div>

      {dialog && (
        <Dialog
          req={dialog}
          onResult={(id) => {
            setDialog(null);
            const r = resolver.current;
            resolver.current = null;
            r?.(id);
          }}
        />
      )}

      <div className="toasts" aria-live="polite">
        {app.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            {t.text}
          </div>
        ))}
      </div>
    </UIContext.Provider>
  );
}
