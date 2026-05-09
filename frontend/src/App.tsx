import { WorkbenchV3 } from './components/WorkbenchV3';
import { ReadingMode } from './components/ReadingMode';
import { useAppStore } from './lib/store';
import './App.css';

function App() {
  const { mode } = useAppStore();

  if (mode === 'reading') return <ReadingMode />;

  // v3 workbench — default
  return <WorkbenchV3 />;
}

export default App;
