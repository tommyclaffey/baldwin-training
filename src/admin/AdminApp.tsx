// The /admin area: everything a manager needs to change the book.
import { NavLink, Route, Routes, Link } from 'react-router-dom';
import { useSession } from '../lib/session';
import { ItemEditor } from './ItemEditor';
import { AcceptInvite, Account, Activity, ItemList, MediaLibrary, Overview, People, QuizResults, SignIn } from './screens';
import { Loading } from './ui';

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
  const owner = user?.role === 'owner';
  return (
    <div className="admin">
      <aside className="admin-side">
        <Link to="/" className="admin-logo"><img src="/img/logo-white.png" alt="The Baldwin" /></Link>
        <span className="admin-tag">Admin</span>
        <nav aria-label="Admin">
          <NavLink end to="/admin">Overview</NavLink>
          <NavLink to="/admin/recipes">Recipes</NavLink>
          <NavLink to="/admin/cocktails">House Cocktails</NavLink>
          <NavLink to="/admin/media">Videos and Photos</NavLink>
          <NavLink to="/admin/quizzes">Quiz Results</NavLink>
          {owner && <NavLink to="/admin/people">People</NavLink>}
          {owner && <NavLink to="/admin/activity">Activity</NavLink>}
          <NavLink to="/admin/account">Your Account</NavLink>
        </nav>
        <Link to="/" className="admin-back">← Back to the Book</Link>
      </aside>
      <main className="admin-main" id="content">
        <Routes>
          <Route index element={<Overview />} />
          <Route path="recipes" element={<ItemList type="dish" />} />
          <Route path="recipes/new" element={<ItemEditor key="new-dish" type="dish" />} />
          <Route path="recipes/:id" element={<ItemEditor type="dish" />} />
          <Route path="cocktails" element={<ItemList type="cocktail" />} />
          <Route path="cocktails/new" element={<ItemEditor key="new-cocktail" type="cocktail" />} />
          <Route path="cocktails/:id" element={<ItemEditor type="cocktail" />} />
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
