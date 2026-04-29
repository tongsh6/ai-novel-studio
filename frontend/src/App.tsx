import { WorkspaceChat } from './components/WorkspaceChat';
import { ReadingMode } from './components/ReadingMode';
import { useAppStore } from './lib/store';
import './App.css';

function App() {
  const { mode } = useAppStore();

  return (
    <>
      {mode === 'workbench' ? <WorkspaceChat /> : <ReadingMode />}
    </>
  );
}

export default App;
