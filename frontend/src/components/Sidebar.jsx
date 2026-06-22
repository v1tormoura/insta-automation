import { Link } from 'react-router-dom';

export default function Sidebar() {
  return (
    <div className="sidebar">
      <h1 className="logo">Automação</h1>

      <Link to="/">Dashboard</Link>

      <Link to="/accounts">Contas</Link>

      <Link to="/posts">Posts</Link>

      <Link to="/stories">Stories</Link>

      <Link to="/scheduler">Agendador</Link>
    </div>
  );
}
