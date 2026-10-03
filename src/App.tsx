import { Link, Route, Routes } from 'react-router-dom';
import { BoardTexturePage } from './pages/BoardTexturePage';
import { DebugPage } from './pages/DebugPage';
import { FlopTypesPage } from './pages/FlopTypesPage';
import { TrainerPage } from './pages/TrainerPage';

export default function App() {
  return (
    <div className="app">
      {import.meta.env.DEV && (
        <nav className="topnav">
          <Link to="/">训练</Link>
          <Link to="/flop-types">牌型图鉴</Link>
          <Link to="/board-textures">牌面结构</Link>
          <Link to="/debug">调试</Link>
        </nav>
      )}
      <Routes>
        <Route path="/" element={<TrainerPage />} />
        <Route path="/flop-types" element={<FlopTypesPage />} />
        <Route path="/board-textures" element={<BoardTexturePage />} />
        {import.meta.env.DEV && <Route path="/debug" element={<DebugPage />} />}
        <Route path="*" element={<TrainerPage />} />
      </Routes>
    </div>
  );
}
