import { WorkspaceChat } from './components/WorkspaceChat';
import { ReadingMode } from './components/ReadingMode';
import { useAppStore } from './lib/store';
import './App.css';

function App() {
  const { mode } = useAppStore();

  return (
    <>
      <div hidden={mode !== 'workbench'}>
        <WorkspaceChat />
      </div>
      {mode === 'reading' && <ReadingMode />}
    </>
  );
}

export default App;
