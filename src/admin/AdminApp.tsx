// The /admin area: everything a manager needs to change the book.
import { NavLink, Route, Routes, Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { AcceptInvite, Account, Activity, MediaLibrary, Overview, People, QuizResults, SignIn } from './screens';
import { CollectionList, EntryEditor, PageOptions, useCollections } from './cms';
import { Loading } from './ui';
import { WineVideos } from './wine';
import { BottleScannerPage } from './scanner';

export default function AdminApp() {
  const { user, loaded } = useSession();
  return (
    <Routes>
      <Route path="invite/:token" element={<AcceptInvite />} />
      <Route path="*" element={!loaded ? <Loading /> : !user ? <SignIn /> : <Shell />} />
    </Routes>
  );
}

function Shell() {
  const { user } = useSession();
  const { data: cols } = useCollections();
  const owner = user?.role === 'owner';
  return (
    <div className="admin">
      <aside className="admin-side">
        <Link to="/" className="admin-logo"><img src="/img/logo-white.png" alt="The Baldwin" /></Link>
        <span className="admin-tag">Admin</span>
        <nav aria-label="Admin">
          <NavLink end to="/admin">Overview</NavLink>
          {cols?.collections && Object.values(cols.collections).map((c) => <NavLink key={c.id} to={`/admin/pages/${c.id}`}>{c.label}</NavLink>)}
          <NavLink to="/admin/wine-videos">Wine Videos</NavLink>
          <NavLink to="/admin/bottle-scanner">Bottle Scanner</NavLink>
          <NavLink to="/admin/media">Videos and Photos</NavLink>
          <NavLink to="/admin/quizzes">Quiz Results</NavLink>
          {owner && <NavLink to="/admin/people">People</NavLink>}
          {owner && <NavLink to="/admin/activity">Activity</NavLink>}
          <NavLink to="/admin/account">Your Account</NavLink>
        </nav>
        <Link to="/" className="admin-back">← Back to the Book</Link>
      </aside>
      <main className="admin-main" id="content">
        <PageOptions />
        <Routes>
          <Route index element={<Overview />} />
          <Route path="pages/:col" element={<CollectionList />} />
          <Route path="pages/:col/:id" element={<EntryEditor />} />
          <Route path="wine-videos" element={<WineVideos />} />
          <Route path="bottle-scanner" element={<BottleScannerPage />} />
          <Route path="media" element={<MediaLibrary />} />
          <Route path="quizzes" element={<QuizResults />} />
          <Route path="people" element={<People />} />
          <Route path="activity" element={<Activity />} />
          <Route path="account" element={<Account />} />
          <Route path="*" element={<div className="admin-page"><h1>Nothing here</h1><Link to="/admin">Go to the overview</Link></div>} />
        </Routes>
      </main>
    </div>
  );
}
