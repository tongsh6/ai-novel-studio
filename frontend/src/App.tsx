import { WorkspaceChat } from "./components/WorkspaceChat";
import { ReadingMode } from "./components/ReadingMode";
import { MemoryListPage } from "./components/MemoryListPage";
import { useAppStore } from "./lib/store";
import "./App.css";

function App() {
  const mode = useAppStore((state) => state.mode);
  const setMode = useAppStore((state) => state.setMode);
  const workId = useAppStore((state) => state.context.workId);

  return (
    <>
      <div hidden={mode !== "workbench"}>
        <WorkspaceChat />
      </div>
      {mode === "reading" && <ReadingMode />}
      {mode === "memory" && workId && (
        <MemoryListPage workId={workId} onBack={() => setMode("workbench")} />
      )}
    </>
  );
}

export default App;
