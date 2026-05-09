import { WorkspaceChat } from './components/WorkspaceChat';
import { ReadingMode } from './components/ReadingMode';
import { useAppStore } from './lib/store';
import './App.css';

function App() {
  const { mode } = useAppStore();

  if (mode === 'reading') return <ReadingMode />;
  if (mode === 'workbench') return <WorkspaceChat />;

  return <WorkspaceChat />;
}

export default App;
