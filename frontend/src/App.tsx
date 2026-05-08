import { WorkspaceChat } from './components/WorkspaceChat';
import { WorkbenchV3 } from './components/WorkbenchV3';
import { ReadingMode } from './components/ReadingMode';
import { useAppStore } from './lib/store';
import './App.css';

function App() {
  const { mode } = useAppStore();

  if (mode === 'reading') return <ReadingMode />;
  if (mode === 'workbench') return <WorkspaceChat />;

  // v3 workbench — activate via store mode or direct navigation
  return <WorkbenchV3 />;
}

export default App;
