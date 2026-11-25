import { useEffect } from 'react';
import { IoHome, IoHomeOutline, IoPeople, IoPeopleOutline, IoPlayCircle, IoPlayCircleOutline, IoMenu, IoSearch, IoNotificationsOutline, IoChatbubbleEllipsesOutline, IoPeopleCircle, IoPeopleCircleOutline, IoBookmark, IoSettings, IoEye, IoFlag } from 'react-icons/io5';
import { useStore, me } from './store.js';
import { useHash, go, Avatar, Wordmark, LogoMark, Toaster } from './ui.jsx';
import { Welcome, Login, Register, Forgot, ResetPassword } from './auth.jsx';
import { SecurityPage, VerifyPage, AdsPage, CreatorPage, MoneyHub, ReportLayer } from './monet.jsx';
import { Feed, SideRail, PostPage } from './feed.jsx';
import { PrivacyCheckup } from './specials.jsx';
import { Profile } from './profile.jsx';
import { Messenger, Chat, CallLayer } from './messenger.jsx';
import { startMessengerSync, stopMessengerSync } from './msgx.js';
import { Friends, Reels, MenuPage, Notifications, Visitors, Saved, Settings, Help, SearchPage } from './more.jsx';
import { Groups, GroupPage, Pages, PagePage } from './groups.jsx';
import { Admin } from './admin.jsx';
import { Market } from './market.jsx';

const TABS = [
  ['feed', 'Home', IoHomeOutline, IoHome],
  ['friends', 'Friends', IoPeopleOutline, IoPeople],
  ['reels', 'Reels', IoPlayCircleOutline, IoPlayCircle],
  ['groups', 'Groups', IoPeopleCircleOutline, IoPeopleCircle],
  ['menu', 'Menu', IoMenu, IoMenu],
];

export default function App() {
  const s = useStore();
  const hash = useHash();
  const [, path = '', arg = ''] = hash.replace(/\?.*$/, '').split('/');
  const user = me(s);

  useEffect(() => { window.scrollTo(0, 0); }, [hash]);
  useEffect(() => { if (user?.cloud) { startMessengerSync(); return stopMessengerSync; } return undefined; }, [user?.id, user?.cloud]);

  if (path === 'reset') return <><ResetPassword /><Toaster /></>;
  // logged-out screens
  if (!user) {
    let v;
    if (path === 'login') v = <Login />;
    else if (path === 'register') v = <Register />;
    else if (path === 'forgot') v = <Forgot />;
    else v = <Welcome />;
    return <>{v}<Toaster /></>;
  }

  let page;
  switch (path) {
    case 'friends': page = <Friends />; break;
    case 'reels': page = <Reels />; break;
    case 'groups': page = <Groups />; break;
    case 'menu': page = <MenuPage />; break;
    case 'profile': page = <Profile id={arg || user.id} />; break;
    case 'messenger': page = <Messenger />; break;
    case 'chat': page = <Chat id={arg} />; break;
    case 'notifications': page = <Notifications />; break;
    case 'visitors': page = <Visitors />; break;
    case 'saved': page = <Saved />; break;
    case 'admin': page = <Admin />; break;
    case 'market': page = <Market />; break;
    case 'post': page = <PostPage id={arg} />; break;
    case 'privacy-checkup': page = <PrivacyCheckup />; break;
    case 'pages': page = <Pages />; break;
    case 'group': page = <GroupPage id={arg} />; break;
    case 'page': page = <PagePage id={arg} />; break;
    case 'settings': page = <Settings />; break;
    case 'help': page = <Help />; break;
    case 'security': page = <SecurityPage />; break;
    case 'verify': page = <VerifyPage />; break;
    case 'ads': page = <AdsPage />; break;
    case 'creator': page = <CreatorPage />; break;
    case 'earn': page = <MoneyHub />; break;
    case 'search': page = <SearchPage />; break;
    default: page = <Feed />;
  }
  const full = path === 'chat' || path === 'reels';
  const unread = s.notifs.filter((n) => n.to === user.id && !n.read).length;
  const reqs = s.requests.filter((r) => r.to === user.id).length;
  const active = path || 'feed';

  return (
    <div className={'shell' + (full ? ' shell-full' : '')}>
      <header className="topbar">
        <a href="#/feed" className="brand" aria-label="FYNZA Home"><LogoMark size={34} /><Wordmark color="#fff" size={26} /></a>
        <nav className="desk-tabs" aria-label="Main">
          {TABS.filter((t) => t[0] !== 'menu').map(([k, label, I, IA]) => {
            const Ic = active === k ? IA : I;
            return <a key={k} href={'#/' + k} className={active === k ? 'on' : ''} aria-label={label}><Ic size={26} />{k === 'friends' && reqs > 0 && <i className="badge">{reqs}</i>}</a>;
          })}
        </nav>
        <div className="top-actions">
          <a href="#/search" aria-label="Search" className="top-btn"><IoSearch size={22} /></a>
          <a href="#/messenger" aria-label="Message" className="top-btn"><IoChatbubbleEllipsesOutline size={22} /></a>
          <a href="#/notifications" aria-label="Notifications" className="top-btn"><IoNotificationsOutline size={22} />{unread > 0 && <i className="badge">{unread > 9 ? '9+' : unread}</i>}</a>
          <a href={'#/profile/' + user.id} className="top-btn desk-only" aria-label="My profile"><Avatar user={user} size={32} /></a>
        </div>
      </header>
      <div className="body">
        <aside className="left-rail desk-only">
          <a href={'#/profile/' + user.id} className="rail-link"><Avatar user={user} size={36} /><b>{user.name}</b></a>
          <a href="#/friends" className="rail-link"><IoPeople size={24} color="#1F4FE0" />Friends</a>
          <a href="#/groups" className="rail-link"><IoPeopleCircle size={24} color="#1F4FE0" />Groups</a>
          <a href="#/pages" className="rail-link"><IoFlag size={24} color="#E11D48" />Pages</a>
          <a href="#/visitors" className="rail-link"><IoEye size={24} color="#0EA5E9" />Who viewed my profile</a>
          <a href="#/saved" className="rail-link"><IoBookmark size={24} color="#4F46E5" />Saved</a>
          <a href="#/settings" className="rail-link"><IoSettings size={24} color="#475569" />Settings &amp; Privacy</a>
        </aside>
        <main className="main">{page}</main>
        <aside className="right-rail desk-only"><SideRail /></aside>
      </div>
      <nav className="tabbar" aria-label="Main">
        {TABS.map(([k, label, I, IA]) => {
          const Ic = active === k ? IA : I;
          return <a key={k} href={'#/' + k} className={active === k ? 'on' : ''}><Ic size={25} /><span>{label}</span>{k === 'friends' && reqs > 0 && <i className="badge">{reqs}</i>}</a>;
        })}
      </nav>
      <CallLayer />
      <ReportLayer />
      <Toaster />
    </div>
  );
}
