import { Link, Route, Routes } from 'react-router-dom';
import { DebugPage } from './pages/DebugPage';
import { TrainerPage } from './pages/TrainerPage';

export default function App() {
  return (
    <div className="app">
      {import.meta.env.DEV && (
        <nav className="topnav">
          <Link to="/">训练</Link>
          <Link to="/debug">调试</Link>
        </nav>
      )}
      <Routes>
        <Route path="/" element={<TrainerPage />} />
        {import.meta.env.DEV && <Route path="/debug" element={<DebugPage />} />}
        <Route path="*" element={<TrainerPage />} />
      </Routes>
    </div>
  );
}
